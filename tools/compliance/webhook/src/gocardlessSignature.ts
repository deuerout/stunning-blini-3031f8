/**
 * GoCardless's webhook signature scheme (documented at
 * https://docs.gocardless.com/api-reference/#appendix-webhooks), verified
 * against the live docs while building this:
 *
 *   Webhook-Signature header: hex(HMAC-SHA256(webhookSecret, rawBody))
 *
 * Unlike Stripe's scheme (stripeSignature.ts), there is NO timestamp
 * component -- the signature covers only the raw body. That means this
 * check alone gives no replay protection; the event-id dedupe in
 * gocardlessWebhookHandler.ts (required by GoCardless's own docs, since
 * they also don't guarantee exactly-once delivery) is doing double duty
 * as the anti-replay measure here, not just idempotency.
 *
 * GoCardless's own convention: return HTTP 498 for a signature failure
 * specifically, so they stop retrying instead of hammering an endpoint
 * that will reject that same payload every time (see webhookHandler's use
 * of this).
 */
import * as crypto from "crypto";

export class SignatureVerificationError extends Error {}

export function verifyGoCardlessSignature(rawBody: Buffer, signatureHeader: string | undefined, webhookSecret: string): void {
  if (!signatureHeader) {
    throw new SignatureVerificationError("missing Webhook-Signature header");
  }
  if (!webhookSecret) {
    throw new SignatureVerificationError("webhook secret is not configured");
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  let candidateBuf: Buffer;
  try {
    candidateBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    throw new SignatureVerificationError("malformed Webhook-Signature header (not valid hex)");
  }

  if (candidateBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
    throw new SignatureVerificationError("signature mismatch -- request body does not match Webhook-Signature");
  }
}
