// Sable in-memory store — the single source of truth for the demo.
// Shielded stablecoin payments (Solana Confidential Balances-style),
// x402 agent spend, scoped subagent budgets, and viewing-key disclosure.
// In "sim" mode everything is faked in-process; in "devnet" mode payments
// are settled for real on Solana devnet via lib/chain + lib/x402client.
// Persisted on globalThis so it survives HMR in dev.

import { chainMode, settleOnChain, treasuryAddressSync, treasuryTokenSync, type ChainMode } from "@/lib/chain";
import { payAndFetch, type X402Result } from "@/lib/x402client";
import { summarizePayload, type ServiceName } from "@/lib/x402";
import { ensureClaim, claimUrlFor } from "@/lib/claims";
import { sendPaymentEmail } from "@/lib/email";
import { registerSlice, persistSlice, keepAlive } from "@/lib/persist";

export type PaymentKind = "payroll" | "vendor" | "agent";

export type Payment = {
  id: string;
  kind: PaymentKind;
  counterparty: string; // display name (contractor, vendor, or x402 endpoint host)
  detail: string; // country, category, or endpoint path
  amount: number; // USDC
  memo: string;
  ts: number;
  sig: string; // solana signature — fake in sim mode, real on devnet; "" while settling
  status: "settled" | "settling" | "failed";
  chain: "sim" | "devnet";
  explorerUrl?: string; // devnet only, populated once the real sig lands
  seeded?: boolean; // demo seed data — excluded from claim escrow math (devnet parity: seeds never settled on-chain)
  contractorId?: string;
  vendorId?: string;
  runId?: string;
  subagentId?: string;
};

export type Contractor = {
  id: string;
  name: string;
  email: string;
  country: string;
  flag: string;
  role: string;
  amount: number; // per pay cycle, USDC
};

export type Vendor = {
  id: string;
  name: string;
  email: string;
  category: string;
};

export type ViewingKeyScope =
  | { type: "payment"; id: string }
  | { type: "vendor"; id: string }
  | { type: "run"; id: string }
  | { type: "all" };

export type ViewingKey = {
  key: string; // svk_...
  label: string;
  scope: ViewingKeyScope;
  createdAt: number;
};

export type SubagentEvent = {
  ts: number;
  kind: "info" | "x402" | "pay" | "blocked" | "done";
  text: string;
};

export type Subagent = {
  id: string;
  name: string; // kit-alpha
  role: string; // Prospector
  task: string;
  cap: number; // delegated budget ceiling
  spent: number;
  status: "pending" | "working" | "done" | "halted";
  events: SubagentEvent[];
};

export type BlockedAttempt = {
  ts: number;
  subagentId: string;
  amount: number;
  reason: string;
};

/** Proof-of-purchase for one x402 buy — receipt + a preview of the data bought. */
export type Purchase = {
  id: string;
  subagentId: string;
  service: string; // "orderbook"
  host: string; // data.snowdrift.co
  resource: string;
  amountUsd: number;
  sig: string;
  explorerUrl?: string;
  nonce: string;
  ts: number;
  summary: string; // one-line description of the purchased payload
  preview: string; // truncated JSON of the payload itself
};

export type AgentRun = {
  id: string;
  goal: string;
  budget: number;
  spent: number;
  status: "running" | "complete" | "halted";
  startedAt: number;
  completedAt?: number;
  result?: string;
  blocked: BlockedAttempt[];
  subagents: Subagent[];
  purchases: Purchase[];
};

export type ExplorerEntry = {
  slot: number;
  sig: string;
  ts: number;
  program: string;
  kind: "ct" | "delegate" | "revoke";
};

export type Snapshot = {
  balance: number;
  chain: { mode: ChainMode; treasuryAddress: string | null; treasuryToken: number | null };
  contractors: Contractor[];
  vendors: Vendor[];
  payments: Payment[]; // newest first
  runs: AgentRun[]; // newest first
  keys: ViewingKey[]; // newest first
  explorer: ExplorerEntry[]; // newest first
  totals: {
    shieldedCount: number;
    payrollMtd: number;
    vendorMtd: number;
    agentSpend: number;
    blockedAttempts: number;
    activeRuns: number;
  };
};

type Store = {
  balance: number;
  slot: number;
  contractors: Contractor[];
  vendors: Vendor[];
  payments: Payment[];
  runs: AgentRun[];
  keys: ViewingKey[];
  explorer: ExplorerEntry[];
  timers: ReturnType<typeof setTimeout>[];
};

// ---------- helpers ----------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += B58[Math.floor(Math.random() * B58.length)];
  return s;
}
export function fakeSig(): string {
  return b58(44);
}
let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- seed ----------

