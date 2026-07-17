// x402 payer helper. The agent fleet uses this to pay a Sable x402 endpoint:
// GET the resource, receive the 402 quote, run it past the caller's budget
// guard (authorize), settle it on-chain (pay), then retry with the X-PAYMENT
// proof. Server-side only — imported by the store's fleet code. No "use client".

import type { SettleResult } from "@/lib/chain";

export type X402Quote = {
  amount: number; // USD
  payTo: string;
  resource: string;
  memo: string; // the quote nonce, echoed back as X-PAYMENT.nonce
};

export type X402Result = {
  ok: boolean;
  quote: X402Quote;
  sig?: string;
  explorerUrl?: string;
  error?: string;
};

export type X402Service = "listings" | "orderbook" | "enrich" | "compute";

export type PayAndFetchOpts = {
  /** Budget guard. Return false to refuse the quote — no payment is made. */
  authorize: (quote: X402Quote) => boolean;
  /** Settle on-chain with memo = quote.memo. */
  pay: (quote: X402Quote) => Promise<SettleResult>;
  scale?: number;
  call?: number;
};

type Accepts = {
  payTo?: string;
  resource?: string;
  extra?: { memo?: string; priceUsd?: number };
};

const TIMEOUT_MS = 30_000;

function baseUrl(): string {
  return process.env.SABLE_SELF_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
}

function endpoint(service: X402Service, call?: number): string {
  const url = new URL(`/api/x402/${service}`, baseUrl());
  if (call != null) url.searchParams.set("call", String(call));
  return url.toString();
}

function scaleHeaders(scale?: number): Record<string, string> {
  return scale != null ? { "X-Sable-Scale": String(scale) } : {};
}

export async function payAndFetch(
  service: X402Service,
  opts: PayAndFetchOpts,
): Promise<X402Result> {
  const { authorize, pay, scale, call } = opts;
  const url = endpoint(service, call);
  const headers = scaleHeaders(scale);

  const emptyQuote: X402Quote = { amount: 0, payTo: "", resource: url, memo: "" };

  // 1. Ask for the resource → expect 402 with a quote.
  let quoteRes: Response;
  try {
    quoteRes = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, quote: emptyQuote, error: `network error requesting quote: ${errText(e)}` };
  }

  if (quoteRes.status !== 402) {
    const body = await safeText(quoteRes);
    return { ok: false, quote: emptyQuote, error: `expected 402 quote, got ${quoteRes.status}: ${body}` };
  }

  const quote = await parseQuote(quoteRes);
  if (!quote) {
    return { ok: false, quote: emptyQuote, error: "402 response missing a usable accepts[0] quote" };
  }

  // 2. Budget guard. Refusal means we make NO payment.
  if (!authorize(quote)) {
    return { ok: false, quote, error: "refused by budget guard" };
  }

  // 3. Settle on-chain with memo = quote.memo.
  let settle: SettleResult;
  try {
    settle = await pay(quote);
  } catch (e) {
    return { ok: false, quote, error: `payment failed: ${errText(e)}` };
  }

  // 4. Retry with the payment proof.
  let paidRes: Response;
  try {
    paidRes = await fetch(url, {
      method: "GET",
      headers: {
        ...headers,
        "X-PAYMENT": JSON.stringify({ sig: settle.sig, nonce: quote.memo }),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, quote, sig: settle.sig, error: `network error settling quote: ${errText(e)}` };
  }

  if (paidRes.status !== 200) {
    const reason = await extractError(paidRes);
    return { ok: false, quote, sig: settle.sig, error: reason };
  }

  return { ok: true, quote, sig: settle.sig, explorerUrl: settle.explorerUrl };
}

// ---------- helpers ----------

async function parseQuote(res: Response): Promise<X402Quote | null> {
  let body: { accepts?: Accepts[] };
  try {
    body = (await res.json()) as { accepts?: Accepts[] };
  } catch {
    return null;
  }
  const a = body.accepts?.[0];
  const memo = a?.extra?.memo;
  const amount = a?.extra?.priceUsd;
  if (!a || typeof memo !== "string" || typeof amount !== "number") return null;
  return { amount, payTo: a.payTo ?? "", resource: a.resource ?? "", memo };
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `settlement rejected with status ${res.status}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "<no body>";
  }
}

function errText(e: unknown): string {
  if (e instanceof DOMException && e.name === "TimeoutError") return "request timed out";
  return e instanceof Error ? e.message : String(e);
}
