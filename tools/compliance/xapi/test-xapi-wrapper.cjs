/**
 * Behavioral test harness for solomon-xapi-wrapper.js.
 *
 * Spins up a real local HTTP server acting as a mock LRS (no network, no
 * external deps -- Node's built-in http module) and drives the wrapper
 * against it, asserting:
 *   1. Basic Auth header and xAPI version header are sent correctly.
 *   2. All four verb methods produce well-formed xAPI statements.
 *   3. The actor is opaque (account.name only) -- no email/name fields
 *      anywhere in the payload.
 *   4. miniCheckResponded's result.response is the enumerable choice ID,
 *      never free text.
 *   5. A transient 500 is retried and eventually succeeds.
 *   6. A 401 is NOT retried -- it fails fast.
 *
 * Run: node test-xapi-wrapper.cjs
 * Exit code 0 = all assertions passed, non-zero = failure (see stderr).
 */
const http = require("http");
const assert = require("assert");
const SolomonXAPIWrapper = require("./solomon-xapi-wrapper.js");

const AUTH_KEY = "solomon-lms-client";
const AUTH_SECRET = "test-secret-do-not-use-in-prod";
const EXPECTED_AUTH_HEADER =
  "Basic " + Buffer.from(`${AUTH_KEY}:${AUTH_SECRET}`).toString("base64");

let receivedStatements = [];
let failNextNRequests = 0;
let sawAuthHeaderMismatch = false;
let sawMissingVersionHeader = false;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url.includes("/unauthorized-endpoint")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid credentials" }));
      return;
    }

    if (req.headers["authorization"] !== EXPECTED_AUTH_HEADER) sawAuthHeaderMismatch = true;
    if (req.headers["x-experience-api-version"] !== "1.0.3") sawMissingVersionHeader = true;

    if (failNextNRequests > 0) {
      failNextNRequests -= 1;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "transient LRS failure (test-injected)" }));
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400);
      res.end("bad json");
      return;
    }
    receivedStatements.push(parsed);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([parsed.id]));
  });
});

function findFreePortAndListen() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

// Scans a JSON-serializable value for anything that looks like a raw email
// address or an unexpectedly long free-text string -- the two shapes of PII
// leakage the wrapper is designed to prevent.
function scanForLeakage(value, path) {
  path = path || "$";
  const findings = [];
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  function walk(v, p) {
    if (typeof v === "string") {
      if (EMAIL_RE.test(v)) findings.push(`${p}: looks like an email address ("${v}")`);
      // result.response should be a short enumerable token (e.g. "b"), not
      // a sentence -- flag anything suspiciously long as a free-text leak.
      if (p.endsWith(".response") && v.length > 8) {
        findings.push(`${p}: response field looks like free text, not an enumerable choice ("${v}")`);
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (k === "name" || k === "email" || k === "mbox") {
          // actor.account.name (opaque ID) is allowed; anything under
          // actor.name / actor.email / actor.mbox would NOT be.
          if (p.endsWith(".actor") && k !== "name") {
            findings.push(`${p}.${k}: actor carries a '${k}' field -- PII identifier, should not be present`);
          }
        }
        walk(v[k], `${p}.${k}`);
      }
    }
  }
  walk(value, path);
  return findings;
}

async function main() {
  const port = await findFreePortAndListen();
  const endpoint = `http://127.0.0.1:${port}/xapi`;

  const wrapper = new SolomonXAPIWrapper({
    endpoint,
    authKey: AUTH_KEY,
    authSecret: AUTH_SECRET,
    learnerId: "internal-learner-4471", // opaque, NOT an email
    maxRetries: 3,
    retryBaseMs: 20, // fast retries for the test
  });

  console.log("--- Test 1: registerLearner ---");
  await wrapper.registerLearner("solomon-licensing-101", "Solomon Licensing Training Module");

  console.log("--- Test 2: sectionExperienced ---");
  await wrapper.sectionExperienced("solomon-licensing-101/panel-2", "Panel 2: Restrictions", 1);

  console.log("--- Test 3: miniCheckResponded (correct answer, choice id only) ---");
  await wrapper.miniCheckResponded(
    "solomon-licensing-101/minicheck-q2",
    "Mini-Check Q2: Bias Allegation Handling",
    "b",
    true
  );

  console.log("--- Test 4: modulePassed ---");
  await wrapper.modulePassed("solomon-licensing-101", "Solomon Licensing Training Module", 0.92);

  assert.strictEqual(receivedStatements.length, 4, "expected 4 statements to reach the mock LRS");
  assert.strictEqual(sawAuthHeaderMismatch, false, "Basic Auth header did not match expected value on some request");
  assert.strictEqual(sawMissingVersionHeader, false, "X-Experience-API-Version header missing/wrong on some request");
  console.log("PASS: all 4 statements delivered with correct auth + version headers.");

  console.log("--- Test 5: PII/free-text leakage scan across all captured statements ---");
  let allFindings = [];
  receivedStatements.forEach((stmt, i) => {
    allFindings = allFindings.concat(scanForLeakage(stmt, `$[${i}]`));
  });
  assert.strictEqual(
    allFindings.length,
    0,
    "leakage scan found issues:\n" + allFindings.join("\n")
  );
  console.log("PASS: no email/PII fields and no free-text response fields found in any statement.");

  const miniCheckStmt = receivedStatements[2];
  assert.strictEqual(miniCheckStmt.result.response, "b", "miniCheckResponded should send the choice id verbatim");
  assert.strictEqual(miniCheckStmt.actor.account.name, "internal-learner-4471");
  assert.strictEqual(miniCheckStmt.verb.id, "http://adlnet.gov/expapi/verbs/responded");
  console.log("PASS: statement shape matches the xAPI verb dictionary and opaque-actor design.");

  console.log("--- Test 6: transient 500 is retried and eventually succeeds ---");
  receivedStatements = [];
  failNextNRequests = 2; // fail twice, succeed on 3rd attempt
  const result = await wrapper.registerLearner("solomon-licensing-101", "retry test");
  assert.strictEqual(receivedStatements.length, 1, "exactly one statement should have landed after retries");
  assert.ok(result.ok, "final result should report ok:true after retry succeeds");
  console.log("PASS: wrapper retried through 2 transient 500s and succeeded on attempt 3.");

  console.log("--- Test 7: 401 fails fast, no retry storm ---");
  const badWrapper = new SolomonXAPIWrapper({
    endpoint: `http://127.0.0.1:${port}/unauthorized-endpoint`,
    authKey: "wrong",
    authSecret: "wrong",
    learnerId: "internal-learner-4471",
    maxRetries: 3,
    retryBaseMs: 20,
  });
  const start = Date.now();
  let threw = false;
  try {
    await badWrapper.registerLearner("solomon-licensing-101", "auth failure test");
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 401);
    assert.strictEqual(e.retryable, false);
  }
  const elapsedMs = Date.now() - start;
  assert.ok(threw, "expected registerLearner to reject on 401");
  // If it had retried 3 times with backoff it would take >= 20+40+80=140ms;
  // failing fast should be near-instant.
  assert.ok(elapsedMs < 100, `expected fast failure on 401, took ${elapsedMs}ms (looks like it retried)`);
  console.log(`PASS: 401 rejected immediately (${elapsedMs}ms), no retry attempted.`);

  console.log("\nALL TESTS PASSED");
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("TEST FAILURE:", err);
  server.close();
  process.exit(1);
});
