/**
 * Stripe subscription events carry a customer ID, not an email address --
 * fetching the email is a separate lookup. Abstracted so tests don't need
 * to hit the real Stripe API.
 */
import { FetchLike } from "./emailProvider";

export interface CustomerLookup {
  getEmail(customerId: string): Promise<string | null>;
}

export class StripeCustomerLookup implements CustomerLookup {
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike) {}

  async getEmail(customerId: string): Promise<string | null> {
    const res = await this.fetchImpl(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      // No `body` field: fetch (undici) throws if a GET/HEAD request
      // carries a body, even an empty string.
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string | null };
    return body.email ?? null;
  }
}

/** Test/dev lookup backed by a plain object. */
export class StaticCustomerLookup implements CustomerLookup {
  constructor(private readonly emailsByCustomerId: Record<string, string>) {}
  async getEmail(customerId: string): Promise<string | null> {
    return this.emailsByCustomerId[customerId] ?? null;
  }
}
