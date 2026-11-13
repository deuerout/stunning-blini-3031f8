import { test } from "node:test";
import assert from "node:assert/strict";
import { enrollLicenseLifecycle, DEFAULT_LICENSE_TERMS } from "../src/clientLifecycle";
import { NullEmailProvider } from "../src/emailProvider";
import { InMemoryActionLog } from "../src/actionLog";
import { FakeScheduler } from "./testHelpers";

const RECIPIENT = { email: "customer@acme.example", customerId: "cus_123", subscriptionId: "sub_123" };

test("enrollLicenseLifecycle schedules the first quarterly reminder 91 days out and nothing sends synchronously", () => {
  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();
  const actionLog = new InMemoryActionLog();
  const effectiveDate = new Date("2026-01-01T00:00:00.000Z");

  enrollLicenseLifecycle(RECIPIENT, effectiveDate, DEFAULT_LICENSE_TERMS, { provider, scheduler, actionLog });

  assert.equal(provider.sent.length, 0, "nothing should send synchronously at enrollment");
  assert.equal(scheduler.scheduled.length, 2, "first quarterly reminder + first renewal quote should be scheduled");

  const expectedQuarter = new Date(effectiveDate.getTime() + 91 * 24 * 60 * 60 * 1000);
  assert.equal(scheduler.scheduled[0].runAt.getTime(), expectedQuarter.getTime());

  // DEFAULT_LICENSE_TERMS is a 1-year initial term; renewal quote goes out 60 days before the 1-year anniversary.
  const renewalDate = new Date(effectiveDate);
  renewalDate.setUTCFullYear(renewalDate.getUTCFullYear() + 1);
  const expectedQuoteRunAt = new Date(renewalDate.getTime() - 60 * 24 * 60 * 60 * 1000);
  assert.equal(scheduler.scheduled[1].runAt.getTime(), expectedQuoteRunAt.getTime());
});

test("firing the quarterly reminder sends the email, logs the action, and reschedules the next quarter", async () => {
  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();
  const actionLog = new InMemoryActionLog();
  const effectiveDate = new Date("2026-01-01T00:00:00.000Z");

  enrollLicenseLifecycle(RECIPIENT, effectiveDate, DEFAULT_LICENSE_TERMS, { provider, scheduler, actionLog });

  const quarterlyJob = scheduler.scheduled[0];
  await quarterlyJob.job();

  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].to, RECIPIENT.email);
  assert.equal(provider.sent[0].idempotencyKey, "sub_123-royalty-report-q1");

  assert.equal(actionLog.actions.length, 1);
  assert.equal(actionLog.actions[0].actionType, "royalty_report_reminder_sent");
  assert.equal(actionLog.actions[0].subscriptionId, "sub_123");

  // Firing the job should have scheduled quarter 2's reminder.
  assert.equal(scheduler.scheduled.length, 3, "renewal quote job + quarter 1 job (fired) + newly scheduled quarter 2 job");
  const quarter2 = scheduler.scheduled[2];
  const expectedQuarter2RunAt = new Date(quarterlyJob.runAt.getTime() + 91 * 24 * 60 * 60 * 1000);
  assert.equal(quarter2.runAt.getTime(), expectedQuarter2RunAt.getTime());
});

test("firing the renewal quote sends the email, logs the action, and reschedules the next renewal cycle", async () => {
  const provider = new NullEmailProvider();
  const scheduler = new FakeScheduler();
  const actionLog = new InMemoryActionLog();
  const effectiveDate = new Date("2026-01-01T00:00:00.000Z");

  enrollLicenseLifecycle(RECIPIENT, effectiveDate, DEFAULT_LICENSE_TERMS, { provider, scheduler, actionLog });

  const renewalJob = scheduler.scheduled[1];
  await renewalJob.job();

  assert.equal(provider.sent.length, 1);
  assert.equal(actionLog.actions[0].actionType, "renewal_quote_sent");

  // With a 1-year initial term and 1-year renewal term, the next renewal quote fires 60 days before the 2-year anniversary.
  const secondRenewalDate = new Date(effectiveDate);
  secondRenewalDate.setUTCFullYear(secondRenewalDate.getUTCFullYear() + 2);
  const expectedNextQuoteRunAt = new Date(secondRenewalDate.getTime() - 60 * 24 * 60 * 60 * 1000);

  assert.equal(scheduler.scheduled.length, 3, "quarterly job + renewal job (fired) + newly scheduled next renewal job");
  assert.equal(scheduler.scheduled[2].runAt.getTime(), expectedNextQuoteRunAt.getTime());
});
