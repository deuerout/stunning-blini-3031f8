#!/usr/bin/env node
/**
 * Manual end-to-end smoke test for the real GoCardless webhook code
 * (createApp's /webhooks/gocardless route from ../src/server.ts), run over
 * an actual HTTP request. Same approach as local-e2e-demo.js, adapted to
 * two real differences in how GoCardless webhooks work (see
 * gocardlessWebhookHandler.ts): one delivery carries a BATCH of events,
 * and the signature scheme has no timestamp component.
 *
 * This does NOT talk to GoCardless. There is no GoCardless account wired
 * up yet, so this generates its own webhook secret and signs a
 * GoCardless-shaped event batch with it exactly the way GoCardless's own
 * signing scheme works. See README.md for how to re-run this against a
 * real GoCardless sandbox account (free, no card required) once it
 * exists -- and for the one fact in this integration (the exact
 * mandate-activation action string) that still needs confirming against
 * a real sandbox event before this goes anywhere near production.
 *
 * Usage: node scripts/local-gocardless-e2e-demo.js   (run `npm run build` first)
 */
"use strict";

const http = require("http");
const crypto = require("crypto");

const { createApp } = require("../dist/src/server");
const { InMemoryIdempotencyStore } = require("../dist/src/idempotencyStore");
const { StaticCustomerLookup } = require("../dist/src/customerLookup");
const { StaticGoCardlessCustomerLookup } = require("../dist/src/gocardlessCustomerLookup");
const { InMemoryActionLog } = require("../dist/src/actionLog");

class LoggingEmailProvider {
  async send(message) {
    console.log(`  [email]     -> ${message.to} :: "${message.subject}" (idempotencyKey=${message.idempotencyKey})`);
    return { providerMessageId: `demo-${Date.now()}` };
  }
}

/** Same compression approach as local-e2e-demo.js's DemoScheduler -- see that file for why. */
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
    setTimeout(() => {
      this.pending -= 1;
      job().catch((err) => console.error("  [scheduler] job failed:", err));
    }, demoDelayMs);
  }
}

function signGoCardlessPayload(rawBody, secret) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function postWebhook(port, rawBody, signature) {
  const res = await fetch(`http://localhost:${port}/webhooks/gocardless`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Webhook-Signature": signature },
    body: rawBody,
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  console.log(`Generated a demo-only webhook secret (not from GoCardless): ${webhookSecret.slice(0, 12)}...\n`);

  const actionLog = new InMemoryActionLog();
  const scheduler = new DemoScheduler(900000, 15000);

  // /webhooks/stripe still has to be given deps -- createApp always mounts
  // it -- but nothing in this demo touches it.
  const stripeDeps = {
    webhookSecret: "unused-in-this-demo",
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticCustomerLookup({}),
    emailProvider: new LoggingEmailProvider(),
    scheduler: new DemoScheduler(900000, 15000),
    actionLog: new InMemoryActionLog(),
  };

  const gcDeps = {
    webhookSecret,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StaticGoCardlessCustomerLookup({ CU_demo1: "demo-client@example.com", CU_demo2: "second-client@example.com" }),
    emailProvider: new LoggingEmailProvider(),
    scheduler,
    actionLog,
  };

  const app = createApp(stripeDeps, undefined, gcDeps);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Real HTTP server listening on http://localhost:${port} (actual createApp() from src/server.ts)\n`);

  console.log("--- Delivering a batch with two mandate-active events (one delivery, two clients) ---");
  const batch = JSON.stringify({
    events: [
      { id: "EV_demo_1", resource_type: "mandates", action: "active", links: { mandate: "MD_demo_1", customer: "CU_demo1" }, created_at: new Date().toISOString() },
      { id: "EV_demo_2", resource_type: "mandates", action: "active", links: { mandate: "MD_demo_2", customer: "CU_demo2" }, created_at: new Date().toISOString() },
    ],
    meta: { webhook_id: "WH_demo_1" },
  });
  const signature = signGoCardlessPayload(batch, webhookSecret);
  const first = await postWebhook(port, batch, signature);
  console.log(`  -> HTTP ${first.status} ${JSON.stringify(first.body)}\n`);

  console.log("--- Re-delivering the same batch (simulating a GoCardless retry) ---");
  const second = await postWebhook(port, batch, signature);
  console.log(`  -> HTTP ${second.status} ${JSON.stringify(second.body)} (must NOT re-send either Day 0 email)\n`);

  console.log("--- Delivering with a bad signature (should be rejected 498, GoCardless's own 'stop retrying' convention) ---");
  const bad = await postWebhook(port, batch, "0".repeat(64));
  console.log(`  -> HTTP ${bad.status} ${JSON.stringify(bad.body)}\n`);

  console.log("--- Delivering a non-mandate-activation event (should be acknowledged, nothing sent) ---");
  const irrelevant = JSON.stringify({
    events: [{ id: "EV_demo_3", resource_type: "mandates", action: "cancelled", links: { mandate: "MD_demo_1", customer: "CU_demo1" }, created_at: new Date().toISOString() }],
    meta: { webhook_id: "WH_demo_2" },
  });
  const irrelevantRes = await postWebhook(port, irrelevant, signGoCardlessPayload(irrelevant, webhookSecret));
  console.log(`  -> HTTP ${irrelevantRes.status} ${JSON.stringify(irrelevantRes.body)}\n`);

  console.log("Waiting for the compressed schedule to fire...\n");
  await new Promise((r) => setTimeout(r, 20000));

  console.log("--- Action log: what an owner's periodic review would see ---");
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
