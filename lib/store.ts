// Sable in-memory store — the single source of truth for the demo.
// Shielded stablecoin payments (Solana Confidential Balances-style),
// x402 agent spend, scoped subagent budgets, and viewing-key disclosure.
// In "sim" mode everything is faked in-process; in "devnet" mode payments
// are settled for real on Solana devnet via lib/chain + lib/x402client.
// Persisted on globalThis so it survives HMR in dev.

import { chainMode, settleOnChain, treasuryAddressSync, treasuryTokenSync, type ChainMode } from "@/lib/chain";
import { payAndFetch, type X402Result } from "@/lib/x402client";

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
    { id: "c1", name: "Mariana Duarte", email: "mariana@duarte.pt", country: "Portugal", flag: "🇵🇹", role: "Product engineer", amount: 4200 },
    { id: "c2", name: "Ravi Menon", email: "ravi.menon@fastmail.in", country: "India", flag: "🇮🇳", role: "Data engineer", amount: 3850 },
    { id: "c3", name: "Camila Reyes", email: "camila@reyes.mx", country: "Mexico", flag: "🇲🇽", role: "Brand designer", amount: 3600 },
    { id: "c4", name: "Tunde Okafor", email: "tunde.o@hey.com", country: "Nigeria", flag: "🇳🇬", role: "Support lead", amount: 2900 },
    { id: "c5", name: "Aiko Tanaka", email: "aiko@tanaka.jp", country: "Japan", flag: "🇯🇵", role: "Research analyst", amount: 4750 },
  ];

  const vendors: Vendor[] = [
    { id: "v1", name: "Snowdrift Data Co.", email: "billing@snowdrift.co", category: "Market data" },
    { id: "v2", name: "Lexica Enrichment", email: "pay@lexica.dev", category: "Enrichment API" },
    { id: "v3", name: "Meridian Compute", email: "ar@meridian.gg", category: "GPU compute" },
    { id: "v4", name: "Northwind Logistics", email: "invoices@northwind.io", category: "Fulfillment" },
    { id: "v5", name: "Halcyon Cloud", email: "billing@halcyon.host", category: "Infrastructure" },
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
    const payment: Payment = { ...p, id: uid("pay"), sig: fakeSig(), status: "settled", chain: "sim" };
    store.payments.unshift(payment);
    store.balance = round2(store.balance - payment.amount);
    store.slot += 1 + Math.floor(Math.random() * 40);
    store.explorer.unshift({ slot: store.slot, sig: payment.sig, ts: payment.ts, program: "ZkConfidentialTransfer", kind: "ct" });
    return payment;
  };

  // this month's payroll, dated to the 2nd so MTD totals always include it
  const cycle = new Date();
  cycle.setDate(2);
  cycle.setHours(9, 0, 0, 0);
  const cycleName = cycle.toLocaleString("en-US", { month: "long" });
  contractors.forEach((c, i) => {
    pay({ kind: "payroll", counterparty: c.name, detail: `${c.flag} ${c.country}`, amount: c.amount, memo: `Payroll · ${cycleName} cycle`, ts: cycle.getTime() + i * h, contractorId: c.id });
  });
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
  settleOnChain({ recipient: payment.counterparty, amount: payment.amount, memo: payment.memo })
    .then((res) => {
      payment.sig = res.sig;
      payment.explorerUrl = res.explorerUrl;
      payment.status = "settled";
      // Only record the on-chain row once the real signature exists.
      s.slot += 1 + Math.floor(Math.random() * 40);
      s.explorer.unshift({ slot: s.slot, sig: res.sig, ts: payment.ts, program: "ZkConfidentialTransfer", kind: "ct" });
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      payment.status = "failed";
      payment.memo = `${payment.memo} · settlement failed: ${msg}`;
      s.balance = round2(s.balance + payment.amount); // refund
    });
  return payment;
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

export function runPayroll(contractorIds?: string[]): { payments: Payment[]; total: number; count: number } {
  const s = store();
  const targets = contractorIds?.length ? s.contractors.filter((c) => contractorIds.includes(c.id)) : s.contractors;
  const now = Date.now();
  const cycle = new Date().toLocaleString("en-US", { month: "long" });
  const payments = targets.map((c, i) =>
    settle(s, {
      kind: "payroll",
      counterparty: c.name,
      detail: `${c.flag} ${c.country}`,
      amount: c.amount,
      memo: `Payroll · ${cycle} cycle`,
      ts: now + i,
      contractorId: c.id,
    }),
  );
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
  return settle(s, {
    kind: "vendor",
    counterparty: vendor.name,
    detail: vendor.category,
    amount: round2(input.amount),
    memo: input.memo ?? "Vendor payment",
    ts: Date.now(),
    vendorId: vendor.id,
  });
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
    void orchestrateDevnetFleet(s, run, goal);
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
    const t = setTimeout(() => { if (alive()) fn(); }, delay);
    s.timers.push(t);
  }
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
async function orchestrateDevnetFleet(s: Store, run: AgentRun, goal: string): Promise<void> {
  const [alpha, bravo, charlie] = run.subagents;
  const ev = (sa: Subagent, kind: SubagentEvent["kind"], text: string) => {
    sa.events.push({ ts: Date.now(), kind, text });
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
        ev(sa, "x402", `402 Payment Required ← ${quote.resource} · quote $${amt.toFixed(2)}`);
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
      pay: (quote) => settleOnChain({ recipient: `x402:${service}`, amount: round2(quote.amount), memo: quote.memo }),
    });
    if (result.ok && result.sig) {
      const amt = round2(result.quote.amount);
      ev(sa, "pay", `Paid $${amt.toFixed(2)} → ${result.quote.resource} · settled on devnet · ${result.sig.slice(0, 8)}…`);
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
      s.payments.unshift(payment);
      s.balance = round2(s.balance - amt);
      sa.spent = round2(sa.spent + amt);
      run.spent = round2(run.spent + amt);
      s.slot += 1 + Math.floor(Math.random() * 40);
      s.explorer.unshift({ slot: s.slot, sig: result.sig, ts: payment.ts, program: "ZkConfidentialTransfer", kind: "ct" });
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
    const nPaid = s.payments.filter((p) => p.runId === run.id).length;
    run.result = `Deliverable — ${goal}. Assembled from ${nPaid} paid x402 sources for $${run.spent.toFixed(2)} of the $${run.budget.toFixed(2)} cap (${run.blocked.length} overspend attempt${run.blocked.length === 1 ? "" : "s"} refused by the budget guard). Full itemized spend tree is in the ledger under one viewing key.`;
  } catch (err: unknown) {
    // Never leave the run stuck "running" — complete it early with the reason.
    const msg = err instanceof Error ? err.message : String(err);
    run.status = "complete";
    run.completedAt = Date.now();
    run.result = `Run ended early: ${msg}. Spent $${run.spent.toFixed(2)} of $${run.budget.toFixed(2)}.`;
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
  }
  return run;
}

export function getRun(runId: string): AgentRun | null {
  return store().runs.find((r) => r.id === runId) ?? null;
}
