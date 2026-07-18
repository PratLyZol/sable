// Sable claims — the email-claim ledger behind Slip-style "pay by email".
// A claim is one stable record per recipient email: a shielded payment lands in
// escrow, the recipient gets a link + QR, opens a wallet Sable creates for them,
// and sweeps the funds out non-custodially on devnet.
//
// Dependency-free by design (no imports from store/chain/email) so it can be
// imported from anywhere — the served QR endpoint, the wallet UI, the store.
// Claim records survive HMR on globalThis AND persist to .sable/claims.json;
// the outbox is in-memory only (it's a demo surface, not a source of truth).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerSlice, persistSlice } from "@/lib/persist";

// ---------- types ----------

export type SweepRecord = { sig: string; amount: number; ts: number; explorerUrl?: string };

export type ClaimRecord = {
  token: string;
  email: string;
  recipientName: string;
  createdAt: number;
  claimedAddress?: string;
  claimedAt?: number;
  sweeps: SweepRecord[];
  simSwept: number;
};

export type OutboxEmail = {
  id: string;
  to: string;
  subject: string;
  html: string;
  claimUrl: string;
  ts: number;
  via: "outbox" | "smtp";
  paymentId?: string;
  sendError?: string;
};

// ---------- small local helpers (kept independent of lib/store) ----------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += B58[Math.floor(Math.random() * B58.length)];
  return s;
}
let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// ---------- URL helpers ----------

export function baseUrl(): string {
  const raw = process.env.SABLE_PUBLIC_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function claimUrlFor(token: string): string {
  return `${baseUrl()}/claim/${token}`;
}

// ---------- persistence ----------

const SABLE_DIR = ".sable";
function claimsPath(): string {
  return join(process.cwd(), SABLE_DIR, "claims.json");
}

type ClaimState = {
  byToken: Map<string, ClaimRecord>;
  byEmail: Map<string, string>; // lowercased email -> token
  loaded: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __sableClaims: ClaimState | undefined;
  // eslint-disable-next-line no-var
  var __sableOutbox: OutboxEmail[] | undefined;
}

function state(): ClaimState {
  if (!globalThis.__sableClaims) {
    globalThis.__sableClaims = { byToken: new Map(), byEmail: new Map(), loaded: false };
  }
  const st = globalThis.__sableClaims;
  if (!st.loaded) {
    st.loaded = true; // set first so a read error doesn't loop
    try {
      const raw = readFileSync(claimsPath(), "utf8");
      const arr = JSON.parse(raw) as ClaimRecord[];
      for (const rec of arr) {
        // Tolerate older/partial records — normalize the collection fields.
        const norm: ClaimRecord = { ...rec, sweeps: rec.sweeps ?? [], simSwept: rec.simSwept ?? 0 };
        st.byToken.set(norm.token, norm);
        st.byEmail.set(norm.email.toLowerCase(), norm.token);
      }
    } catch {
      // No file yet (fresh clone / sim mode) — start empty.
    }
  }
  return st;
}

function persist(st: ClaimState): void {
  persistSlice("claims"); // cross-instance (no-op without DATABASE_URL)
  try {
    mkdirSync(join(process.cwd(), SABLE_DIR), { recursive: true });
    writeFileSync(claimsPath(), JSON.stringify(Array.from(st.byToken.values()), null, 2));
  } catch {
    // Best-effort — a persistence failure must never break the payment path.
    // (Vercel's filesystem is read-only; the DB slice above is the real copy.)
  }
}

// Cross-instance persistence slices (no-ops without DATABASE_URL).
registerSlice("claims", {
  dump: () => Array.from(state().byToken.values()),
  load: (v) => {
    const st: ClaimState = { byToken: new Map(), byEmail: new Map(), loaded: true };
    for (const rec of v as ClaimRecord[]) {
      const norm: ClaimRecord = { ...rec, sweeps: rec.sweeps ?? [], simSwept: rec.simSwept ?? 0 };
      st.byToken.set(norm.token, norm);
      st.byEmail.set(norm.email.toLowerCase(), norm.token);
    }
    globalThis.__sableClaims = st;
  },
});
registerSlice("outbox", {
  dump: () => outbox(),
  load: (v) => {
    globalThis.__sableOutbox = v as OutboxEmail[];
  },
});

// ---------- claim records ----------

/** Idempotent per email: one stable record (and token) per recipient address. */
export function ensureClaim(email: string, recipientName: string): ClaimRecord {
  const st = state();
  const key = email.toLowerCase();
  const existingToken = st.byEmail.get(key);
  if (existingToken) {
    const rec = st.byToken.get(existingToken);
    if (rec) return rec;
  }
  const rec: ClaimRecord = {
    token: `clm_${b58(24)}`,
    email,
    recipientName,
    createdAt: Date.now(),
    sweeps: [],
    simSwept: 0,
  };
  st.byToken.set(rec.token, rec);
  st.byEmail.set(key, rec.token);
  persist(st);
  return rec;
}

export function resolveClaimToken(token: string): ClaimRecord | null {
  return state().byToken.get(token) ?? null;
}

/** Bind the wallet address the recipient claims into. Set once; a re-bind to the
 * same address is a no-op. Persists. */
export function bindClaimAddress(token: string, address: string): ClaimRecord {
  const st = state();
  const rec = st.byToken.get(token);
  if (!rec) throw new Error(`bindClaimAddress: unknown claim token ${token}`);
  if (rec.claimedAddress === address) return rec;
  if (!rec.claimedAddress) {
    rec.claimedAddress = address;
    rec.claimedAt = Date.now();
    persist(st);
  }
  return rec;
}

export function recordSweep(token: string, s: SweepRecord): void {
  const st = state();
  const rec = st.byToken.get(token);
  if (!rec) return;
  rec.sweeps.push(s);
  persist(st);
}

export function recordSimSweep(token: string, amount: number, sig: string): void {
  const st = state();
  const rec = st.byToken.get(token);
  if (!rec) return;
  rec.simSwept = Math.round((rec.simSwept + amount) * 100) / 100;
  rec.sweeps.push({ sig, amount, ts: Date.now() });
  persist(st);
}

// ---------- outbox (in-memory only) ----------

function outbox(): OutboxEmail[] {
  if (!globalThis.__sableOutbox) globalThis.__sableOutbox = [];
  return globalThis.__sableOutbox;
}

export function appendOutbox(e: Omit<OutboxEmail, "id" | "ts">): OutboxEmail {
  const full: OutboxEmail = { ...e, id: uid("out"), ts: Date.now() };
  const box = outbox();
  box.unshift(full);
  if (box.length > 50) box.length = 50; // bound the slice — each row carries full HTML
  persistSlice("outbox");
  return full;
}

export function getOutbox(): OutboxEmail[] {
  return outbox();
}
