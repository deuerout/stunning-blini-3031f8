/**
 * Idempotency tracking. Stripe explicitly documents that webhooks can be
 * delivered more than once for the same event (retries on timeout/non-2xx,
 * and occasional at-least-once duplicates), so two layers are needed:
 *
 *   1. Raw event dedup (by Stripe event.id) -- don't process the same
 *      webhook delivery twice.
 *   2. Enrollment dedup (by subscription ID) -- don't re-enroll a customer
 *      into the 5-part sequence if a *different* event for the same
 *      subscription's activation arrives (e.g. Stripe can emit both
 *      `customer.subscription.created` and a following
 *      `customer.subscription.updated` as a new subscription settles into
 *      `active`; only the first should trigger enrollment).
 *
 * This in-memory implementation is for local dev/test only -- it does not
 * survive a restart and does not work across multiple server instances.
 * For production, back both stores with a table/Redis SETNX with a
 * reasonable TTL (Stripe's own retry window is bounded, so days not years
 * of retention are enough for the event-id store; the subscription
 * enrollment store should persist for the life of the subscription, or at
 * minimum the 30-day sequence window).
 */

export interface IdempotencyStore {
  hasProcessedEvent(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<void>;
  hasEnrolledSubscription(subscriptionId: string): Promise<boolean>;
  markSubscriptionEnrolled(subscriptionId: string): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly processedEvents = new Set<string>();
  private readonly enrolledSubscriptions = new Set<string>();

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }
  async markEventProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }
  async hasEnrolledSubscription(subscriptionId: string): Promise<boolean> {
    return this.enrolledSubscriptions.has(subscriptionId);
  }
  async markSubscriptionEnrolled(subscriptionId: string): Promise<void> {
    this.enrolledSubscriptions.add(subscriptionId);
  }
}
