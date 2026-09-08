# scripts/

## local-e2e-demo.js

Manual end-to-end smoke test of the real server code (`createApp` from
`../src/server.ts`), run over an actual HTTP request rather than the
in-process `supertest` calls the unit tests use.

```
npm run build
node scripts/local-e2e-demo.js
```

It generates its own webhook secret and signs a Stripe-shaped event with
it, the same way Stripe signs real webhooks (`../src/stripeSignature.ts`).
**This does not talk to Stripe** — there is no Stripe test account wired up
yet, so it proves the code path is correct end to end, not that Stripe's
real infrastructure agrees with it. It exercises, against the real code:

- signature verification (valid, retried, and invalid deliveries)
- idempotency (the same event delivered twice only sends Day 0 once)
- the onboarding sequence (Days 0/3/7/14/30)
- the license lifecycle (quarterly royalty-report reminders, renewal
  quotes), including that it self-reschedules
- the action log an owner's periodic review would read

Schedule delays are compressed (see `DemoScheduler` in the script) purely
so the demo finishes in ~20 seconds instead of years — production
(`createServerFromEnv` in `../src/server.ts`) uses the real,
uncompressed `InProcessScheduler`.

## Running it against real Stripe test-mode traffic

Once there's a Stripe account for this business, the standard way to get a
genuine end-to-end run (real Stripe-issued signatures, real event
payloads) without pasting a secret API key anywhere is the Stripe CLI:

```
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe
# in another terminal, with the webhook secret `stripe listen` just printed:
STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_API_KEY=sk_test_... npm start
# in a third terminal:
stripe trigger customer.subscription.updated
```

`stripe listen` prints a `whsec_...` scoped to that local forwarding
session — it's disposable and never needs to be typed into a chat or
committed anywhere. `STRIPE_API_KEY` (`sk_test_...`, from the Stripe
Dashboard's Developers → API keys, test mode) is only needed for the real
customer-email lookup in `customerLookup.ts`.

## local-gocardless-e2e-demo.js

The same idea as `local-e2e-demo.js`, for the `/webhooks/gocardless` route
(`gocardlessWebhookHandler.ts`). Run it the same way:

```
npm run build
node scripts/local-gocardless-e2e-demo.js
```

It additionally exercises the two real ways GoCardless's webhooks differ
from Stripe's: one HTTP delivery carries a **batch** of events (the demo
sends two mandates activating in one delivery, both enrolled from a single
request), and a bad signature is rejected with **HTTP 498** — GoCardless's
own documented convention for "don't retry this, it will never verify" —
rather than the 400 the Stripe route uses.

**Before connecting this to anything real**, confirm the exact
`resource_type`/`action` pair GoCardless sends for "a mandate is now
active and can be collected against" — see the `*** VERIFY BEFORE GOING
LIVE ***` comment at the top of `../src/gocardlessWebhookHandler.ts`.
Conflicting documentation pages disagreed on the literal string
(`active` vs `mandate_activated`) during research for this integration;
`active` is what's implemented, on stronger confidence from GoCardless's
convention elsewhere (bare verbs per `resource_type`), but it's the one
fact in this file that wasn't independently confirmed. A GoCardless
**sandbox** account is free — no card, no business verification — so
this is a five-minute check: create a real customer + mandate in the
sandbox dashboard, watch the webhook log for the event that fires when it
activates, and read off the real `action` value.

## Running it against a real GoCardless sandbox

GoCardless's sandbox is the direct equivalent of Stripe test mode — free,
permanent, no card required to sign up. There's no CLI equivalent to
`stripe listen`, so the standard local-testing path is a tunnel:

```
# expose your local server (ngrok, cloudflared, or similar)
ngrok http 3000
# in the GoCardless Dashboard (sandbox environment):
#   Developers -> Webhooks -> Add endpoint -> the ngrok https URL + /webhooks/gocardless
#   copy the "Webhook secret" it generates
GOCARDLESS_WEBHOOK_SECRET=... GOCARDLESS_ACCESS_TOKEN=sandbox_... GOCARDLESS_ENVIRONMENT=sandbox \
STRIPE_WEBHOOK_SECRET=... STRIPE_API_KEY=... npm start
# then create a test customer + Direct Debit mandate in the sandbox
# dashboard (or via the API) and watch it activate
```

`GOCARDLESS_ACCESS_TOKEN` (from the Dashboard's Developers → Create
access token, sandbox environment) is only needed for the real
customer-email lookup in `gocardlessCustomerLookup.ts`. `createApp` only
mounts `/webhooks/gocardless` when both GoCardless env vars are set, so a
Stripe-only deployment doesn't need any of this configured.
