import { test } from "node:test";
import assert from "node:assert/strict";
import { enrollSequence, ONBOARDING_SEQUENCE } from "../src/emailSequence";
import { NullEmailProvider } from "../src/emailProvider";
import { FakeScheduler } from "./testHelpers";

test("enrollSequence sends Day 0 immediately and schedules the other 4 steps at correct offsets", async () => {
  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");

  await enrollSequence(
    { email: "customer@acme.example", customerId: "cus_123", subscriptionId: "sub_123" },
    { provider, scheduler, now: () => fixedNow }
  );

  assert.equal(provider.sent.length, 1, "Day 0 email should be sent synchronously during enrollment");
  assert.equal(provider.sent[0].subject, ONBOARDING_SEQUENCE[0].subject);
  assert.equal(provider.sent[0].idempotencyKey, "sub_123-day0");

  assert.equal(scheduler.scheduled.length, 4, "the remaining 4 steps (days 3, 7, 14, 30) should be scheduled, not sent yet");
  const expectedOffsets = [3, 7, 14, 30];
  scheduler.scheduled.forEach((s, i) => {
    const expectedRunAt = new Date(fixedNow.getTime() + expectedOffsets[i] * 24 * 60 * 60 * 1000);
    assert.equal(s.runAt.getTime(), expectedRunAt.getTime(), `step ${i} should be scheduled for day ${expectedOffsets[i]}`);
  });
});

test("scheduled jobs, when fired, send the correct email with the correct idempotency key", async () => {
  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();

  await enrollSequence(
    { email: "customer@acme.example", customerId: "cus_456", subscriptionId: "sub_456" },
    { provider, scheduler }
  );

  // Simulate "Day 3" arriving by manually firing the first scheduled job.
  await scheduler.scheduled[0].job();

  assert.equal(provider.sent.length, 2, "Day 0 (immediate) + Day 3 (fired) = 2 emails sent so far");
  assert.equal(provider.sent[1].idempotencyKey, "sub_456-day3");
  assert.equal(provider.sent[1].subject, ONBOARDING_SEQUENCE[1].subject);
});

test("a provider send failure on Day 0 propagates (so the webhook handler can respond 500 and let Stripe retry)", async () => {
  const failingProvider = {
    send: async () => {
      throw Object.assign(new Error("simulated provider outage"), { retryable: true });
    },
  };
  const scheduler = new FakeScheduler();

  await assert.rejects(
    () =>
      enrollSequence(
        { email: "customer@acme.example", customerId: "cus_789", subscriptionId: "sub_789" },
        { provider: failingProvider as never, scheduler }
      ),
    /simulated provider outage/
  );
});