function seed(): Store {
  const now = Date.now();
  const h = 3600_000;
  const d = 24 * h;

  const contractors: Contractor[] = [
    { id: "c1", name: "Mariana Duarte", email: "mariana@duarte.example", country: "Portugal", flag: "🇵🇹", role: "Product engineer", amount: 4200 },
    { id: "c2", name: "Ravi Menon", email: "ravi.menon@fastmail.example", country: "India", flag: "🇮🇳", role: "Data engineer", amount: 3850 },
    { id: "c3", name: "Camila Reyes", email: "camila@reyes.example", country: "Mexico", flag: "🇲🇽", role: "Brand designer", amount: 3600 },
    { id: "c4", name: "Tunde Okafor", email: "tunde.o@hey.example", country: "Nigeria", flag: "🇳🇬", role: "Support lead", amount: 2900 },
    { id: "c5", name: "Aiko Tanaka", email: "aiko@tanaka.example", country: "Japan", flag: "🇯🇵", role: "Research analyst", amount: 4750 },
  ];

  const vendors: Vendor[] = [
    { id: "v1", name: "Snowdrift Data Co.", email: "billing@snowdrift.example", category: "Market data" },
    { id: "v2", name: "Lexica Enrichment", email: "pay@lexica.example", category: "Enrichment API" },
    { id: "v3", name: "Meridian Compute", email: "ar@meridian.example", category: "GPU compute" },
    { id: "v4", name: "Northwind Logistics", email: "invoices@northwind.example", category: "Fulfillment" },
    { id: "v5", name: "Halcyon Cloud", email: "billing@halcyon.example", category: "Infrastructure" },
  ];

  const store: Store = {
    balance: 61_400,
    slot: 287_413_206,
    contractors,
    vendors,
    payments: [],
    runs: [],
    keys: [],
    explorer: [],
    timers: [],
  };

  const pay = (p: SettleInput) => {
    const payment: Payment = { ...p, id: uid("pay"), sig: fakeSig(), status: "settled", chain: "sim", seeded: true };
    store.payments.unshift(payment);
    store.balance = round2(store.balance - payment.amount);
    store.slot += 1 + Math.floor(Math.random() * 40);
    store.explorer.unshift({ slot: store.slot, sig: payment.sig, ts: payment.ts, program: "ZkConfidentialTransfer", kind: "ct" });
    return payment;
  };

  // no seeded payroll history — payday starts blank; run payroll to fill it
  // vendor history
  pay({ kind: "vendor", counterparty: "Halcyon Cloud", detail: "Infrastructure", amount: 2140, memo: "June infra invoice #H-2291", ts: now - 9 * d, vendorId: "v5" });
  pay({ kind: "vendor", counterparty: "Northwind Logistics", detail: "Fulfillment", amount: 3480.5, memo: "Q3 fulfillment retainer", ts: now - 6 * d, vendorId: "v4" });
  pay({ kind: "vendor", counterparty: "Snowdrift Data Co.", detail: "Market data", amount: 1275, memo: "Orderbook feed · annual", ts: now - 3 * d, vendorId: "v1" });

  // one completed agent run
  const runStart = now - 26 * h;
  const run: AgentRun = {
    id: uid("run"),
    goal: "Competitive pricing scan across API data vendors",
    budget: 3,
    spent: 0,
    status: "complete",
    startedAt: runStart,
    completedAt: runStart + 41_000,
    result:
      "Deliverable — pricing matrix across 6 x402 data vendors. Snowdrift undercuts Lexica by 31% on per-call orderbook reads; Meridian bundles compute credits at $0.11/1k calls. Full matrix attached to run ledger.",
    blocked: [],
    purchases: [],
    subagents: [
      { id: "sa1", name: "kit-alpha", role: "Prospector", task: "Discover x402 vendors and purchase price sheets", cap: 1.2, spent: 0.98, status: "done", events: [] },
      { id: "sa2", name: "kit-bravo", role: "Enricher", task: "Verify vendor claims via per-call sampling", cap: 0.9, spent: 0.74, status: "done", events: [] },
      { id: "sa3", name: "kit-charlie", role: "Synthesist", task: "Buy compute, assemble pricing matrix", cap: 0.75, spent: 0.69, status: "done", events: [] },
    ],
  };
  const runPays: Array<[string, string, string, number, string]> = [
    ["sa1", "data.snowdrift.co", "/v1/pricing", 0.55, "x402 GET price sheet"],
    ["sa1", "bazaar.x402.dev", "/listings/data", 0.43, "x402 discovery index"],
    ["sa2", "api.lexica.dev", "/enrich/sample", 0.38, "x402 sample calls ×40"],
    ["sa2", "api.lexica.dev", "/enrich/sample", 0.36, "x402 sample calls ×38"],
    ["sa3", "compute.meridian.gg", "/run/cmp-9917", 0.69, "x402 compute · 2 vCPU·min"],
  ];
  let t = runStart + 4000;
  for (const [sid, host, path, amount, memo] of runPays) {
    const p = pay({ kind: "agent", counterparty: host, detail: path, amount, memo, ts: t, runId: run.id, subagentId: sid });
    run.spent = round2(run.spent + p.amount);
    t += 6500;
  }
  store.runs.unshift(run);

  // a seeded viewing key for the auditor demo
  store.keys.unshift({
    key: `svk_${b58(24)}`,
    label: "Auditor · Halcyon Cloud payments",
    scope: { type: "vendor", id: "v5" },
    createdAt: now - 2 * d,
  });

  // the operator's own key: full-ledger scope, so the person running payroll
  // sees everything the world can't — payroll, vendors, and agent spend
  store.keys.unshift({
    key: `svk_${b58(24)}`,
    label: "Operator · full ledger",
    scope: { type: "all" },
    createdAt: now - 30 * d,
  });

  return store;
}

