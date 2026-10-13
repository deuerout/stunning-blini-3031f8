import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGoCardlessSignature, SignatureVerificationError } from "../src/gocardlessSignature";
import { signGoCardlessPayload } from "./testHelpers";

const SECRET = "gc_test_secret_do_not_use_in_prod";

test("accepts a correctly signed body", () => {
  const body = Buffer.from('{"events":[]}', "utf8");
  const signature = signGoCardlessPayload(body.toString("utf8"), SECRET);
  assert.doesNotThrow(() => verifyGoCardlessSignature(body, signature, SECRET));
});

test("rejects when the body doesn't match the signature", () => {
  const signedBody = '{"events":[]}';
  const signature = signGoCardlessPayload(signedBody, SECRET);
  const tamperedBody = Buffer.from('{"events":[{"id":"EV_injected"}]}', "utf8");
  assert.throws(() => verifyGoCardlessSignature(tamperedBody, signature, SECRET), SignatureVerificationError);
});

test("rejects a missing signature header", () => {
  const body = Buffer.from('{"events":[]}', "utf8");
  assert.throws(() => verifyGoCardlessSignature(body, undefined, SECRET), /missing Webhook-Signature header/);
});

test("rejects when the wrong secret was used to sign", () => {
  const body = '{"events":[]}';
  const signature = signGoCardlessPayload(body, "a-different-secret");
  assert.throws(() => verifyGoCardlessSignature(Buffer.from(body, "utf8"), signature, SECRET), SignatureVerificationError);
});

test("rejects a non-hex signature header without throwing an unrelated error", () => {
  const body = Buffer.from('{"events":[]}', "utf8");
  assert.throws(() => verifyGoCardlessSignature(body, "not-hex-!!", SECRET), SignatureVerificationError);
});
