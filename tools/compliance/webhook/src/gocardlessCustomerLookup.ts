/**
 * GoCardless customer events carry a customer ID, not an email address --
 * fetching the email is a separate GET /customers/:id call, same shape as
 * customerLookup.ts's Stripe equivalent.
 *
 * Base URL differs by environment: https://api-sandbox.gocardless.com for
 * sandbox (free to sign up for, no card required -- the GoCardless
 * equivalent of Stripe test mode) vs https://api.gocardless.com for live.
 * Access tokens are environment-scoped: a sandbox token only works against
 * the sandbox base URL and vice versa.
 */
import { FetchLike } from "./emailProvider";

export interface GoCardlessCustomerLookup {
  getEmail(customerId: string): Promise<string | null>;
}

export const GOCARDLESS_SANDBOX_BASE_URL = "https://api-sandbox.gocardless.com";
export const GOCARDLESS_LIVE_BASE_URL = "https://api.gocardless.com";

export class ApiGoCardlessCustomerLookup implements GoCardlessCustomerLookup {
  constructor(private readonly accessToken: string, private readonly baseUrl: string, private readonly fetchImpl: FetchLike) {}

  async getEmail(customerId: string): Promise<string | null> {
    const res = await this.fetchImpl(`${this.baseUrl}/customers/${encodeURIComponent(customerId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "GoCardless-Version": "2015-07-06",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { customers?: { email?: string | null } };
    return body.customers?.email ?? null;
  }
}

/** Test/dev lookup backed by a plain object. */
export class StaticGoCardlessCustomerLookup implements GoCardlessCustomerLookup {
  constructor(private readonly emailsByCustomerId: Record<string, string>) {}
  async getEmail(customerId: string): Promise<string | null> {
    return this.emailsByCustomerId[customerId] ?? null;
  }
}
