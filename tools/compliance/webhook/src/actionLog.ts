/**
 * Audit trail for autonomous client-facing actions (renewal quotes,
 * royalty-report reminders, contract drafts). The owner's chosen oversight
 * model is "act now, review later" -- nothing here blocks a send, but every
 * send is recorded so a periodic (e.g. weekly) review has a complete,
 * ordered account of what went out, to whom, and why.
 *
 * In-memory implementation is for local dev/test only, matching
 * idempotencyStore.ts's pattern. For production, back this with the
 * automation_action_log table (see
 * ../../crm-schema/solomon_automation_audit_schema.sql) -- an INSERT-only
 * table, same immutability pattern as compliance_enquiry_log -- so the log
 * survives restarts and is queryable for the review digest.
 */

export interface AutomationAction {
  occurredAt: Date;
  /** e.g. "royalty_report_reminder_sent", "renewal_quote_sent", "agreement_drafted" */
  actionType: string;
  recipientEmail: string;
  subscriptionId: string;
  /** Small, structured context only -- never raw email/document bodies (mirrors the CRM log's own no-raw-text rule). */
  detail: Record<string, string>;
}

export interface ActionLog {
  record(action: AutomationAction): Promise<void>;
}

export class InMemoryActionLog implements ActionLog {
  public actions: AutomationAction[] = [];
  async record(action: AutomationAction): Promise<void> {
    this.actions.push(action);
  }
}
