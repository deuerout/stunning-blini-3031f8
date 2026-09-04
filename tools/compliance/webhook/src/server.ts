import express, { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { handleStripeWebhook, WebhookDeps } from "./webhookHandler";

/**
 * Builds the Express app with injected dependencies, so tests can pass in
 * fakes (NullEmailProvider, InMemoryIdempotencyStore, etc.) instead of
 * hitting real services. `createServer()` at the bottom wires real
 * dependencies from environment variables for actual deployment.
 */
export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

// Stripe itself publishes a fixed set of source IPs and a legitimate
// account sends webhooks at a modest, bursty-but-bounded rate -- 60 req/min
// per source is generous headroom for real Stripe traffic while still
// capping the damage an attacker hammering this endpoint (to probe for a
// signature bypass, or to cause outbound-email cost/reputation damage if
// enrollment logic ever had a bug) can do. Consider also allow-listing
// Stripe's published webhook IP ranges at the network/firewall layer for
// defense in depth -- rate limiting alone is not an auth boundary.
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { windowMs: 60 * 1000, max: 60 };

export function createApp(deps: WebhookDeps, rateLimitOptions: RateLimitOptions = DEFAULT_RATE_LIMIT): Express {
  const app = express();

  // Trust one hop of proxy (typical for a platform load balancer) so
  // express-rate-limit keys on the real client IP via X-Forwarded-For
  // rather than the proxy's IP for every request.
  app.set("trust proxy", 1);

  const webhookLimiter = rateLimit({
    windowMs: rateLimitOptions.windowMs,
    max: rateLimitOptions.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate limit exceeded" },
  });

  // Raw body is required for Stripe signature verification -- must NOT run
  // through express.json() first, which would re-serialize the body and
  // break every signature check (byte-for-byte match is required).
  app.post(
    "/webhooks/stripe",
    webhookLimiter,
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req: Request, res: Response) => {
      const rawBody = req.body as Buffer;
      const signatureHeader = req.header("Stripe-Signature");
      const result = await handleStripeWebhook(rawBody, signatureHeader, deps);
      res.status(result.status).json(result.body);
    }
  );

  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  return app;
}

export function createServerFromEnv(): Express {
  // Import lazily so unit tests that only need createApp() don't require
  // real provider/network modules to be exercised.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { InMemoryIdempotencyStore } = require("./idempotencyStore");
  const { InProcessScheduler } = require("./scheduler");
  const { ResendEmailProvider, SendGridEmailProvider, NullEmailProvider } = require("./emailProvider");
  const { StripeCustomerLookup } = require("./customerLookup");
  const { nodeFetchAdapter } = require("./httpFetchAdapter");
  /* eslint-enable @typescript-eslint/no-var-requires */

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required -- refusing to start without webhook verification configured");
  }

  const stripeApiKey = process.env.STRIPE_API_KEY;
  if (!stripeApiKey) {
    throw new Error("STRIPE_API_KEY is required for customer email lookup");
  }

  const emailProviderName = process.env.EMAIL_PROVIDER || "none";
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || "onboarding@deuerout.com";
  let emailProvider;
  if (emailProviderName === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    emailProvider = new ResendEmailProvider(apiKey, fromAddress, nodeFetchAdapter);
  } else if (emailProviderName === "sendgrid") {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) throw new Error("SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid");
    emailProvider = new SendGridEmailProvider(apiKey, fromAddress, nodeFetchAdapter);
  } else {
    console.warn("[server] EMAIL_PROVIDER not set to 'resend' or 'sendgrid' -- using NullEmailProvider (no emails will actually be sent)");
    emailProvider = new NullEmailProvider();
  }

  const deps: WebhookDeps = {
    webhookSecret,
    idempotencyStore: new InMemoryIdempotencyStore(),
    customerLookup: new StripeCustomerLookup(stripeApiKey, nodeFetchAdapter),
    emailProvider,
    scheduler: new InProcessScheduler(),
  };

  return createApp(deps);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createServerFromEnv();
  app.listen(port, () => {
    console.log(`[server] Solomon billing webhook listening on :${port}`);
  });
}