declare global {
  // eslint-disable-next-line no-var
  var __sableStore: Store | undefined;
}

function store(): Store {
  if (!globalThis.__sableStore) globalThis.__sableStore = seed();
  return globalThis.__sableStore;
}

// Cross-instance persistence (no-op without DATABASE_URL). Timers are
// process-local and non-serializable, so they never round-trip.
registerSlice("store", {
  dump: () => ({ ...store(), timers: [] }),
  load: (v) => {
    const incoming = v as Store;
    const local = globalThis.__sableStore;
    // Runs being orchestrated in THIS instance keep their live objects — the
    // orchestrator mutates them by reference and re-persists as it goes.
    if (local) {
      for (const r of local.runs) {
        if (r.status !== "running") continue;
        const i = incoming.runs.findIndex((x) => x.id === r.id);
        if (i >= 0) incoming.runs[i] = r;
        else incoming.runs.unshift(r);
      }
    }
    globalThis.__sableStore = { ...incoming, timers: local?.timers ?? [] };
  },
});

function persistStore(): void {
  persistSlice("store");
}

// ---------- core mutations ----------

// Everything settle() sets itself: identity, signature, status, chain, explorer URL.
type SettleInput = Omit<Payment, "id" | "sig" | "status" | "chain" | "explorerUrl">;

/** Settle a payroll/vendor payment. In sim mode this is instant and fake. In
 * devnet mode the payment lands in the ledger immediately as "settling" (balance
 * already deducted, empty sig), then a real Solana transfer is fired async and
 * patched into the SAME payment object on resolve — so runPayroll/payVendor stay
 * synchronous and their API contracts are unchanged. */
function settle(s: Store, p: SettleInput): Payment {
  if (chainMode() === "devnet") return settleDevnet(s, p);
  const payment: Payment = { ...p, id: uid("pay"), sig: fakeSig(), status: "settled", chain: "sim" };
  s.payments.unshift(payment);
  s.balance = round2(s.balance - payment.amount);
  s.slot += 1 + Math.floor(Math.random() * 40);
  s.explorer.unshift({ slot: s.slot, sig: payment.sig, ts: payment.ts, program: "ZkConfidentialTransfer", kind: "ct" });
  return payment;
}

function settleDevnet(s: Store, p: SettleInput): Payment {
  const payment: Payment = { ...p, id: uid("pay"), sig: "", status: "settling", chain: "devnet" };
  s.payments.unshift(payment);
  // Balance is deducted up front, same as sim — refunded below if settlement fails.
  s.balance = round2(s.balance - payment.amount);
  // Re-look-up by id in the continuations: a hydrate() may have swapped the
  // store (and its payment copies) while the transfer was confirming.
  const done = settleOnChain({ recipient: payment.counterparty, amount: payment.amount, memo: payment.memo })
    .then((res) => {
      const st = store();
      const p2 = st.payments.find((x) => x.id === payment.id) ?? payment;
      p2.sig = res.sig;
      p2.explorerUrl = res.explorerUrl;
      p2.status = "settled";
      // Only record the on-chain row once the real signature exists.
      st.slot += 1 + Math.floor(Math.random() * 40);
      st.explorer.unshift({ slot: st.slot, sig: res.sig, ts: p2.ts, program: "ZkConfidentialTransfer", kind: "ct" });
      persistStore();
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const st = store();
      const p2 = st.payments.find((x) => x.id === payment.id) ?? payment;
      p2.status = "failed";
      p2.memo = `${p2.memo} · settlement failed: ${msg}`;
      st.balance = round2(st.balance + p2.amount); // refund
      persistStore();
    });
  keepAlive(done);
  return payment;
}

