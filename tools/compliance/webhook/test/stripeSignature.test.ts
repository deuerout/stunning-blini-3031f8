import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyStripeSignature, SignatureVerificationError } from "../src/stripeSignature";
import { signStripePayload } from "./testHelpers";

const SECRET = "whsec_test_secret_do_not_use_in_prod";

test("accepts a correctly signed payload", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const header = signStripePayload(body.toString("utf8"), SECRET);
  assert.doesNotThrow(() => verifyStripeSignature(body, header, SECRET));
});

test("rejects a payload signed with the wrong secret", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const header = signStripePayload(body.toString("utf8"), "wrong_secret");
  assert.throws(() => verifyStripeSignature(body, header, SECRET), SignatureVerificationError);
});

test("rejects a payload that was tampered with after signing", () => {
  const originalBody = JSON.stringify({ amount: 100 });
  const header = signStripePayload(originalBody, SECRET);
  const tamperedBody = Buffer.from(JSON.stringify({ amount: 999999 }));
  assert.throws(() => verifyStripeSignature(tamperedBody, header, SECRET), SignatureVerificationError);
});

test("rejects a missing signature header", () => {
  const body = Buffer.from("{}");
  assert.throws(() => verifyStripeSignature(body, undefined, SECRET), SignatureVerificationError);
});

test("rejects a malformed signature header", () => {
  const body = Buffer.from("{}");
  assert.throws(() => verifyStripeSignature(body, "not-a-valid-header", SECRET), SignatureVerificationError);
});

test("rejects a stale timestamp outside tolerance (replay protection)", () => {
  const body = JSON.stringify({ hello: "world" });
  const staleTimestamp = Math.floor(Date.now() / 1000) - 60 * 60; // 1 hour old
  const header = signStripePayload(body, SECRET, staleTimestamp);
  assert.throws(() => verifyStripeSignature(Buffer.from(body), header, SECRET), /replay/);
});

test("accepts a timestamp within tolerance", () => {
  const body = JSON.stringify({ hello: "world" });
  const recentTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute old
  const header = signStripePayload(body, SECRET, recentTimestamp);
  assert.doesNotThrow(() => verifyStripeSignature(Buffer.from(body), header, SECRET));
});

test("accepts when at least one of multiple v1 signatures matches (Stripe secret rotation support)", () => {
  const body = JSON.stringify({ hello: "world" });
  const timestamp = Math.floor(Date.now() / 1000);
  const validHeader = signStripePayload(body, SECRET, timestamp);
  const validV1 = validHeader.split(",")[1];
  const bogusV1 = "v1=" + "0".repeat(64);
  const combinedHeader = `t=${timestamp},${bogusV1},${validV1}`;
  assert.doesNotThrow(() => verifyStripeSignature(Buffer.from(body), combinedHeader, SECRET));
});
