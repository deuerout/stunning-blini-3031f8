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
