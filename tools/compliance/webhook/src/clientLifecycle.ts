/**
 * Client-facing comms owed under the Digital Royalty & Data Licensing
 * Agreement (see ../../../../legal/digital-royalty-licensing-agreement.md),
 * where Deverout is Licensor and the subscribing customer is Licensee. Two
 * autonomous, logged sends, run for the life of the subscription:
 *
 *   - A quarterly reminder asking the client for their usage report, due
 *     within 30 days of quarter end per Section 8.1.
 *   - A pre-renewal quote sent 60 days before each renewal date, per the
 *     Continuous Quote mechanism in Section 3.3(c).
 *
 * Oversight model is "fully autonomous, periodic review": nothing here
 * waits for approval before sending, but every send is written to the
 * ActionLog so the owner's periodic batch review has a full record.
 *
 * Durability note: self-rescheduling via Scheduler means this only runs as
 * long as the process does -- like scheduler.ts's InProcessScheduler, this
 * needs the durable-queue swap described there before it can carry a
 * multi-year schedule in production.
 */
import { EmailProvider } from "./emailProvider";
import { Scheduler } from "./scheduler";
import { ActionLog } from "./actionLog";

export interface LicenseeRecipient {
  email: string;
  customerId: string;
  subscriptionId: string;
}

export interface LicenseTerms {
  /** Section 4.1's Initial Term, in years, counted from the Effective Date. */
  initialTermYears: number;
  /** Section 4.2's renewal period length, in years, applied after the Initial Term. */
  renewalTermYears: number;
}

/** Default terms for standard (non-negotiated) self-serve subscriptions. Bespoke Tier 3/4 deals should pass their actual negotiated LicenseTerms instead. */
export const DEFAULT_LICENSE_TERMS: LicenseTerms = { initialTermYears: 1, renewalTermYears: 1 };

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTER_DAYS = 91;
const RENEWAL_NOTICE_DAYS = 60;

export interface LifecycleDeps {
  provider: EmailProvider;
  scheduler: Scheduler;
  actionLog: ActionLog;
  now?: () => Date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/** First renewal date strictly after `from` (effectiveDate + initialTermYears, then + renewalTermYears repeating). */
function nextRenewalDate(effectiveDate: Date, terms: LicenseTerms, from: Date): Date {
  let renewal = addYears(effectiveDate, terms.initialTermYears);
  while (renewal.getTime() <= from.getTime()) {
    renewal = addYears(renewal, terms.renewalTermYears);
  }
  return renewal;
}

async function sendQuarterlyReportReminder(recipient: LicenseeRecipient, deps: LifecycleDeps, quarterIndex: number): Promise<void> {
  await deps.provider.send({
    to: recipient.email,
    subject: "Solomon licensing: your quarterly usage report is due",
    html:
      `<p>Hi,</p><p>Per Section 8.1 of your Digital Royalty & Data Licensing Agreement, your quarterly usage report ` +
      `(usage metrics and revenue attribution) is due within 30 days. Reply to this email or submit via your Solomon dashboard.</p>`,
    idempotencyKey: `${recipient.subscriptionId}-royalty-report-q${quarterIndex}`,
  });
  await deps.actionLog.record({
    occurredAt: (deps.now ?? (() => new Date()))(),
    actionType: "royalty_report_reminder_sent",
    recipientEmail: recipient.email,
    subscriptionId: recipient.subscriptionId,
    detail: { quarterIndex: String(quarterIndex) },
  });
}

async function sendRenewalQuote(recipient: LicenseeRecipient, deps: LifecycleDeps, renewalDate: Date): Promise<void> {
  await deps.provider.send({
    to: recipient.email,
    subject: "Solomon licensing: your renewal quote",
    html:
      `<p>Hi,</p><p>Your Digital Royalty & Data Licensing Agreement renews on ${renewalDate.toDateString()}. ` +
      `Per the Continuous Quote mechanism (Section 3.3), your renewal pricing is enclosed for review at least 60 days ahead of that date.</p>`,
    idempotencyKey: `${recipient.subscriptionId}-renewal-quote-${renewalDate.toISOString().slice(0, 10)}`,
  });
  await deps.actionLog.record({
    occurredAt: (deps.now ?? (() => new Date()))(),
    actionType: "renewal_quote_sent",
    recipientEmail: recipient.email,
    subscriptionId: recipient.subscriptionId,
    detail: { renewalDate: renewalDate.toISOString() },
  });
}

/**
 * Enrolls a Licensee into the recurring comms owed under the licensing
 * agreement, starting from `effectiveDate`. Self-rescheduling: each
 * quarterly reminder and each renewal quote schedules the next one when it
 * fires, so the sequence runs for the life of the subscription rather than
 * a fixed number of steps.
 */
export function enrollLicenseLifecycle(
  recipient: LicenseeRecipient,
  effectiveDate: Date,
  terms: LicenseTerms,
  deps: LifecycleDeps
): void {
  const scheduleNextQuarter = (quarterIndex: number, from: Date) => {
    const runAt = addDays(from, QUARTER_DAYS);
    deps.scheduler.scheduleAt(runAt, async () => {
      await sendQuarterlyReportReminder(recipient, deps, quarterIndex);
      scheduleNextQuarter(quarterIndex + 1, runAt);
    });
  };
  scheduleNextQuarter(1, effectiveDate);

  const scheduleNextRenewalQuote = (from: Date) => {
    const renewalDate = nextRenewalDate(effectiveDate, terms, from);
    const runAt = addDays(renewalDate, -RENEWAL_NOTICE_DAYS);
    deps.scheduler.scheduleAt(runAt, async () => {
      await sendRenewalQuote(recipient, deps, renewalDate);
      scheduleNextRenewalQuote(renewalDate);
    });
  };
  scheduleNextRenewalQuote(effectiveDate);
}
