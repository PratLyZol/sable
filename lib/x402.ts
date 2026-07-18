// Sable x402 — the HTTP-402 payment layer.
// We self-facilitate (both the endpoint and the paying agent fleet are ours),
// but keep the x402 protocol shape: 402 status, accepts[] payment requirements,
// X-PAYMENT retry header. This module owns the service registry, the quote
// (nonce) lifecycle, and price/scale math. The route and the payer client both
// import from here. Nonce state lives on globalThis so it survives HMR in dev.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ServiceName = "listings" | "orderbook" | "enrich" | "compute";

export const SERVICE_NAMES: ServiceName[] = ["listings", "orderbook", "enrich", "compute"];

export function isServiceName(v: string): v is ServiceName {
  return (SERVICE_NAMES as string[]).includes(v);
}

export type ServiceDef = {
  host: string;
  resource: string;
  /** Base price in USD. Array = per-call schedule selected by ?call=N. */
  price: number | number[];
  description: string;
  mimeType: string;
  /** Fresh payload built on each successful (paid) fetch. */
  payload: () => unknown;
};

// ---------- small local helpers (kept independent of lib/store) ----------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += B58[Math.floor(Math.random() * B58.length)];
  return s;
}
function rnd(min: number, max: number, dp = 2): number {
  const v = min + Math.random() * (max - min);
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- payloads (plausible x402 vendor responses) ----------

function listingsPayload() {
  return {
    updatedAt: new Date().toISOString(),
    listings: [
      { name: "Snowdrift Orderbook Feed", endpoint: "data.snowdrift.co/v1/orderbook", unitPrice: 1.1, unit: "per read" },
      { name: "Lexica Entity Enrichment", endpoint: "api.lexica.dev/enrich", unitPrice: 0.62, unit: "per batch" },
      { name: "Meridian GPU Compute", endpoint: "compute.meridian.gg/run", unitPrice: 1.05, unit: "per job" },
      { name: "Halcyon Timeseries", endpoint: "data.halcyon.host/v2/ts", unitPrice: 0.38, unit: "per series" },
      { name: "Northwind Freight Index", endpoint: "api.northwind.io/freight", unitPrice: 0.72, unit: "per snapshot" },
      { name: "Cobalt Sentiment Stream", endpoint: "api.cobalt.stream/sentiment", unitPrice: 0.29, unit: "per window" },
      { name: "Vertex FX Rates", endpoint: "fx.vertexdata.io/rates", unitPrice: 0.15, unit: "per pull" },
    ],
  };
}

function orderbookPayload() {
  const pairs = ["SOL/USDC", "BTC/USDC", "ETH/USDC", "JTO/USDC", "BONK/USDC"].map((pair) => {
    const mid = pick([142.3, 61240.5, 3305.7, 2.94, 0.0000241]);
    const spreadBps = rnd(1.2, 8.5, 1);
    return {
      pair,
      bid: round2(mid * (1 - spreadBps / 20000)),
      ask: round2(mid * (1 + spreadBps / 20000)),
      spreadBps,
      depth1pctUsd: Math.round(rnd(80_000, 2_400_000, 0)),
      vol24hUsd: Math.round(rnd(1_200_000, 88_000_000, 0)),
    };
  });
  return { venue: "snowdrift-aggregated", asOf: new Date().toISOString(), pairs };
}

function enrichPayload() {
  const types = ["organization", "person", "asset", "location"];
  const entities = Array.from({ length: 6 }, (_, i) => ({
    id: `ent_${b58(6)}`,
    name: pick(["Helio Labs", "Marisol Vega", "SOL", "Lisbon PT", "Northwind Freight", "Aiko Tanaka"]),
    type: types[i % types.length],
    confidence: rnd(0.71, 0.99, 2),
    tags: Array.from({ length: 3 }, () => pick(["verified", "sanctioned:no", "kyc:pass", "high-signal", "primary-source", "stale"])),
  }));
  return { model: "lexica-enrich-3", entities };
}

function computePayload() {
  return {
    jobId: `cmp-${b58(8)}`,
    status: "complete" as const,
    output: {
      rows: Math.round(rnd(1_000, 48_000, 0)),
      matrixUrl: `https://compute.meridian.gg/artifacts/${b58(16)}.parquet`,
      durationMs: Math.round(rnd(1_800, 42_000, 0)),
      vcpuMinutes: rnd(1.5, 8.0, 1),
    },
  };
}

// ---------- service registry ----------

export const REGISTRY: Record<ServiceName, ServiceDef> = {
  listings: {
    host: "bazaar.x402.dev",
    resource: "/listings/data",
    price: 0.45,
    description: "Discovery index of x402 data vendors — names, endpoints, and unit prices.",
    mimeType: "application/json",
    payload: listingsPayload,
  },
  orderbook: {
    host: "data.snowdrift.co",
    resource: "/v1/orderbook",
    price: 1.1,
    description: "Aggregated orderbook statistics across major Solana pairs.",
    mimeType: "application/json",
    payload: orderbookPayload,
  },
  enrich: {
    host: "api.lexica.dev",
    resource: "/enrich",
    price: [0.62, 0.55, 0.62],
    description: "Per-batch entity enrichment with confidence and tags.",
    mimeType: "application/json",
    payload: enrichPayload,
  },
  compute: {
    host: "compute.meridian.gg",
    resource: "/run",
    price: 1.05,
    description: "Run a compute job and return the assembled artifact.",
    mimeType: "application/json",
    payload: computePayload,
  },
};

// ---------- payload summaries (one line per purchase, shown on run cards) ----------

export function summarizePayload(service: ServiceName, data: unknown): string {
  const d = data as Record<string, any> | null | undefined;
  try {
    switch (service) {
      case "listings": {
        const l = d?.listings;
        if (!Array.isArray(l) || l.length === 0) break;
        const min = Math.min(...l.map((x) => Number(x?.unitPrice)).filter(Number.isFinite));
        return `${l.length} vendors indexed · from $${min.toFixed(2)}/unit`;
      }
      case "orderbook": {
        const p = d?.pairs;
        if (!Array.isArray(p) || p.length === 0) break;
        const tightest = Math.min(...p.map((x) => Number(x?.spreadBps)).filter(Number.isFinite));
        const topVol = Math.max(...p.map((x) => Number(x?.vol24hUsd)).filter(Number.isFinite));
        return `${p.length} pairs · tightest spread ${tightest.toFixed(1)}bps · $${(topVol / 1e6).toFixed(1)}M top 24h vol`;
      }
      case "enrich": {
        const e = d?.entities;
        if (!Array.isArray(e) || e.length === 0) break;
        const avg = e.reduce((a, x) => a + (Number(x?.confidence) || 0), 0) / e.length;
        return `${e.length} entities · avg confidence ${avg.toFixed(2)} · model ${d?.model ?? "unknown"}`;
      }
      case "compute": {
        const out = d?.output;
        if (!d?.jobId || !out) break;
        return `job ${d.jobId} · ${Number(out.rows).toLocaleString("en-US")} rows · ${out.vcpuMinutes} vCPU·min`;
      }
    }
  } catch {
    // fall through to the generic line
  }
  return "payload received";
}

// ---------- pricing ----------

export function clampScale(scale: number | undefined): number {
  if (scale == null || !Number.isFinite(scale)) return 1;
  return Math.min(20, Math.max(0.1, scale));
}

/** Base price for a service before scale, selecting the call-N tier if scheduled. */
export function basePrice(service: ServiceName, call?: number): number {
  const p = REGISTRY[service].price;
  if (typeof p === "number") return p;
  // schedule is 1-based via ?call=N; default (or out of range) → first tier.
  if (call != null && Number.isFinite(call)) {
    const idx = Math.trunc(call) - 1;
    if (idx >= 0 && idx < p.length) return p[idx];
  }
  return p[0];
}

/** Quoted price = base × clamped scale, rounded to cents. */
export function quotedPrice(service: ServiceName, call?: number, scale?: number): number {
  return round2(basePrice(service, call) * clampScale(scale));
}

/** USD price → 6-decimal base units string (x402 maxAmountRequired). */
export function toBaseUnits(usd: number): string {
  return Math.round(usd * 1e6).toString();
}

// ---------- asset (mint) ----------

/** Base58 mint for the 402 asset field. Missing file must not crash. */
export function readMint(): string {
  try {
    const raw = readFileSync(join(process.cwd(), ".sable", "mint.json"), "utf8");
    const parsed = JSON.parse(raw) as { mint?: string };
    return typeof parsed.mint === "string" && parsed.mint ? parsed.mint : "unconfigured";
  } catch {
    return "unconfigured";
  }
}

// ---------- quote (nonce) lifecycle ----------

const NONCE_TTL_MS = 10 * 60_000; // 10 minutes

export type NonceRecord = {
  service: ServiceName;
  price: number; // USD, locked at issue (scale/call already applied)
  issuedAt: number;
  used: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __sableX402Nonces: Map<string, NonceRecord> | undefined;
}

function nonces(): Map<string, NonceRecord> {
  if (!globalThis.__sableX402Nonces) globalThis.__sableX402Nonces = new Map();
  return globalThis.__sableX402Nonces;
}

/** Mint a fresh single-use quote nonce and record it. */
export function issueNonce(service: ServiceName, price: number): string {
  const nonce = `sable-x402-${service}-${b58(8)}`;
  nonces().set(nonce, { service, price, issuedAt: Date.now(), used: false });
  sweep();
  return nonce;
}

export type NonceStatus =
  | { status: "ok"; record: NonceRecord }
  | { status: "unknown" }
  | { status: "expired" }
  | { status: "used" };

/** Validate a presented nonce against a service. Does not mutate `used`. */
export function checkNonce(nonce: string | undefined, service: ServiceName): NonceStatus {
  if (!nonce) return { status: "unknown" };
  const rec = nonces().get(nonce);
  if (!rec || rec.service !== service) return { status: "unknown" };
  if (Date.now() - rec.issuedAt > NONCE_TTL_MS) {
    nonces().delete(nonce);
    return { status: "expired" };
  }
  if (rec.used) return { status: "used" };
  return { status: "ok", record: rec };
}

/** Mark a quote settled. Replay-proof: a second settle sees status "used". */
export function markNonceUsed(nonce: string): void {
  const rec = nonces().get(nonce);
  if (rec) rec.used = true;
}

/** Drop expired nonces so the map doesn't grow without bound. */
function sweep(): void {
  const now = Date.now();
  for (const [k, v] of nonces()) {
    if (now - v.issuedAt > NONCE_TTL_MS) nonces().delete(k);
  }
}
