import * as crypto from "crypto";
import request from "supertest";
import { Express } from "express";
import { Scheduler } from "../src/scheduler";

/** POSTs a webhook body with the Content-Type Stripe always actually sends.
 * Without this, express.raw({type: "application/json"}) never captures the
 * body as a Buffer (superagent's .send(string) defaults to text/plain),
 * and every signature check fails regardless of whether the signature
 * itself is correct -- a test-harness gotcha, not a handler bug. */
export function postWebhook(app: Express, body: string, signatureHeader: string) {
  return request(app)
    .post("/webhooks/stripe")
    .set("Stripe-Signature", signatureHeader)
    .set("Content-Type", "application/json")
    .send(body);
}

/** Builds a valid Stripe-Signature header per the documented scheme,
 * independently of the production verifier -- this is testing against the
 * spec Stripe publishes, not just mirroring stripeSignature.ts. */
export function signStripePayload(rawBody: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export interface ScheduledJob {
  runAt: Date;
  job: () => Promise<void>;
}

/** Records scheduled jobs instead of running them on a real timer, so
 * tests can assert on the Day 3/7/14/30 schedule and (optionally) fire a
 * job manually to simulate the time arriving, without waiting real days. */
export class FakeScheduler implements Scheduler {
  public scheduled: ScheduledJob[] = [];
  scheduleAt(runAt: Date, job: () => Promise<void>): void {
    this.scheduled.push({ runAt, job });
  }
}

export function subscriptionActiveEvent(opts: {
  eventId: string;
  eventType?: "customer.subscription.created" | "customer.subscription.updated";
  subscriptionId: string;
  customerId: string;
  status?: string;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    type: opts.eventType ?? "customer.subscription.updated",
    data: {
      object: {
        id: opts.subscriptionId,
        customer: opts.customerId,
        status: opts.status ?? "active",
      },
    },
  });
}