// Fire-and-forget: ensure a claim record exists for the recipient email and
// email them the claim link + QR. Wrapped so it can NEVER disturb the payment
// path that calls it — a failure here leaves the settled payment untouched.
function queueClaimEmail(email: string, recipientName: string, payment: Payment): void {
  try {
    const rec = ensureClaim(email, recipientName);
    keepAlive(sendPaymentEmail({
      to: email,
      recipientName,
      amount: payment.amount,
      memo: payment.memo,
      token: rec.token,
      claimUrl: claimUrlFor(rec.token),
      paymentId: payment.id,
    }));
  } catch {
    // swallow — email is best-effort, the payment already settled
  }
}

export function getSnapshot(): Snapshot {
  const s = store();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const mtd = (k: PaymentKind) =>
    round2(s.payments.filter((p) => p.kind === k && p.ts >= monthStart.getTime()).reduce((a, p) => a + p.amount, 0));
  return {
    balance: s.balance,
    // Cheap + synchronous — safe to compute on every 1.5s poll. No RPC here:
    // treasuryTokenSync returns a cached value and refreshes in the background.
    chain: {
      mode: chainMode(),
      treasuryAddress: treasuryAddressSync(),
      treasuryToken: chainMode() === "devnet" ? treasuryTokenSync() : null,
    },
    contractors: s.contractors,
    vendors: s.vendors,
    payments: s.payments,
    runs: s.runs,
    keys: s.keys,
    explorer: s.explorer.slice(0, 60),
    totals: {
      shieldedCount: s.payments.length,
      payrollMtd: mtd("payroll"),
      vendorMtd: mtd("vendor"),
      agentSpend: round2(s.payments.filter((p) => p.kind === "agent").reduce((a, p) => a + p.amount, 0)),
      blockedAttempts: s.runs.reduce((a, r) => a + r.blocked.length, 0),
      activeRuns: s.runs.filter((r) => r.status === "running").length,
    },
  };
}

const COUNTRY_FLAGS: Record<string, string> = {
  portugal: "🇵🇹", india: "🇮🇳", mexico: "🇲🇽", nigeria: "🇳🇬", japan: "🇯🇵",
  "united states": "🇺🇸", usa: "🇺🇸", canada: "🇨🇦", brazil: "🇧🇷", germany: "🇩🇪",
  france: "🇫🇷", spain: "🇪🇸", "united kingdom": "🇬🇧", uk: "🇬🇧", argentina: "🇦🇷",
  philippines: "🇵🇭", indonesia: "🇮🇩", kenya: "🇰🇪", poland: "🇵🇱", vietnam: "🇻🇳",
};

export function addContractor(input: {
  name: string;
  email: string;
  amount: number;
  role?: string;
  country?: string;
}): Contractor | { error: string } {
  const s = store();
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: "Amount must be greater than 0." };
  if (s.contractors.some((c) => c.email.toLowerCase() === email)) return { error: "That email is already on payroll." };
  const country = input.country?.trim() || "—";
  const contractor: Contractor = {
    id: uid("c"),
    name,
    email,
    country,
    flag: COUNTRY_FLAGS[country.toLowerCase()] ?? "🌍",
    role: input.role?.trim() || "Contractor",
    amount: round2(input.amount),
  };
  s.contractors.push(contractor);
  persistStore();
  return contractor;
}

export function runPayroll(contractorIds?: string[]): { payments: Payment[]; total: number; count: number } {
  const s = store();
  const targets = contractorIds?.length ? s.contractors.filter((c) => contractorIds.includes(c.id)) : s.contractors;
  const now = Date.now();
  const cycle = new Date().toLocaleString("en-US", { month: "long" });
  const payments = targets.map((c, i) => {
    const p = settle(s, {
      kind: "payroll",
      counterparty: c.name,
      detail: `${c.flag} ${c.country}`,
      amount: c.amount,
      memo: `Payroll · ${cycle} cycle`,
      ts: now + i,
      contractorId: c.id,
    });
    queueClaimEmail(c.email, c.name, p);
    return p;
  });
  persistStore();
  return { payments, total: round2(payments.reduce((a, p) => a + p.amount, 0)), count: payments.length };
}

export function payVendor(input: { vendor: string; amount: number; memo?: string }): Payment {
  const s = store();
  const q = input.vendor.trim().toLowerCase();
  let vendor = s.vendors.find((v) => v.id === input.vendor || v.name.toLowerCase() === q);
  if (!vendor) vendor = s.vendors.find((v) => v.name.toLowerCase().includes(q));
  if (!vendor) {
    vendor = { id: uid("v"), name: input.vendor.trim(), email: `pay@${q.replace(/[^a-z0-9]+/g, "")}.example`, category: "Vendor" };
    s.vendors.push(vendor);
  }
  const p = settle(s, {
    kind: "vendor",
    counterparty: vendor.name,
    detail: vendor.category,
    amount: round2(input.amount),
    memo: input.memo ?? "Vendor payment",
    ts: Date.now(),
    vendorId: vendor.id,
  });
  queueClaimEmail(vendor.email, vendor.name, p);
  persistStore();
  return p;
}

