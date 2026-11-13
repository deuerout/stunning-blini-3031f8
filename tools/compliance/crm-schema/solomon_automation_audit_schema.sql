-- Solomon AI: Automation Action Audit Log
-- PostgreSQL DDL
--
-- Production backing store for tools/compliance/webhook/src/actionLog.ts's
-- InMemoryActionLog. Records every autonomous client-facing action taken
-- under the owner's "fully autonomous, periodic review" oversight model
-- (renewal quotes, quarterly royalty-report reminders, contract drafts) so
-- a periodic batch review has a complete, ordered, tamper-evident account
-- of what went out, to whom, and why -- nothing here gates a send; it
-- exists so review after the fact is possible.
--
-- Design mirrors solomon_compliance_schema.sql's compliance_enquiry_log:
--   1. INSERT-only, trigger-enforced -- an autonomous action, once taken,
--      cannot be quietly edited or deleted out of the record.
--   2. Structured detail only (detail JSONB) -- never raw email/document
--      bodies, matching the "never a duplicated copy of the conversation
--      itself" rule from the compliance log.
--   3. Depends on that file's accounts/users stand-in tables when run
--      standalone; in the real schema, point account_id at the actual
--      accounts table instead of recreating it here.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE solomon_automation_action_type AS ENUM (
    'royalty_report_reminder_sent', -- Agreement Section 8.1 quarterly reminder
    'renewal_quote_sent',           -- Agreement Section 3.3(c) pre-renewal quote
    'agreement_drafted',            -- legal/generate-agreement.js output
    'onboarding_email_sent'         -- the existing 5-part Day 0/3/7/14/30 sequence
);

CREATE TABLE automation_action_log (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    account_id         UUID NOT NULL REFERENCES accounts(id),
    subscription_id    TEXT NOT NULL,
    recipient_email     TEXT NOT NULL,

    action_type        solomon_automation_action_type NOT NULL,
    detail             JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- small structured context only (e.g. {"quarterIndex": "3"},
        -- {"renewalDate": "2027-01-01T00:00:00.000Z"}) -- never a raw
        -- email/document body

    reviewed_at        TIMESTAMPTZ,
        -- set when the owner's periodic review has covered this row;
        -- NULL means "not yet reviewed", the default state for every new
        -- autonomous action
    reviewed_by_note   TEXT
);

CREATE INDEX idx_automation_log_account_id      ON automation_action_log (account_id);
CREATE INDEX idx_automation_log_subscription_id ON automation_action_log (subscription_id);
CREATE INDEX idx_automation_log_action_type     ON automation_action_log (action_type);
CREATE INDEX idx_automation_log_occurred_at     ON automation_action_log (occurred_at);
CREATE INDEX idx_automation_log_unreviewed      ON automation_action_log (occurred_at) WHERE reviewed_at IS NULL;

-- Reuses the immutability-enforcement function defined in
-- solomon_compliance_schema.sql (solomon_reject_mutation); if this file is
-- ever run standalone without that one, uncomment the definition below.
-- CREATE OR REPLACE FUNCTION solomon_reject_mutation() RETURNS trigger AS $$
-- BEGIN
--     RAISE EXCEPTION '% is an immutable audit table: % is not permitted (row id=%)',
--         TG_TABLE_NAME, TG_OP, COALESCE(OLD.id, NULL);
--     RETURN NULL;
-- END;
-- $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION solomon_reject_action_log_core_mutation() RETURNS trigger AS $$
BEGIN
    -- The row itself is immutable except for the two review-tracking
    -- columns: reviewed_at and reviewed_by_note may be filled in later by
    -- the owner's periodic review without that counting as rewriting what
    -- the automation actually did.
    IF (NEW.id, NEW.occurred_at, NEW.account_id, NEW.subscription_id, NEW.recipient_email, NEW.action_type, NEW.detail)
       IS DISTINCT FROM
       (OLD.id, OLD.occurred_at, OLD.account_id, OLD.subscription_id, OLD.recipient_email, OLD.action_type, OLD.detail)
    THEN
        RAISE EXCEPTION 'automation_action_log is immutable except for reviewed_at/reviewed_by_note (row id=%)', OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_automation_log_no_core_mutation
    BEFORE UPDATE ON automation_action_log
    FOR EACH ROW EXECUTE FUNCTION solomon_reject_action_log_core_mutation();

CREATE OR REPLACE FUNCTION solomon_reject_action_log_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'automation_action_log is an immutable audit table: DELETE is not permitted (row id=%)', OLD.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_automation_log_no_delete
    BEFORE DELETE ON automation_action_log
    FOR EACH ROW EXECUTE FUNCTION solomon_reject_action_log_delete();

-- Convenience view for the owner's periodic review digest.
CREATE VIEW automation_action_log_unreviewed AS
SELECT id, occurred_at, subscription_id, recipient_email, action_type, detail
FROM automation_action_log
WHERE reviewed_at IS NULL
ORDER BY occurred_at;

COMMIT;
