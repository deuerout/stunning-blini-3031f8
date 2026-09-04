-- Behavioral proof for solomon_compliance_schema.sql.
-- Run against a DB that already has the schema applied. Not idempotent by
-- design (it's asserting on fresh inserts) -- point it at a throwaway DB.

\set ON_ERROR_STOP off
\pset pager off

\echo '--- Setup: one account, two users (staff + customer) ---'
INSERT INTO accounts (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Acme Corp');
INSERT INTO users (id, account_id, email, is_staff) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'agent@deuerout.com', true),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'customer@acme.example', false);

\echo '--- Test 1: normal non-escalated enquiry logs cleanly ---'
INSERT INTO compliance_enquiry_log
  (account_id, customer_user_id, handled_by_user_id, created_by_actor, channel,
   category, template_id, template_variables, escalation_required, response_sent_at,
   source_system, source_ticket_ref)
VALUES
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'human', 'email',
   'license_general', '1.1', '{}'::jsonb, false, now(),
   'zendesk', 'ZD-10001')
RETURNING id, category, escalation_required;

\echo '--- Test 2: escalated enquiry WITHOUT contact/SLA must be rejected (check constraint) ---'
INSERT INTO compliance_enquiry_log
  (account_id, handled_by_user_id, created_by_actor, channel,
   category, escalation_required, source_system, source_ticket_ref)
VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'human', 'chat', 'bias_allegation', true, 'zendesk', 'ZD-10002');
-- Expect: ERROR - violates check constraint "chk_escalation_fields"

\echo '--- Test 3: correctly-formed escalated enquiry (bias allegation) succeeds ---'
INSERT INTO compliance_enquiry_log
  (id, account_id, customer_user_id, handled_by_user_id, created_by_actor, channel,
   category, template_id, escalation_required, escalation_contact, escalation_sla_hours,
   source_system, source_ticket_ref)
VALUES
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'human', 'chat',
   'bias_allegation', '3.2', true, 'legal@deuerout.com', 24,
   'zendesk', 'ZD-10003')
RETURNING id;

\echo '--- Test 4: raw context capture, linked to the escalated row, with justification ---'
INSERT INTO compliance_enquiry_raw_context
  (enquiry_log_id, raw_excerpt, captured_by_user_id, justification)
VALUES
  ('44444444-4444-4444-4444-444444444444',
   'Customer stated the model gave different loan guidance based on stated nationality.',
   '22222222-2222-2222-2222-222222222222',
   'Legal requested verbatim wording for bias investigation ref LEGAL-2026-0143')
RETURNING id;

\echo '--- Test 5: log entry is immutable -- UPDATE must be rejected ---'
UPDATE compliance_enquiry_log SET category = 'license_general' WHERE id = '44444444-4444-4444-4444-444444444444';
-- Expect: ERROR - compliance_enquiry_log is an immutable audit table

\echo '--- Test 6: log entry is immutable -- DELETE must be rejected ---'
DELETE FROM compliance_enquiry_log WHERE id = '44444444-4444-4444-4444-444444444444';
-- Expect: ERROR - compliance_enquiry_log is an immutable audit table

\echo '--- Test 7: escalation case opens, SLA computed, case is mutable ---'
INSERT INTO compliance_escalation_case (enquiry_log_id, sla_deadline, status, assigned_to_user_id)
VALUES ('44444444-4444-4444-4444-444444444444', now() + interval '24 hours', 'open',
        '22222222-2222-2222-2222-222222222222')
RETURNING id, status, sla_deadline;

\echo '--- Test 8: resolving a case without resolved_at must be rejected (check constraint) ---'
UPDATE compliance_escalation_case
SET status = 'resolved'
WHERE enquiry_log_id = '44444444-4444-4444-4444-444444444444';
-- Expect: ERROR - violates check constraint "chk_resolved_fields"

\echo '--- Test 9: properly resolving the case succeeds and updated_at advances ---'
UPDATE compliance_escalation_case
SET status = 'resolved', resolved_at = now(), resolution_summary = 'Confirmed no disparate treatment; false positive per fairness audit.'
WHERE enquiry_log_id = '44444444-4444-4444-4444-444444444444'
RETURNING status, resolved_at, updated_at;

\echo '--- Test 10: case event history is append-only ---'
INSERT INTO compliance_escalation_case_event (case_id, event_type, actor_user_id, note)
SELECT id, 'resolved', '22222222-2222-2222-2222-222222222222', 'Closed after fairness audit review.'
FROM compliance_escalation_case WHERE enquiry_log_id = '44444444-4444-4444-4444-444444444444'
RETURNING id, event_type;

UPDATE compliance_escalation_case_event SET note = 'tampered' WHERE event_type = 'resolved';
-- Expect: ERROR - compliance_escalation_case_event is an immutable audit table

\echo '--- Test 11: system-generated API-abuse signal, no handled_by_user_id required ---'
INSERT INTO compliance_enquiry_log
  (account_id, created_by_actor, channel, category, escalation_required,
   escalation_contact, escalation_sla_hours, source_system, source_ticket_ref)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'system', 'system_anomaly_detector',
   'api_abuse_signal', true, 'legal@deuerout.com', 0,
   'api-gateway', 'ANOMALY-88213')
RETURNING id, created_by_actor, handled_by_user_id;

\echo '--- Test 12: human-actor row WITHOUT handled_by_user_id must be rejected ---'
INSERT INTO compliance_enquiry_log
  (account_id, created_by_actor, channel, category, escalation_required,
   source_system, source_ticket_ref)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'human', 'email',
   'license_general', false, 'zendesk', 'ZD-10004');
-- Expect: ERROR - violates check constraint "chk_system_actor_no_handler"

\echo '--- Test 13: overdue-escalations view returns nothing yet (SLA not passed) ---'
SELECT count(*) AS overdue_count FROM compliance_escalations_overdue;
-- Expect: 0 (the one open case above already resolved in Test 9; no others are open)

\echo '--- All tests executed. Review output above for expected PASS/ERROR markers. ---'
