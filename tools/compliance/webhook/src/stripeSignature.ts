/**
 * Manual implementation of Stripe's webhook signature scheme, so this
 * project doesn't need to pull in the full `stripe` SDK for one HMAC check.
 * (For a production integration that also calls the Stripe API elsewhere,
 * prefer `stripe.webhooks.constructEvent` from the official SDK instead --
 * it's the same algorithm, but stays in sync with any future scheme
 * changes without this file needing to track them.)
 *
 * Scheme (documented at https://docs.stripe.com/webhooks#verify-manually):
 *   Stripe-Signature header: "t=<unix ts>,v1=<hex hmac>[,v1=<hex hmac>...]"
 *   expected v1 = HMAC-SHA256(webhookSecret, `${t}.${rawBody}`)
 *
 * Verification MUST run against the raw, unparsed request body -- if the
 * body has already been JSON.parse'd and re-serialized, whitespace/key
 * ordering differences will make every signature check fail (or, worse,
 * a naive re-implementation might skip verification "since it doesn't
 * work" -- don't do that; fix the body handling instead, see server.ts).
 */
import * as crypto from "crypto";

export class SignatureVerificationError extends Error {}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60; // reject events older than 5 minutes (replay protection)

export interface VerifyOptions {
  toleranceSeconds?: number;
  now?: () => number; // injectable for testing
}

export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
  options: VerifyOptions = {}
): void {
  if (!signatureHeader) {
    throw new SignatureVerificationError("missing Stripe-Signature header");
  }
  if (!webhookSecret) {
    throw new SignatureVerificationError("webhook secret is not configured");
  }

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || value === undefined) return acc;
    (acc[key] = acc[key] || []).push(value);
    return acc;
  }, {});

  const timestampStr = parts["t"]?.[0];
  const v1Signatures = parts["v1"] || [];

  if (!timestampStr || v1Signatures.length === 0) {
    throw new SignatureVerificationError("malformed Stripe-Signature header");
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) {
    throw new SignatureVerificationError("malformed timestamp in Stripe-Signature header");
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = (options.now ?? (() => Date.now()))();
  const ageSeconds = Math.abs(now / 1000 - timestamp);
  if (ageSeconds > tolerance) {
    throw new SignatureVerificationError(
      `event timestamp outside tolerance (${ageSeconds.toFixed(0)}s old, max ${tolerance}s) -- possible replay`
    );
  }

  const signedPayload = `${timestampStr}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  const matched = v1Signatures.some((candidate) => {
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, "hex");
    } catch {
      return false;
    }
    // timingSafeEqual throws if lengths differ -- guard explicitly rather
    // than letting a length mismatch (which is itself attacker-observable
    // timing information otherwise) throw an unhandled error.
    if (candidateBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(candidateBuf, expectedBuf);
  });

  if (!matched) {
    throw new SignatureVerificationError("signature mismatch -- request body does not match any provided v1 signature");
  }
}