// ---------- pay by email ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Slip-style "pay anyone by email". Settles a shielded payment into escrow,
 * ensures a claim record for the recipient, and emails them a claim link + QR.
 * Recipient name resolves to a known contractor/vendor if the email matches,
 * else the raw lowercased email is used as both counterparty and registry key.
 * Note: this calls settle() directly (not payVendor), so it queues its own
 * single claim email — no double-send. */
export function payByEmail(input: {
  email: string;
  amount: number;
  memo?: string;
}): { payment: Payment; claimToken: string; claimUrl: string } | { error: string } {
  const s = store();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: `"${input.email}" is not a valid email address.` };
  if (!(input.amount > 0)) return { error: "Amount must be greater than 0." };

  const contractor = s.contractors.find((c) => c.email.toLowerCase() === email);
  const vendor = contractor ? undefined : s.vendors.find((v) => v.email.toLowerCase() === email);
  const resolvedName = contractor?.name ?? vendor?.name ?? email;

  const p = settle(s, {
    kind: "vendor",
    counterparty: resolvedName,
    detail: "Email transfer",
    amount: round2(input.amount),
    memo: input.memo ?? "Payment from Sable",
    ts: Date.now(),
    ...(vendor ? { vendorId: vendor.id } : {}),
  });

  const rec = ensureClaim(email, resolvedName);
  queueClaimEmail(email, resolvedName, p);
  persistStore();
  return { payment: p, claimToken: rec.token, claimUrl: claimUrlFor(rec.token) };
}

// ---------- viewing keys ----------

export function createViewingKey(scope: ViewingKeyScope, label?: string): ViewingKey {
  const s = store();
  const auto =
    scope.type === "payment"
      ? "Single transaction"
      : scope.type === "vendor"
        ? `Vendor · ${s.vendors.find((v) => v.id === scope.id)?.name ?? scope.id}`
        : scope.type === "run"
          ? `Fleet run · ${s.runs.find((r) => r.id === scope.id)?.goal ?? scope.id}`
          : "Full ledger";
  const vk: ViewingKey = { key: `svk_${b58(24)}`, label: label ?? auto, scope, createdAt: Date.now() };
  s.keys.unshift(vk);
  persistStore();
  return vk;
}

export function resolveViewingKey(key: string): { key: ViewingKey; payments: Payment[] } | null {
  const s = store();
  const vk = s.keys.find((k) => k.key === key);
  if (!vk) return null;
  const scope = vk.scope;
  const payments = s.payments.filter((p) => {
    if (scope.type === "all") return true;
    if (scope.type === "payment") return p.id === scope.id;
    if (scope.type === "vendor") return p.vendorId === scope.id;
    if (scope.type === "run") return p.runId === scope.id;
    return false;
  });
  return { key: vk, payments };
}

// ---------- agent fleet ----------

/** The budget guard. The ONLY path by which agent money moves. Enforces both
 * the subagent's delegated cap and the run's total budget — refusal, not policy. */
function guardSpend(run: AgentRun, sa: Subagent, amount: number, host: string, path: string, memo: string): Payment | null {
  const s = store();
  const amt = round2(amount);
  if (sa.spent + amt > sa.cap) {
    const reason = `$${amt.toFixed(2)} to ${host} exceeds ${sa.name}'s delegated cap ($${sa.cap.toFixed(2)} — $${sa.spent.toFixed(2)} spent)`;
    run.blocked.push({ ts: Date.now(), subagentId: sa.id, amount: amt, reason });
    sa.events.push({ ts: Date.now(), kind: "blocked", text: `BLOCKED — ${reason}. Signature refused by budget guard.` });
    return null;
  }
  if (run.spent + amt > run.budget) {
    const reason = `$${amt.toFixed(2)} would exceed the fleet budget ($${run.budget.toFixed(2)} — $${run.spent.toFixed(2)} spent)`;
    run.blocked.push({ ts: Date.now(), subagentId: sa.id, amount: amt, reason });
    sa.events.push({ ts: Date.now(), kind: "blocked", text: `BLOCKED — ${reason}. Signature refused by budget guard.` });
    return null;
  }
  const p = settle(s, { kind: "agent", counterparty: host, detail: path, amount: amt, memo, ts: Date.now(), runId: run.id, subagentId: sa.id });
  sa.spent = round2(sa.spent + amt);
  run.spent = round2(run.spent + amt);
  sa.events.push({ ts: Date.now(), kind: "pay", text: `Paid $${amt.toFixed(2)} → ${host} · settled ${180 + Math.floor(Math.random() * 420)}ms · shielded` });
  return p;
}

