/**
 * The 5-part onboarding email sequence (Days 0, 3, 7, 14, 30) referenced in
 * the handover doc's Pillar 3. Subject lines/content are placeholders --
 * swap in the actual approved copy; the content of these emails is a
 * marketing/legal sign-off decision, not something this script should
 * invent. What this file is responsible for is the *mechanics*: enrolling
 * a customer, sending Day 0 immediately, and durably scheduling the rest.
 */
import { EmailProvider } from "./emailProvider";
import { Scheduler } from "./scheduler";

export interface SequenceRecipient {
  email: string;
  customerId: string;
  subscriptionId: string;
}

interface SequenceStep {
  dayOffset: number;
  subject: string;
  render: (r: SequenceRecipient) => string;
}

export const ONBOARDING_SEQUENCE: SequenceStep[] = [
  {
    dayOffset: 0,
    subject: "Welcome to Solomon -- your compliance kit, in one place",
    render: (r) =>
      `<p>Hi,</p><p>Welcome to Solomon. Your license details, OSS notices, and compliance kit are here: ` +
      `<a href="https://deuerout.com/solomon/compliance">deuerout.com/solomon/compliance</a>.</p>`,
  },
  {
    dayOffset: 3,
    subject: "Solomon: understanding your license (SCSL v1.0)",
    render: () =>
      `<p>A quick look at what SCSL v1.0 does and doesn't permit: ` +
      `<a href="https://deuerout.com/solomon/license">deuerout.com/solomon/license</a>.</p>`,
  },
  {
    dayOffset: 7,
    subject: "Solomon: data residency and your DPA",
    render: () =>
      `<p>Where your data is processed, and how to configure a DPA: ` +
      `<a href="https://deuerout.com/solomon/data-residency">deuerout.com/solomon/data-residency</a>.</p>`,
  },
  {
    dayOffset: 14,
    subject: "Solomon: fairness methodology overview",
    render: () =>
      `<p>How Solomon's four-layer bias mitigation works, and where to find quarterly reports: ` +
      `<a href="https://deuerout.com/solomon/fairness">deuerout.com/solomon/fairness</a>.</p>`,
  },
  {
    dayOffset: 30,
    subject: "Solomon: 30 days in -- your compliance checklist",
    render: () =>
      `<p>A 30-day checklist to confirm your account is fully configured for your compliance obligations.</p>`,
  },
];

export interface EnrollmentDeps {
  provider: EmailProvider;
  scheduler: Scheduler;
  now?: () => Date;
}

/**
 * Enrolls a recipient into the sequence: sends the Day 0 email immediately
 * (awaited, so the webhook handler can surface a send failure in its
 * response/logs) and schedules the remaining steps.
 *
 * Idempotency key per send is deterministic (subscriptionId + dayOffset),
 * so even if enrollSequence were somehow invoked twice for the same
 * subscription, provider-side dedupe (Resend's Idempotency-Key) prevents a
 * duplicate send -- defense in depth alongside the application-level
 * enrollment check in idempotencyStore.
 */
export async function enrollSequence(recipient: SequenceRecipient, deps: EnrollmentDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();

  for (const step of ONBOARDING_SEQUENCE) {
    const runAt = new Date(now.getTime() + step.dayOffset * 24 * 60 * 60 * 1000);
    const send = () =>
      deps.provider
        .send({
          to: recipient.email,
          subject: step.subject,
          html: step.render(recipient),
          idempotencyKey: `${recipient.subscriptionId}-day${step.dayOffset}`,
        })
        .then(() => undefined);

    if (step.dayOffset === 0) {
      await send();
    } else {
      deps.scheduler.scheduleAt(runAt, send);
    }
  }
}
