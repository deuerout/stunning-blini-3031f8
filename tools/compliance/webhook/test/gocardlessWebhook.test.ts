import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server";
import { WebhookDeps } from "../src/webhookHandler";
import { GoCardlessWebhookDeps } from "../src/gocardlessWebhookHandler";
import { InMemoryIdempotencyStore } from "../src/idempotencyStore";
import { NullEmailProvider } from "../src/emailProvider";
import { StaticCustomerLookup } from "../src/customerLookup";
import { StaticGoCardlessCustomerLookup } from "../src/gocardlessCustomerLookup";
import { InMemoryActionLog } from "../src/actionLog";
import { signGoCardlessPayload, mandateEventBatch, FakeScheduler, postGoCardlessWebhook } from "./testHelpers";

const STRIPE_SECRET = "whsec_test_secret_do_not_use_in_prod";
const GC_SECRET = "gc_test_secret_do_not_use_in_prod";

function buildApp() {
  const stripeDeps: WebhookDeps = {
    webhookSecret: STRIPE_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({}),
    emailProvider: new NullEmailProvider(),
    scheduler: new FakeScheduler(),
    actionLog: new InMemoryActionLog(),
  };

  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();
  const actionLog = new InMemoryActionLog();
  const gcDeps: GoCardlessWebhookDeps = {
    webhookSecret: GC_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticGoCardlessCustomerLookup({ CU001: "customer@acme.example" }),
    emailProvider: provider,
    scheduler,
    actionLog,
  };

  const app = createApp(stripeDeps, undefined, gcDeps);
  return { app, provider, scheduler, actionLog, gcDeps };
}

test("a mandate-active event enrolls the customer and returns 200", async () => {
  const { app, provider, scheduler } = buildApp();
  const body = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU001" }]);
  const signature = signGoCardlessPayload(body, GC_SECRET);

  const res = await postGoCardlessWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { processed: 1 });
  assert.equal(provider.sent.length, 1, "Day 0 onboarding email should have been sent");
  assert.equal(provider.sent[0].to, "customer@acme.example");
  assert.equal(scheduler.scheduled.length, 6, "onboarding days 3/7/14/30 (4) + first quarterly reminder + first renewal quote (2)");
});

test("a batch with multiple mandate-active events enrolls each customer once", async () => {
  const provider = new NullEmailProvider();
  const gcDeps: GoCardlessWebhookDeps = {
    webhookSecret: GC_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticGoCardlessCustomerLookup({ CU001: "one@acme.example", CU002: "two@acme.example" }),
    emailProvider: provider,
    scheduler: new FakeScheduler(),
    actionLog: new InMemoryActionLog(),
  };
  const stripeDeps: WebhookDeps = {
    webhookSecret: STRIPE_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({}),
    emailProvider: new NullEmailProvider(),
    scheduler: new FakeScheduler(),
    actionLog: new InMemoryActionLog(),
  };
  const app = createApp(stripeDeps, undefined, gcDeps);

  const body = mandateEventBatch([
    { eventId: "EV1", mandateId: "MD1", customerId: "CU001" },
    { eventId: "EV2", mandateId: "MD2", customerId: "CU002" },
  ]);
  const signature = signGoCardlessPayload(body, GC_SECRET);

  const res = await postGoCardlessWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { processed: 2 });
  assert.equal(provider.sent.length, 2);
  assert.deepEqual(
    provider.sent.map((m) => m.to).sort(),
    ["one@acme.example", "two@acme.example"]
  );
});

test("re-delivering the same batch (a GoCardless retry) does not re-enroll anyone", async () => {
  const { app, provider } = buildApp();
  const body = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU001" }]);
  const signature = signGoCardlessPayload(body, GC_SECRET);

  await postGoCardlessWebhook(app, body, signature);
  const second = await postGoCardlessWebhook(app, body, signature);

  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { processed: 1 });
  assert.equal(provider.sent.length, 1, "the duplicate delivery must not trigger a second Day 0 send");
});