export function dispatchFleet(goal: string, budget: number): AgentRun {
  const s = store();
  const b = round2(Math.max(0.5, budget));
  const run: AgentRun = {
    id: uid("run"),
    goal,
    budget: b,
    spent: 0,
    status: "running",
    startedAt: Date.now(),
    blocked: [],
    purchases: [],
    subagents: [
      { id: uid("sa"), name: "kit-alpha", role: "Prospector", task: "Discover and purchase primary source data over x402", cap: round2(b * 0.4), spent: 0, status: "pending", events: [] },
      { id: uid("sa"), name: "kit-bravo", role: "Enricher", task: "Pay per-call enrichment APIs to verify and augment", cap: round2(b * 0.3), spent: 0, status: "pending", events: [] },
      { id: uid("sa"), name: "kit-charlie", role: "Synthesist", task: "Purchase compute and assemble the deliverable", cap: round2(b * 0.25), spent: 0, status: "pending", events: [] },
    ],
  };
  s.runs.unshift(run);

  // Devnet: hand off to the real x402 orchestrator (fire-and-forget) and return
  // the run immediately, exactly like the sim path does.
  if (chainMode() === "devnet") {
    // Session keys minted for the fleet — completes the delegate → ct → revoke
    // story on the public explorer (haltRun emits the matching revoke row).
    s.slot += 1;
    s.explorer.unshift({ slot: s.slot, sig: fakeSig(), ts: Date.now(), program: "DelegationRegistry", kind: "delegate" });
    persistStore();
    keepAlive(orchestrateDevnetFleet(run, goal));
    return run;
  }

  const [a, bAgent, c] = run.subagents;
  const scale = b / 5; // amounts written for a $5 budget, scaled
  const ev = (sa: Subagent, kind: SubagentEvent["kind"], text: string) => {
    sa.events.push({ ts: Date.now(), kind, text });
  };
  const alive = () => run.status === "running";

  type Step = [number, () => void];
  const steps: Step[] = [
    [600, () => { a.status = "working"; ev(a, "info", `Decomposed goal — scanning x402 Bazaar for sources matching “${goal.slice(0, 48)}”`); }],
    [1400, () => ev(a, "x402", "402 Payment Required ← bazaar.x402.dev/listings/data · quote $" + round2(0.45 * scale).toFixed(2))],
    [900, () => guardSpend(run, a, 0.45 * scale, "bazaar.x402.dev", "/listings/data", "x402 discovery index")],
    [1200, () => { bAgent.status = "working"; ev(bAgent, "info", "Waiting on prospector shortlist — warming enrichment session keys"); }],
    [1100, () => ev(a, "x402", "402 Payment Required ← data.snowdrift.co/v1/orderbook · quote $" + round2(1.1 * scale).toFixed(2))],
    [800, () => guardSpend(run, a, 1.1 * scale, "data.snowdrift.co", "/v1/orderbook", "x402 dataset purchase")],
    [700, () => { a.status = "done"; ev(a, "done", `Handed 2 sources up to orchestrator · $${a.spent.toFixed(2)} of $${a.cap.toFixed(2)} cap`); }],
    [900, () => ev(bAgent, "x402", "402 Payment Required ← api.lexica.dev/enrich · $" + round2(0.62 * scale).toFixed(2) + " per batch")],
    [800, () => guardSpend(run, bAgent, 0.62 * scale, "api.lexica.dev", "/enrich", "x402 enrichment ×64 calls")],
    [1300, () => guardSpend(run, bAgent, 0.55 * scale, "api.lexica.dev", "/enrich", "x402 enrichment ×58 calls")],
    // the deliberate overspend attempt — refused by the guard, on camera
    [1200, () => guardSpend(run, bAgent, 0.62 * scale, "api.lexica.dev", "/enrich", "x402 enrichment ×64 calls")],
    [600, () => { bAgent.status = "done"; ev(bAgent, "done", `Enrichment complete under cap · $${bAgent.spent.toFixed(2)} of $${bAgent.cap.toFixed(2)}`); }],
    [800, () => { c.status = "working"; ev(c, "info", "Collected upstream results — requesting compute quote"); }],
    [1100, () => ev(c, "x402", "402 Payment Required ← compute.meridian.gg/run · quote $" + round2(1.05 * scale).toFixed(2))],
    [900, () => guardSpend(run, c, 1.05 * scale, "compute.meridian.gg", "/run", "x402 compute · 4 vCPU·min")],
    [1600, () => { c.status = "done"; ev(c, "done", `Synthesis complete · $${c.spent.toFixed(2)} of $${c.cap.toFixed(2)} cap`); }],
    [700, () => {
      run.status = "complete";
      run.completedAt = Date.now();
      const nPaid = s.payments.filter((p) => p.runId === run.id).length;
      run.result = `Deliverable — ${goal}. Assembled from ${nPaid} paid x402 sources for $${run.spent.toFixed(2)} of the $${run.budget.toFixed(2)} cap (${run.blocked.length} overspend attempt${run.blocked.length === 1 ? "" : "s"} refused by the budget guard). Full itemized spend tree is in the ledger under one viewing key.`;
    }],
  ];

  let delay = 0;
  for (const [gap, fn] of steps) {
    delay += gap;
    const t = setTimeout(() => { if (alive()) { fn(); persistStore(); } }, delay);
    s.timers.push(t);
  }
  persistStore();
  return run;
}

