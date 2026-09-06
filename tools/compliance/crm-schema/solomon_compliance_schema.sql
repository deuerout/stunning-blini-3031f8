-- Solomon AI: CRM Compliance Enquiry Logging Schema
-- PostgreSQL DDL
--
-- Design notes (from the Phase 1 audit):
--   1. NO raw customer free text lives in the primary audit log. The log
--      records what category of enquiry it was, which approved template
--      handled it, whether it was escalated, and a pointer back to the
--      actual conversation in the support platform of record -- never a
--      duplicated copy of the conversation itself.
--   2. If legal genuinely needs a verbatim excerpt (e.g. for a bias
--      allegation under investigation), it goes in a SEPARATE, narrower
--      table with its own access grant, referenced by foreign key, so a
--      routine `SELECT * FROM compliance_enquiry_log` never surfaces it.
--   3. "Immutable audit timestamps" is enforced structurally, not just by
--      convention: the log and its escalation-event history are INSERT-only
--      tables (a trigger rejects UPDATE/DELETE). Anything that needs to
--      change over time (an escalation's current status) lives in a
--      separate, explicitly mutable case table, whose full history is still
--      reconstructable from the immutable event table.
--   4. System-generated entries (e.g. an API-abuse anomaly detector) use
--      the same log, tagged created_by_actor = 'system', so automated
--      compliance signals flow through the same audit trail as human
--      support interactions rather than living only in infra logs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Minimal stand-ins for the platform's existing accounts/users tables, so
-- this file is runnable stand-alone for review/testing. In the real schema,
-- drop these two CREATE TABLE blocks and point the foreign keys below at
-- the actual accounts/users tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID REFERENCES accounts(id),
    email       TEXT NOT NULL,
    is_staff    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Enquiry category, matching the approved response template library
-- (template_id column carries the exact "1.1" / "3.2"-style ID; this enum
-- is the coarser bucket used for reporting/filtering).
-- ---------------------------------------------------------------------------
CREATE TYPE solomon_enquiry_category AS ENUM (
    'license_general',          -- 1.1
    'source_code_request',      -- 1.2
    'source_code_request_agpl', -- 1.3 - escalate
    'data_residency',           -- 2.1
    'cross_border_transfer',    -- 2.2 - escalate
    'fairness_methodology',     -- 3.1
    'bias_allegation',          -- 3.2 - escalate urgent
    'resale_redistribution',    -- 4.1
    'indemnification',          -- 4.2 - escalate
    'regulatory_inquiry',       -- subpoena / audit notice - escalate urgent immediate
    'api_abuse_signal'          -- system-generated, not a customer enquiry
);

CREATE TYPE solomon_enquiry_channel AS ENUM (
    'email', 'chat', 'phone', 'support_ticket', 'system_anomaly_detector'
);

CREATE TYPE solomon_actor_type AS ENUM ('human', 'system');

-- ---------------------------------------------------------------------------
-- Immutable audit log: one row per compliance-relevant enquiry or
-- system-detected event. INSERT-only -- see trigger below.
-- ---------------------------------------------------------------------------
CREATE TABLE compliance_enquiry_log (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    account_id              UUID NOT NULL REFERENCES accounts(id),
    customer_user_id        UUID REFERENCES users(id),
        -- nullable: an anonymous/pre-signup enquiry may have no known user
    handled_by_user_id      UUID REFERENCES users(id),
        -- nullable only for created_by_actor = 'system' rows

    created_by_actor        solomon_actor_type NOT NULL DEFAULT 'human',
    channel                 solomon_enquiry_channel NOT NULL,

    category                solomon_enquiry_category NOT NULL,
    template_id             TEXT,
        -- e.g. '1.1', '3.2' -- FK-less reference to the template library
        -- (the library lives outside the DB); NULL only when
        -- created_by_actor = 'system' and no template applies
    template_variables      JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- rendered variables only (e.g. {"region": "EU"}) -- never free text

    escalation_required     BOOLEAN NOT NULL,
    escalation_contact      TEXT,       -- e.g. 'legal@deuerout.com'
    escalation_sla_hours    INTEGER,    -- e.g. 2, 24, 48, 72

    response_sent_at        TIMESTAMPTZ,
        -- when the approved template response was actually sent; NULL if
        -- this row is escalate-only / acknowledge-only per the response
        -- template library's "Do not respond, escalate immediately" cases

    source_system           TEXT NOT NULL,
        -- which platform holds the actual conversation (e.g. 'zendesk',
        -- 'intercom') -- the source of truth for raw content, not this table
    source_ticket_ref       TEXT NOT NULL,
        -- pointer/ID into that system; never the conversation itself

    CONSTRAINT chk_escalation_fields CHECK (
        (escalation_required = false)
        OR (escalation_required = true AND escalation_contact IS NOT NULL AND escalation_sla_hours IS NOT NULL)
    ),
    CONSTRAINT chk_system_actor_no_handler CHECK (
        (created_by_actor = 'human' AND handled_by_user_id IS NOT NULL)
        OR (created_by_actor = 'system')
    )
);

CREATE INDEX idx_enquiry_log_account_id   ON compliance_enquiry_log (account_id);
CREATE INDEX idx_enquiry_log_category     ON compliance_enquiry_log (category);
CREATE INDEX idx_enquiry_log_escalated    ON compliance_enquiry_log (escalation_required) WHERE escalation_required = true;
CREATE INDEX idx_enquiry_log_created_at   ON compliance_enquiry_log (created_at);

-- ---------------------------------------------------------------------------
-- Restricted raw-context table. Separate from the primary log by design
-- (see design note #2): grant SELECT on this table only to a narrow
-- 'solomon_compliance_restricted' role, never to the general support/BI
-- role that can read compliance_enquiry_log.
-- ---------------------------------------------------------------------------
CREATE TABLE compliance_enquiry_raw_context (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_log_id      UUID NOT NULL REFERENCES compliance_enquiry_log(id),
    raw_excerpt         TEXT NOT NULL,
    captured_by_user_id UUID NOT NULL REFERENCES users(id),
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    justification       TEXT NOT NULL
        -- required: why this excerpt needed to be captured verbatim
        -- (e.g. "legal requested verbatim wording for bias investigation
        -- ref LEGAL-2026-0143")
);

CREATE INDEX idx_raw_context_enquiry_log_id ON compliance_enquiry_raw_context (enquiry_log_id);

-- Example restricted-access role. Uncomment and adapt for your environment;
-- left commented so this file stays runnable without superuser role-creation
-- privileges in ad hoc test environments.
-- CREATE ROLE solomon_compliance_restricted;
-- REVOKE ALL ON compliance_enquiry_raw_context FROM PUBLIC;
-- GRANT SELECT, INSERT ON compliance_enquiry_raw_context TO solomon_compliance_restricted;

-- ---------------------------------------------------------------------------
-- Mutable escalation case: current-state view of an escalation's workflow.
-- One case per escalated log entry. This table IS mutable (status changes
-- as the case progresses) -- immutability lives in the event table below,
-- which is the source of truth for "what happened when."
-- ---------------------------------------------------------------------------
CREATE TYPE solomon_case_status AS ENUM ('open', 'acknowledged', 'resolved', 'breached');

CREATE TABLE compliance_escalation_case (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_log_id        UUID NOT NULL UNIQUE REFERENCES compliance_enquiry_log(id),
    opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    sla_deadline          TIMESTAMPTZ NOT NULL,
    status                solomon_case_status NOT NULL DEFAULT 'open',
    assigned_to_user_id   UUID REFERENCES users(id),
    resolved_at           TIMESTAMPTZ,
    resolution_summary    TEXT,
        -- a compliance-authored summary of the outcome; never raw customer text
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_resolved_fields CHECK (
        (status = 'resolved' AND resolved_at IS NOT NULL)
        OR (status != 'resolved')
    )
);

CREATE INDEX idx_escalation_case_status ON compliance_escalation_case (status);
CREATE INDEX idx_escalation_case_sla    ON compliance_escalation_case (sla_deadline) WHERE status IN ('open', 'acknowledged');

-- ---------------------------------------------------------------------------
-- Immutable event history for the case -- append-only. This is what makes
-- the mutable `status` column above an auditable convenience rather than a
-- gap: every transition is independently recorded and can never be edited
-- or deleted after the fact.
-- ---------------------------------------------------------------------------
CREATE TABLE compliance_escalation_case_event (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id       UUID NOT NULL REFERENCES compliance_escalation_case(id),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type    TEXT NOT NULL CHECK (event_type IN (
                      'opened', 'acknowledged', 'reassigned', 'resolved', 'breached', 'reopened'
                  )),
    actor_user_id UUID REFERENCES users(id), -- NULL for system-generated events (e.g. 'breached')
    note          TEXT
);

CREATE INDEX idx_case_event_case_id ON compliance_escalation_case_event (case_id);

-- ---------------------------------------------------------------------------
-- Immutability enforcement: reject UPDATE/DELETE on the two append-only
-- tables. INSERT remains allowed; that's the only mutation these tables
-- should ever see.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION solomon_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is an immutable audit table: % is not permitted (row id=%)',
        TG_TABLE_NAME, TG_OP, COALESCE(OLD.id, NULL);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enquiry_log_immutable
    BEFORE UPDATE OR DELETE ON compliance_enquiry_log
    FOR EACH ROW EXECUTE FUNCTION solomon_reject_mutation();

CREATE TRIGGER trg_raw_context_immutable
    BEFORE UPDATE OR DELETE ON compliance_enquiry_raw_context
    FOR EACH ROW EXECUTE FUNCTION solomon_reject_mutation();

CREATE TRIGGER trg_case_event_immutable
    BEFORE UPDATE OR DELETE ON compliance_escalation_case_event
    FOR EACH ROW EXECUTE FUNCTION solomon_reject_mutation();

-- updated_at housekeeping for the one legitimately mutable table.
CREATE OR REPLACE FUNCTION solomon_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_case_touch_updated_at
    BEFORE UPDATE ON compliance_escalation_case
    FOR EACH ROW EXECUTE FUNCTION solomon_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Convenience view: open/acknowledged cases past their SLA deadline.
-- Does not mutate anything -- `status = 'breached'` is only ever set by an
-- explicit application-level transition (with a corresponding case_event
-- row), not implicitly by this view.
-- ---------------------------------------------------------------------------
CREATE VIEW compliance_escalations_overdue AS
SELECT c.id AS case_id, c.enquiry_log_id, c.status, c.sla_deadline, c.assigned_to_user_id,
       l.category, l.escalation_contact
FROM compliance_escalation_case c
JOIN compliance_enquiry_log l ON l.id = c.enquiry_log_id
WHERE c.status IN ('open', 'acknowledged')
  AND c.sla_deadline < now();

COMMIT;
