/**
 * Core webhook processing logic, decoupled from Express so it can be unit
 * tested directly. Handles: signature verification, event-type filtering,
 * two-layer idempotency, customer lookup, and sequence enrollment.
 *
 * Response-code strategy (matches Stripe's documented retry behavior --
 * https://docs.stripe.com/webhooks#retries):
 *   - 400: signature invalid / malformed request. Stripe does NOT retry
 *     4xx responses in the same way -- and retrying wouldn't help, the
 *     request is malformed or unauthenticated, not transiently broken.
 *   - 200: successfully handled (including "already processed" and
 *     "not a relevant event type" -- both are legitimate no-ops, not
 *     errors, and returning 200 tells Stripe not to retry them).
 *   - 500: a transient failure on OUR side (lookup/send failure after
 *     retries exhausted). Returning 500 lets Stripe's own retry schedule
 *     (up to 3 days, with backoff) reattempt delivery, which is simpler
 *     and more robust than building a second retry system on top of
 *     Stripe's for the same problem.
 */
import { verifyStripeSignature, SignatureVerificationError } from "./stripeSignature";
import { IdempotencyStore } from "./idempotencyStore";
import { CustomerLookup } from "./customerLookup";
import { EmailProvider } from "./emailProvider";
import { Scheduler } from "./scheduler";
import { enrollSequence } from "./emailSequence";

export interface WebhookDeps {
  webhookSecret: string;
  idempotencyStore: IdempotencyStore;
  customerLookup: CustomerLookup;
  emailProvider: EmailProvider;
  scheduler: Scheduler;
  now?: () => Date;
}

export interface WebhookResult {
  status: number;
  body: { received?: boolean; error?: string };
}

interface StripeSubscriptionEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string; // subscription id
      customer: string; // customer id
      status: string;
    };
  };
}

const ACTIVATING_EVENT_TYPES = new Set(["customer.subscription.created", "customer.subscription.updated"]);

export async function handleStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  deps: WebhookDeps
): Promise<WebhookResult> {
  try {
    verifyStripeSignature(rawBody, signatureHeader, deps.webhookSecret);
  } catch (err) {
    if (err instanceof SignatureVerificationError) {
      return { status: 400, body: { error: `signature verification failed: ${err.message}` } };
    }
    throw err;
  }

  let event: StripeSubscriptionEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "malformed JSON body" } };
  }

  if (!event.id || !event.type) {
    return { status: 400, body: { error: "event missing required id/type fields" } };
  }

  if (await deps.idempotencyStore.hasProcessedEvent(event.id)) {
    return { status: 200, body: { received: true } }; // already handled, no-op
  }

  if (!ACTIVATING_EVENT_TYPES.has(event.type) || event.data?.object?.status !== "active") {
    await deps.idempotencyStore.markEventProcessed(event.id);
    return { status: 200, body: { received: true } }; // not a subscription-activation event; ack and ignore
  }

  const subscriptionId = event.data.object.id;
  const customerId = event.data.object.customer;

  if (!subscriptionId || !customerId) {
    return { status: 400, body: { error: "active subscription event missing subscription/customer id" } };
  }

  if (await deps.idempotencyStore.hasEnrolledSubscription(subscriptionId)) {
    await deps.idempotencyStore.markEventProcessed(event.id);
    return { status: 200, body: { received: true } }; // already enrolled via an earlier event for this subscription
  }

  let email: string | null;
  try {
    email = await deps.customerLookup.getEmail(customerId);
  } catch (err) {
    // Lookup failure is treated as transient (network/API issue) -- return
    // 500 so Stripe retries the whole webhook delivery later.
    console.error(`[webhook] customer lookup failed for ${customerId}:`, err);
    return { status: 500, body: { error: "customer lookup failed" } };
  }

  if (!email) {
    // No email on file is a permanent condition for this event -- retrying
    // the same webhook won't produce an email. Log for manual follow-up
    // and acknowledge so Stripe stops retrying.
    console.error(`[webhook] no email on file for customer ${customerId} (subscription ${subscriptionId}); skipping enrollment`);
    await deps.idempotencyStore.markEventProcessed(event.id);
    return { status: 200, body: { received: true } };
  }

  try {
    await enrollSequence(
      { email, customerId, subscriptionId },
      { provider: deps.emailProvider, scheduler: deps.scheduler, now: deps.now }
    );
  } catch (err) {
    // Day-0 send failed even after the provider's own retries. Return 500
    // so Stripe retries the webhook -- deliberately do NOT mark the
    // subscription enrolled or the event processed, so the retry re-runs
    // enrollment from scratch rather than skipping it as "already done."
    console.error(`[webhook] sequence enrollment failed for subscription ${subscriptionId}:`, err);
    return { status: 500, body: { error: "email sequence enrollment failed" } };
  }

  await deps.idempotencyStore.markSubscriptionEnrolled(subscriptionId);
  await deps.idempotencyStore.markEventProcessed(event.id);

  return { status: 200, body: { received: true } };
}
