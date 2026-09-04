/**
 * Thin abstraction over the transactional email provider (Resend or
 * SendGrid), so the sequence logic doesn't care which one is configured.
 * Handles retry-with-backoff on transient failures, fails fast on 4xx
 * (a malformed send request won't become valid by resending it).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Used for provider-side dedupe / idempotency where supported. */
  idempotencyKey: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}

interface RetryOptions {
  maxRetries?: number;
  retryBaseMs?: number;
}

async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const retryBaseMs = opts.retryBaseMs ?? 500;
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const retryable = (err as { retryable?: boolean })?.retryable !== false;
      attempt += 1;
      if (!retryable || attempt > maxRetries) throw err;
      const delay = retryBaseMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

class ProviderError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly fetchImpl: FetchLike,
    private readonly retryOptions: RetryOptions = {}
  ) {}

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    return withRetry(async () => {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // Resend supports an idempotency key so a retried send after a
          // dropped response doesn't double-send.
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [message.to],
          subject: message.subject,
          html: message.html,
        }),
      });

      if (res.ok) {
        const body = (await res.json()) as { id?: string };
        return { providerMessageId: body.id ?? "unknown" };
      }

      const bodyText = await res.text();
      const retryable = res.status >= 500;
      throw new ProviderError(`Resend send failed (HTTP ${res.status}): ${bodyText}`, res.status, retryable);
    }, this.retryOptions);
  }
}

export class SendGridEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly fetchImpl: FetchLike,
    private readonly retryOptions: RetryOptions = {}
  ) {}

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    return withRetry(async () => {
      const res = await this.fetchImpl("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: this.fromAddress },
          subject: message.subject,
          content: [{ type: "text/html", value: message.html }],
          // SendGrid doesn't have a first-class idempotency key on this
          // endpoint; the idempotencyKey is still used at the application
          // layer (see idempotencyStore.ts) to prevent re-enrollment.
        }),
      });

      if (res.ok) {
        return { providerMessageId: res.status === 202 ? "accepted" : "unknown" };
      }

      const bodyText = await res.text();
      const retryable = res.status >= 500 || res.status === 429;
      throw new ProviderError(`SendGrid send failed (HTTP ${res.status}): ${bodyText}`, res.status, retryable);
    }, this.retryOptions);
  }
}

/** In-memory provider for local/dev/test use -- never talks to the network. */
export class NullEmailProvider implements EmailProvider {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    return { providerMessageId: `null-${this.sent.length}` };
  }
}