// x402 host labels for the ledger — matched to the sim path's counterparties.
const X402_HOSTS: Record<"listings" | "orderbook" | "enrich" | "compute", string> = {
  listings: "bazaar.x402.dev",
  orderbook: "data.snowdrift.co",
  enrich: "api.lexica.dev",
  compute: "compute.meridian.gg",
};

/** The devnet fleet: same three subagents, caps, events and money path as the
 * sim script, but every x402 quote is fetched from a real local endpoint and every
 * payment is a real Solana devnet transfer. Fire-and-forget — dispatchFleet does
 * not await it. Checks run.status before each step so the kill switch works. */
async function orchestrateDevnetFleet(run: AgentRun, goal: string): Promise<void> {
  const [alpha, bravo, charlie] = run.subagents;
  const ev = (sa: Subagent, kind: SubagentEvent["kind"], text: string) => {
    sa.events.push({ ts: Date.now(), kind, text });
    persistStore(); // stream progress to other instances between polls
  };
  const gap = () => new Promise<void>((r) => setTimeout(r, 400 + Math.floor(Math.random() * 500)));
  const alive = () => run.status !== "halted";
  // Amounts are written for a $5 budget; scale keeps the endpoint quotes (and thus
  // the cap proportions) constant relative to budget, so the demo's one bravo block
  // lands at any budget. `call` selects the enrich price tier (0.62 / 0.55 / 0.62).
  const scale = run.budget / 5;

  // One x402 purchase by a subagent. authorize() is the budget guard (sync cap +
  // budget check, refusal on failure); pay() is the real settlement. On success we
  // record the ledger row ourselves with the real sig.
  const buy = async (sa: Subagent, service: "listings" | "orderbook" | "enrich" | "compute", call?: number): Promise<X402Result> => {
    const result = await payAndFetch(service, {
      scale,
      call,
      authorize: (quote) => {
        const amt = round2(quote.amount);
        // Same flavor ordering as the sim: show the 402 quote before deciding.
        ev(sa, "x402", `402 Payment Required ← ${quote.resource} · quote $${amt.toFixed(2)} · nonce ${quote.memo.slice(-8)}`);
        const okCap = sa.spent + amt <= sa.cap;
        const okBudget = run.spent + amt <= run.budget;
        if (!okCap || !okBudget) {
          const reason = !okCap
            ? `$${amt.toFixed(2)} to ${quote.resource} exceeds ${sa.name}'s delegated cap ($${sa.cap.toFixed(2)} — $${sa.spent.toFixed(2)} spent)`
            : `$${amt.toFixed(2)} would exceed the fleet budget ($${run.budget.toFixed(2)} — $${run.spent.toFixed(2)} spent)`;
          run.blocked.push({ ts: Date.now(), subagentId: sa.id, amount: amt, reason });
          ev(sa, "blocked", `BLOCKED — ${reason}. Signature refused by budget guard.`);
          return false;
        }
        return true;
      },
      // recipient is a logical NAME (not an address) so it matches the x402
      // service's registry entry; memo carries the endpoint nonce it verifies.
      pay: async (quote) => {
        ev(sa, "x402", `Authorized under cap — settling $${round2(quote.amount).toFixed(2)} on devnet…`);
        const res = await settleOnChain({ recipient: `x402:${service}`, amount: round2(quote.amount), memo: quote.memo });
        ev(sa, "pay", `Settled on-chain · ${res.sig.slice(0, 8)}… · memo carries quote nonce`);
        return res;
      },
    });
    if (result.ok && result.sig) {
      const amt = round2(result.quote.amount);
      ev(sa, "x402", `X-PAYMENT accepted → 200 OK (${result.bytes ?? 0} bytes)`);
      ev(sa, "pay", `Paid $${amt.toFixed(2)} → ${result.quote.resource} · settled on devnet · ${result.sig.slice(0, 8)}…`);
      (run.purchases ??= []).push({
        id: uid("rcpt"),
        subagentId: sa.id,
        service,
        host: X402_HOSTS[service],
        resource: result.quote.resource,
        amountUsd: amt,
        sig: result.sig,
        explorerUrl: result.explorerUrl,
        nonce: result.receipt?.nonce ?? result.quote.memo,
        ts: Date.now(),
        summary: summarizePayload(service as ServiceName, result.data),
        preview: JSON.stringify(result.data ?? {}, null, 1).slice(0, 400),
      });
      const payment: Payment = {
        id: uid("pay"),
        kind: "agent",
        counterparty: X402_HOSTS[service],
        detail: result.quote.resource,
        amount: amt,
        memo: result.quote.memo,
        ts: Date.now(),
        sig: result.sig,
        status: "settled",
        chain: "devnet",
        explorerUrl: result.explorerUrl,
        runId: run.id,
        subagentId: sa.id,
      };
      // Fresh store() lookup — a hydrate() may have swapped the store object
      // since dispatch; the run/subagent objects stay live via the load() graft.
      const st = store();
      st.payments.unshift(payment);
      st.balance = round2(st.balance - amt);
      sa.spent = round2(sa.spent + amt);
      run.spent = round2(run.spent + amt);
      st.slot += 1 + Math.floor(Math.random() * 40);
      st.explorer.unshift({ slot: st.slot, sig: result.sig, ts: payment.ts, program: "ZkConfidentialTransfer", kind: "ct" });
      persistStore();
    } else if (!result.ok && result.error && result.error !== "refused by budget guard") {
      // Budget refusals already logged a "blocked" event in authorize().
      ev(sa, "info", `x402 handshake failed: ${result.error}`);
    }
    return result;
  };

  try {
    // kit-alpha — discover + buy two primary sources
    if (!alive()) return;
    alpha.status = "working";
    ev(alpha, "info", `Decomposed goal — scanning x402 Bazaar for sources matching “${goal.slice(0, 48)}”`);
    await gap();
    if (!alive()) return;
    await buy(alpha, "listings");
    await gap();
    if (!alive()) return;
    await buy(alpha, "orderbook");
    await gap();
    if (!alive()) return;
    alpha.status = "done";
    ev(alpha, "done", `Handed 2 sources up to orchestrator · $${alpha.spent.toFixed(2)} of $${alpha.cap.toFixed(2)} cap`);

    // kit-bravo — enrich twice, then a third attempt the guard refuses
    if (!alive()) return;
    bravo.status = "working";
    ev(bravo, "info", "Warming enrichment session keys — sampling per-call feeds");
    await gap();
    if (!alive()) return;
    await buy(bravo, "enrich", 1);
    await gap();
    if (!alive()) return;
    await buy(bravo, "enrich", 2);
    await gap();
    if (!alive()) return;
    await buy(bravo, "enrich", 3); // the deliberate overspend — refused by the guard, on camera
    await gap();
    if (!alive()) return;
    bravo.status = "done";
    ev(bravo, "done", `Enrichment complete under cap · $${bravo.spent.toFixed(2)} of $${bravo.cap.toFixed(2)}`);

    // kit-charlie — buy compute, assemble deliverable
    if (!alive()) return;
    charlie.status = "working";
    ev(charlie, "info", "Collected upstream results — requesting compute quote");
    await gap();
    if (!alive()) return;
    await buy(charlie, "compute");
    await gap();
    if (!alive()) return;
    charlie.status = "done";
    ev(charlie, "done", `Synthesis complete · $${charlie.spent.toFixed(2)} of $${charlie.cap.toFixed(2)} cap`);

    if (!alive()) return;
    run.status = "complete";
    run.completedAt = Date.now();
    const nPaid = store().payments.filter((p) => p.runId === run.id).length;
    run.result = `Deliverable — ${goal}. Assembled from ${nPaid} paid x402 sources for $${run.spent.toFixed(2)} of the $${run.budget.toFixed(2)} cap (${run.blocked.length} overspend attempt${run.blocked.length === 1 ? "" : "s"} refused by the budget guard). Full itemized spend tree is in the ledger under one viewing key.`;
    persistStore();
  } catch (err: unknown) {
    // Never leave the run stuck "running" — complete it early with the reason.
    const msg = err instanceof Error ? err.message : String(err);
    run.status = "complete";
    run.completedAt = Date.now();
    run.result = `Run ended early: ${msg}. Spent $${run.spent.toFixed(2)} of $${run.budget.toFixed(2)}.`;
    persistStore();
  }
}

export function haltRun(runId: string): AgentRun | null {
  const s = store();
  const run = s.runs.find((r) => r.id === runId);
  if (!run) return null;
  if (run.status === "running") {
    run.status = "halted";
    run.completedAt = Date.now();
    for (const sa of run.subagents) {
      if (sa.status === "pending" || sa.status === "working") {
        sa.status = "halted";
        sa.events.push({ ts: Date.now(), kind: "info", text: "Delegation revoked — session key invalidated by kill switch." });
      }
    }
    s.slot += 1;
    s.explorer.unshift({ slot: s.slot, sig: fakeSig(), ts: Date.now(), program: "DelegationRegistry", kind: "revoke" });
    persistStore();
  }
  return run;
}

export function getRun(runId: string): AgentRun | null {
  return store().runs.find((r) => r.id === runId) ?? null;
}
