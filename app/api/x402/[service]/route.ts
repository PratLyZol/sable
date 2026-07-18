// x402 endpoint. GET with no X-PAYMENT → 402 + accepts[] payment requirements
// (a fresh single-use quote nonce). GET with X-PAYMENT → verify the on-chain
// payment against the quoted price + memo, then return the paid data once.
//
// We self-facilitate: verifyOnChain / recipientAddress / chainMode come from
// lib/chain.ts (Chain-Core). In devnet mode the fleet really pays on Solana
// devnet; in sim mode we accept the sig "sim" and verify nothing — the nonce is
// still strictly single-use so replays and expired quotes are refused either way.

import { NextResponse } from "next/server";
import {
  REGISTRY,
  isServiceName,
  quotedPrice,
  toBaseUnits,
  readMint,
  issueNonce,
  checkNonce,
  markNonceUsed,
  type ServiceName,
} from "@/lib/x402";
import { verifyOnChain, recipientAddress, chainMode } from "@/lib/chain";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

type PaymentPayload = { sig?: string; payer?: string; nonce?: string };

/** X-PAYMENT is accepted as plain JSON or base64-encoded JSON. */
function parsePayment(header: string): PaymentPayload | null {
  const raw = header.trim();
  try {
    return JSON.parse(raw) as PaymentPayload;
  } catch {
    // fall through to base64
  }
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as PaymentPayload;
  } catch {
    return null;
  }
}

function parseScale(req: Request): number | undefined {
  const h = req.headers.get("x-sable-scale");
  if (!h) return undefined;
  const n = Number.parseFloat(h);
  return Number.isFinite(n) ? n : undefined;
}

function parseCall(url: URL): number | undefined {
  const c = url.searchParams.get("call");
  if (!c) return undefined;
  const n = Number.parseInt(c, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function payToFor(service: ServiceName): Promise<string> {
  return chainMode() === "devnet" ? await recipientAddress(`x402:${service}`) : "sim";
}

/** Build a 402 body carrying a freshly-issued quote for this request. */
async function build402(
  service: ServiceName,
  call: number | undefined,
  scale: number | undefined,
  error: string,
) {
  const def = REGISTRY[service];
  const price = quotedPrice(service, call, scale);
  const nonce = issueNonce(service, price);
  const payTo = await payToFor(service);
  const asset = chainMode() === "sim" ? "SABLE-USD" : readMint();

  return NextResponse.json(
    {
      x402Version: 1,
      error,
      accepts: [
        {
          scheme: "exact",
          network: "solana-devnet",
          asset,
          payTo,
          maxAmountRequired: toBaseUnits(price),
          resource: `https://${def.host}${def.resource}`,
          description: def.description,
          mimeType: def.mimeType,
          extra: { memo: nonce, priceUsd: price },
        },
      ],
    },
    { status: 402 },
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ service: string }> },
) {
  await hydrateState();
  const { service } = await ctx.params;
  if (!isServiceName(service)) {
    return NextResponse.json({ x402Version: 1, error: `Unknown service "${service}"` }, { status: 404 });
  }

  const url = new URL(req.url);
  const call = parseCall(url);
  const scale = parseScale(req);

  const paymentHeader = req.headers.get("x-payment");

  // ---- unpaid: issue a quote ----
  if (!paymentHeader) {
    return build402(service, call, scale, "Payment required");
  }

  // ---- paid: verify the presented payment against a live quote ----
  const payment = parsePayment(paymentHeader);
  const check = checkNonce(payment?.nonce, service);

  if (check.status === "unknown" || check.status === "expired") {
    return build402(service, call, scale, "unknown or expired quote");
  }
  if (check.status === "used") {
    return build402(service, call, scale, "quote already settled");
  }

  const { record } = check;
  const nonce = payment!.nonce!;
  const sig = payment?.sig;

  if (chainMode() === "devnet") {
    if (!sig) {
      return build402(service, call, scale, "missing payment signature");
    }
    const payTo = await recipientAddress(`x402:${service}`);
    const result = await verifyOnChain(sig, { payTo, minAmount: record.price, memoIncludes: nonce });
    if (!result.valid) {
      return build402(service, call, scale, result.reason ?? "on-chain payment could not be verified");
    }
  }
  // sim mode: verify nothing (the demo's non-chain fallback), but still single-use.

  // Settle the quote — replay-proof from here on.
  markNonceUsed(nonce);

  const def = REGISTRY[service];
  return NextResponse.json({
    data: def.payload(),
    receipt: { sig: sig ?? "sim", service, amountUsd: record.price, nonce },
  });
}
