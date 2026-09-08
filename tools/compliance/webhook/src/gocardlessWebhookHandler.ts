/**
 * GoCardless webhook processing. Mirrors webhookHandler.ts's Stripe flow
 * (signature verification, idempotency, customer lookup, dual enrollment
 * into the onboarding sequence and the license lifecycle) but adapted to
 * two real, verified differences in how GoCardless's webhooks work:
 *
 *   1. One delivery carries a BATCH of events (`{ events: [...] }`), not
 *      one event per request. GoCardless's own docs warn against
 *      deduping by the delivery's `meta.webhook_id` -- that identifies the
 *      delivery attempt, not the event -- so idempotency here is per
 *      `event.id`, exactly like the per-event.id dedupe Stripe also needs.
 *   2. GoCardless retries a failed delivery up to 9 times total (1 initial
 *      + 8 retries) on any non-2xx/timeout, and has its own convention of
 *      returning HTTP 498 specifically for a signature failure so it
 *      stops retrying a payload that will never verify.
 *
 * *** VERIFY BEFORE GOING LIVE ***
 * MANDATE_ACTIVATED constant below is this integration's trigger
 * condition -- get it wrong and no client is ever enrolled. It's set from
 * GoCardless's documented event-action conventions (bare verbs per
 * resource_type, e.g. payments use "confirmed" not "payment_confirmed"),
 * but conflicting docs pages disagreed on the exact literal string during
 * research for this file. Confirm the exact resource_type/action pair
 * against a real "mandate active" event in the GoCardless dashboard's
 * webhook log (Developers -> Webhooks -> a sandbox mandate) before
 * connecting this to anything real.
 */
import { verifyGoCardlessSignature, SignatureVerificationError } from "./gocardlessSignature";
import { IdempotencyStore } from "./idempotencyStore";
import { GoCardlessCustomerLookup } from "./gocardlessCustomerLookup";
import { EmailProvider } from "./emailProvider";
import { Scheduler } from "./scheduler";
import { enrollSequence } from "./emailSequence";
import { ActionLog } from "./actionLog";
import { enrollLicenseLifecycle, DEFAULT_LICENSE_TERMS, LicenseTerms } from "./clientLifecycle";

export interface GoCardlessWebhookDeps {
  webhookSecret: string;
  idempotencyStore: IdempotencyStore;
  customerLookup: GoCardlessCustomerLookup;
  emailProvider: EmailProvider;
  scheduler: Scheduler;
  actionLog: ActionLog;
  licenseTerms?: LicenseTerms;
  now?: () => Date;
}

export interface GoCardlessWebhookResult {
  status: number;
  body: { processed?: number; error?: string };
}

interface GoCardlessEvent {
  id: string;
  resource_type: string;
  action: string;
  links: { mandate?: string; customer?: string };
  created_at: string;
}

interface GoCardlessWebhookBody {
  events: GoCardlessEvent[];
}

/** See the file-level "VERIFY BEFORE GOING LIVE" note above. */
export const MANDATE_RESOURCE_TYPE = "mandates";
export const MANDATE_ACTIVATED_ACTION = "active";

export async function handleGoCardlessWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  deps: GoCardlessWebhookDeps
): Promise<GoCardlessWebhookResult> {
  try {
    verifyGoCardlessSignature(rawBody, signatureHeader, deps.webhookSecret);
  } catch (err) {
    if (err instanceof SignatureVerificationError) {
      // 498, not 400: GoCardless's own convention for "don't bother
      // retrying this, it will never verify" (see gocardlessSignature.ts).
      return { status: 498, body: { error: `signature verification failed: ${err.message}` } };
    }
    throw err;
  }

  let parsed: GoCardlessWebhookBody;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "malformed JSON body" } };
  }

  if (!Array.isArray(parsed.events)) {
    return { status: 400, body: { error: "body missing events array" } };
  }

  let processed = 0;

  for (const event of parsed.events) {
    if (!event.id) continue; // can't dedupe or usefully log an event with no id -- skip rather than fail the whole batch

    if (await deps.idempotencyStore.hasProcessedEvent(event.id)) {
      processed += 1;
      continue; // already handled (this delivery is a GoCardless retry, or the event arrived in an earlier batch)
    }

    if (event.resource_type !== MANDATE_RESOURCE_TYPE || event.action !== MANDATE_ACTIVATED_ACTION) {
      await deps.idempotencyStore.markEventProcessed(event.id);
      processed += 1;
      continue; // not a mandate-activation event; ack and ignore
    }

    const mandateId = event.links.mandate;
    const customerId = event.links.customer;
    if (!mandateId || !customerId) {
      // Malformed event from GoCardless's own side -- not something a
      // retry will fix. Ack it (don't fail the whole batch over one bad
      // event) and move on; this would be worth alerting on in production.
      console.error(`[gocardless webhook] mandate-active event ${event.id} missing mandate/customer link`);
      await deps.idempotencyStore.markEventProcessed(event.id);
      processed += 1;
      continue;
    }

    if (await deps.idempotencyStore.hasEnrolledSubscription(mandateId)) {
      await deps.idempotencyStore.markEventProcessed(event.id);
      processed += 1;
      continue; // already enrolled via an earlier event for this mandate
    }

    let email: string | null;
    try {
      email = await deps.customerLookup.getEmail(customerId);
    } catch (err) {
      // Transient (network/API) failure -- return non-2xx for the WHOLE
      // batch so GoCardless retries delivery. Every event already marked
      // processed above is safely skipped on that retry; this one and any
      // after it in the batch are retried from scratch.
      console.error(`[gocardless webhook] customer lookup failed for ${customerId}:`, err);
      return { status: 500, body: { error: "customer lookup failed", processed } };
    }

    if (!email) {
      console.error(`[gocardless webhook] no email on file for customer ${customerId} (mandate ${mandateId}); skipping enrollment`);
      await deps.idempotencyStore.markEventProcessed(event.id);
      processed += 1;
      continue;
    }

    try {
      await enrollSequence(
        { email, customerId, subscriptionId: mandateId },
        { provider: deps.emailProvider, scheduler: deps.scheduler, now: deps.now }
      );
    } catch (err) {
      console.error(`[gocardless webhook] sequence enrollment failed for mandate ${mandateId}:`, err);
      return { status: 500, body: { error: "email sequence enrollment failed", processed } };
    }

    await deps.idempotencyStore.markSubscriptionEnrolled(mandateId);
    await deps.idempotencyStore.markEventProcessed(event.id);
    processed += 1;

    // Same non-critical-path treatment as the Stripe handler: a failure
    // here must not undo the onboarding enrollment that just succeeded.
    try {
      enrollLicenseLifecycle(
        { email, customerId, subscriptionId: mandateId },
        (deps.now ?? (() => new Date()))(),
        deps.licenseTerms ?? DEFAULT_LICENSE_TERMS,
        { provider: deps.emailProvider, scheduler: deps.scheduler, actionLog: deps.actionLog, now: deps.now }
      );
    } catch (err) {
      console.error(`[gocardless webhook] license lifecycle enrollment failed for mandate ${mandateId}:`, err);
    }
  }

  return { status: 200, body: { processed } };
}