test("two different events for the same mandate only enroll once", async () => {
  const { app, provider } = buildApp();
  const first = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU001" }]);
  const second = mandateEventBatch([{ eventId: "EV2", mandateId: "MD1", customerId: "CU001" }]);

  await postGoCardlessWebhook(app, first, signGoCardlessPayload(first, GC_SECRET));
  await postGoCardlessWebhook(app, second, signGoCardlessPayload(second, GC_SECRET));

  assert.equal(provider.sent.length, 1, "the same mandate must not be enrolled twice from two different events");
});

test("non-mandate-active events are acknowledged without sending any email", async () => {
  const { app, provider } = buildApp();
  const body = mandateEventBatch([{ eventId: "EV1", action: "created", mandateId: "MD1", customerId: "CU001" }]);
  const signature = signGoCardlessPayload(body, GC_SECRET);

  const res = await postGoCardlessWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { processed: 1 });
  assert.equal(provider.sent.length, 0);
});

test("a non-mandate resource_type is ignored even if the action happens to be 'active'", async () => {
  const { app, provider } = buildApp();
  const body = mandateEventBatch([{ eventId: "EV1", resourceType: "payments", action: "active", mandateId: "MD1", customerId: "CU001" }]);
  const signature = signGoCardlessPayload(body, GC_SECRET);

  const res = await postGoCardlessWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.equal(provider.sent.length, 0);
});

test("invalid signature is rejected with 498 (GoCardless's own convention -- 'do not retry this') and no email is sent", async () => {
  const { app, provider } = buildApp();
  const body = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU001" }]);

  const res = await postGoCardlessWebhook(app, body, "0".repeat(64));

  assert.equal(res.status, 498);
  assert.equal(provider.sent.length, 0);
});

test("unknown customer (no email on file) is acknowledged and skipped rather than retried forever", async () => {
  const { app, provider } = buildApp();
  const body = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU_unknown" }]);
  const signature = signGoCardlessPayload(body, GC_SECRET);

  const res = await postGoCardlessWebhook(app, body, signature);

  assert.equal(res.status, 200);
  assert.equal(provider.sent.length, 0);
});

test("a transient email-provider failure surfaces as 500 so GoCardless will retry delivery", async () => {
  const failingProvider = {
    send: async () => {
      throw new Error("simulated outage");
    },
  };
  const gcDeps: GoCardlessWebhookDeps = {
    webhookSecret: GC_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticGoCardlessCustomerLookup({ CU001: "customer@acme.example" }),
    emailProvider: failingProvider as never,
    scheduler: new FakeScheduler(),
    actionLog: new InMemoryActionLog(),
  };
  const stripeDeps: WebhookDeps = {
    webhookSecret: STRIPE_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({}),
    emailProvider: new NullEmailProvider(),
    scheduler: new FakeScheduler(),
    actionLog: new InMemoryActionLog(),
  };
  const app = createApp(stripeDeps, undefined, gcDeps);

  const body = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU001" }]);
  const res = await postGoCardlessWebhook(app, body, signGoCardlessPayload(body, GC_SECRET));

  assert.equal(res.status, 500);
});

test("the /webhooks/gocardless route is not mounted at all when no GoCardless deps are supplied", async () => {
  const stripeDeps: WebhookDeps = {
    webhookSecret: STRIPE_SECRET,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({}),
    emailProvider: new NullEmailProvider(),
    scheduler: new FakeScheduler(),
    actionLog: new InMemoryActionLog(),
  };
  const app = createApp(stripeDeps);

  const body = mandateEventBatch([{ eventId: "EV1", mandateId: "MD1", customerId: "CU001" }]);
  const res = await postGoCardlessWebhook(app, body, signGoCardlessPayload(body, GC_SECRET));

  assert.equal(res.status, 404);
});
