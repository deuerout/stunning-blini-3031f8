import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server";
import { WebhookDeps } from "../src/webhookHandler";
import { InMemoryIdempotencyStore } from "../src/idempotencyStore";
import { NullEmailProvider } from "../src/emailProvider";
import { StaticCustomerLookup } from "../src/customerLookup";
import { signStripePayload, subscriptionActiveEvent, FakeScheduler, postWebhook } from "./testHelpers";

const SECRET = "whsec_test_secret_do_not_use_in_prod";

function buildDeps(overrides: Partial<WebhookDeps> = {}): { deps: WebhookDeps; provider: NullEmailProvider; scheduler: FakeScheduler } {
  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();
  const deps: WebhookDeps = {
    webhookSecret: SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({ cus_123: "customer@acme.example" }),
    emailProvider: provider,
    scheduler,
    ...overrides,
  };
  return { deps, provider, scheduler };
}

test("valid subscription-activation webhook enrolls the customer and returns 200", async () => {
  const { deps, provider, scheduler } = buildDeps();
  const app = createApp(deps);

  const body = subscriptionActiveEvent({ eventId: "evt_1", subscriptionId: "sub_1", customerId: "cus_123" });
  const signature = signStripePayload(body, SECRET);

  const res = await postWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });
  assert.equal(provider.sent.length, 1, "Day 0 email should have been sent");
  assert.equal(provider.sent[0].to, "customer@acme.example");
  assert.equal(scheduler.scheduled.length, 4, "days 3/7/14/30 should be scheduled");
});

test("invalid signature is rejected with 400 and no email is sent", async () => {
  const { deps, provider } = buildDeps();
  const app = createApp(deps);

  const body = subscriptionActiveEvent({ eventId: "evt_2", subscriptionId: "sub_2", customerId: "cus_123" });
  const badSignature = "t=1234567890,v1=" + "0".repeat(64);

  const res = await postWebhook(app, body, badSignature);

  assert.equal(res.status, 400);
  assert.equal(provider.sent.length, 0);
});

test("duplicate event id (Stripe retry) is acknowledged but does not re-send", async () => {
  const { deps, provider } = buildDeps();
  const app = createApp(deps);

  const body = subscriptionActiveEvent({ eventId: "evt_3", subscriptionId: "sub_3", customerId: "cus_123" });
  const signature = signStripePayload(body, SECRET);

  const first = await postWebhook(app, body, signature);
  const second = await postWebhook(app, body, signature);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(provider.sent.length, 1, "the duplicate delivery must not trigger a second Day 0 send");
});

test("two different events for the same subscription only enroll once", async () => {
  const { deps, provider } = buildDeps();
  const app = createApp(deps);

  const created = subscriptionActiveEvent({
    eventId: "evt_4a",
    eventType: "customer.subscription.created",
    subscriptionId: "sub_4",
    customerId: "cus_123",
  });
  const updated = subscriptionActiveEvent({
    eventId: "evt_4b",
    eventType: "customer.subscription.updated",
    subscriptionId: "sub_4",
    customerId: "cus_123",
  });

  await postWebhook(app, created, signStripePayload(created, SECRET));
  await postWebhook(app, updated, signStripePayload(updated, SECRET));

  assert.equal(provider.sent.length, 1, "the same subscription must not be enrolled twice from two different events");
});

test("non-activation event types are acknowledged without sending any email", async () => {
  const { deps, provider } = buildDeps();
  const app = createApp(deps);

  const body = JSON.stringify({
    id: "evt_5",
    type: "invoice.paid",
    data: { object: { id: "in_1", customer: "cus_123", status: "paid" } },
  });
  const signature = signStripePayload(body, SECRET);

  const res = await postWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.equal(provider.sent.length, 0);
});

test("a subscription that is not yet active (e.g. incomplete) does not trigger enrollment", async () => {
  const { deps, provider } = buildDeps();
  const app = createApp(deps);

  const body = subscriptionActiveEvent({
    eventId: "evt_6",
    subscriptionId: "sub_6",
    customerId: "cus_123",
    status: "incomplete",
  });
  const signature = signStripePayload(body, SECRET);

  const res = await postWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.equal(provider.sent.length, 0);
});

test("unknown customer (no email on file) is acknowledged, logged, and skipped rather than retried forever", async () => {
  const { deps, provider } = buildDeps({ customerLookup: new StaticCustomerLookup({}) });
  const app = createApp(deps);

  const body = subscriptionActiveEvent({ eventId: "evt_7", subscriptionId: "sub_7", customerId: "cus_unknown" });
  const signature = signStripePayload(body, SECRET);

  const res = await postWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.equal(provider.sent.length, 0);
});

test("a transient email-provider failure surfaces as 500 so Stripe will retry delivery", async () => {
  const failingProvider = {
    send: async () => {
      throw Object.assign(new Error("simulated outage"), { retryable: true });
    },
  };
  const { deps } = buildDeps({ emailProvider: failingProvider as never });
  const app = createApp(deps);

  const body = subscriptionActiveEvent({ eventId: "evt_8", subscriptionId: "sub_8", customerId: "cus_123" });
  const signature = signStripePayload(body, SECRET);

  const res = await postWebhook(app, body, signature);

  assert.equal(res.status, 500);
});

test("rate limiting kicks in after the configured request cap for a single client", async () => {
  const { deps } = buildDeps();
  const app = createApp(deps, { windowMs: 60_000, max: 3 });

  const body = subscriptionActiveEvent({ eventId: "evt_rl", subscriptionId: "sub_rl", customerId: "cus_123" });
  const signature = signStripePayload(body, SECRET);

  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await postWebhook(app, body, signature);
    statuses.push(res.status);
  }

  const rateLimited = statuses.filter((s) => s === 429).length;
  assert.ok(rateLimited >= 2, `expected at least 2 of 5 requests to be rate-limited (max=3), got statuses: ${statuses}`);
});

test("healthz reports ok without requiring auth", async () => {
  const { deps } = buildDeps();
  const app = createApp(deps);
  const res = await request(app).get("/healthz");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
