#!/usr/bin/env node
/**
 * Manual, no-external-dependencies end-to-end smoke test for the real
 * server code (createApp from ../src/server.ts), run over an actual HTTP
 * request -- not the in-process supertest calls the unit tests use.
 *
 * This does NOT talk to Stripe. There is no Stripe test account wired up
 * yet, so this generates its own webhook secret and signs a
 * Stripe-shaped event with it exactly the way Stripe's own signing scheme
 * works (see ../src/stripeSignature.ts) -- it proves the code path is
 * correct, not that Stripe's real infrastructure agrees with it. See
 * README.md in this directory for how to re-run this against real Stripe
 * test-mode traffic once test credentials exist.
 *
 * To keep this runnable in seconds instead of real days, schedule delays
 * are compressed (DemoScheduler below) -- production (src/server.ts's
 * createServerFromEnv) uses the real, uncompressed InProcessScheduler.
 *
 * Usage: node scripts/local-e2e-demo.js   (run `npm run build` first)
 */
"use strict";

const http = require("http");
const crypto = require("crypto");

const { createApp } = require("../dist/src/server");
const { InMemoryIdempotencyStore } = require("../dist/src/idempotencyStore");
const { StaticCustomerLookup } = require("../dist/src/customerLookup");
const { InMemoryActionLog } = require("../dist/src/actionLog");

class LoggingEmailProvider {
  async send(message) {
    console.log(`  [email]     -> ${message.to} :: "${message.subject}" (idempotencyKey=${message.idempotencyKey})`);
    return { providerMessageId: `demo-${Date.now()}` };
  }
}

/**
 * Compresses real schedule delays (days/months) into seconds so the
 * onboarding sequence and the license lifecycle's quarterly/annual cadence
 * are observable in this demo without literally waiting. Every send is
 * still the real code in emailSequence.ts / clientLifecycle.ts -- only the
 * clock is sped up.
 */
class DemoScheduler {
  constructor(compressionFactor, capMs) {
    this.compressionFactor = compressionFactor;
    this.capMs = capMs;
    this.pending = 0;
  }
  scheduleAt(runAt, job) {
    const realDelayMs = Math.max(0, runAt.getTime() - Date.now());
    const demoDelayMs = Math.min(Math.round(realDelayMs / this.compressionFactor), this.capMs);
    this.pending += 1;
    const realDays = (realDelayMs / 86400000).toFixed(1);
    console.log(`  [scheduler] job for ${runAt.toISOString()} (${realDays}d out) -> compressed to ${demoDelayMs}ms for this demo`);
    setTimeout(() => {
      this.pending -= 1;
      job().catch((err) => console.error("  [scheduler] job failed:", err));
    }, demoDelayMs);
  }
}

function signStripePayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

async function postWebhook(port, rawBody, signature) {
  const res = await fetch(`http://localhost:${port}/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: rawBody,
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  console.log(`Generated a demo-only webhook secret (not from Stripe): ${webhookSecret.slice(0, 12)}...\n`);

  const actionLog = new InMemoryActionLog();
  const scheduler = new DemoScheduler(900000, 15000); // ~91 real days -> ~8.7s demo delay, capped at 15s

  const deps = {
    webhookSecret,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({ cus_demo123: "demo-client@example.com" }),
    emailProvider: new LoggingEmailProvider(),
    scheduler,
    actionLog,
  };

  const app = createApp(deps);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Real HTTP server listening on http://localhost:${port} (actual createApp() from src/server.ts)\n`);

  const event = {
    id: "evt_demo_1",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_demo_1", customer: "cus_demo123", status: "active" } },
  };
  const rawBody = JSON.stringify(event);
  const signature = signStripePayload(rawBody, webhookSecret);

  console.log("--- Delivering a signed subscription-activation event ---");
  const first = await postWebhook(port, rawBody, signature);
  console.log(`  -> HTTP ${first.status} ${JSON.stringify(first.body)}\n`);

  console.log("--- Re-delivering the same event (simulating a Stripe retry) ---");
  const second = await postWebhook(port, rawBody, signature);
  console.log(`  -> HTTP ${second.status} ${JSON.stringify(second.body)} (must NOT re-send the Day 0 email)\n`);

  console.log("--- Delivering with a bad signature (should be rejected) ---");
  const badSig = "t=1234567890,v1=" + "0".repeat(64);
  const bad = await postWebhook(port, rawBody, badSig);
  console.log(`  -> HTTP ${bad.status} ${JSON.stringify(bad.body)}\n`);

  console.log("Waiting for the compressed schedule to fire (onboarding Day 3/7/14/30, first quarterly royalty reminder, first renewal quote)...\n");
  console.log("(the quarterly/renewal jobs are self-rescheduling by design -- see clientLifecycle.ts -- so this demo cuts off after a fixed window rather than waiting for them to stop, which they never do)\n");

  // Fixed window, not "wait until nothing is pending": both the onboarding
  // sequence and the license lifecycle deliberately reschedule themselves
  // (that's the point -- a real subscription runs for years), so
  // `scheduler.pending` never reaches 0 on its own.
  await new Promise((r) => setTimeout(r, 20000));

  console.log("\n--- Action log: what an owner's periodic review would see ---");
  if (actionLog.actions.length === 0) {
    console.log("  (nothing fired within the demo window)");
  }
  for (const a of actionLog.actions) {
    console.log(`  ${a.occurredAt.toISOString()}  ${a.actionType}  ${a.recipientEmail}  ${JSON.stringify(a.detail)}`);
  }

  server.close();
  console.log("\nDone. Exiting explicitly -- the compressed self-rescheduling timers above would otherwise keep this process alive indefinitely.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
