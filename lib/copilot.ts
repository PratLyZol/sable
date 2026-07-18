// Shared copilot brain: model selection, system prompt, and the tool set that
// executes dashboard actions. Used by /api/chat (streaming dock) and
// /api/command (one-shot agent command bars). Server-only.

import { anthropic } from "@ai-sdk/anthropic";
import { tool, type LanguageModel } from "ai";
import { z } from "zod";
import {
  getSnapshot,
  runPayroll,
  payVendor,
  payByEmail,
  dispatchFleet,
  createViewingKey,
  haltRun,
  type ViewingKeyScope,
} from "@/lib/store";

export const SYSTEM_PROMPT = `You are Sable's copilot, embedded directly in the Sable dashboard. Sable is a privacy-first stablecoin spending platform: walletless payroll, confidential vendor payments protected by viewing keys, and AI agent fleets that pay over x402 under hard budget caps.

You EXECUTE actions through your tools — you run payroll, send vendor payments, dispatch agent fleets, mint viewing keys, and trigger kill switches. You are not an advisor who describes steps; you take them.

Rules:
- Be concise and concrete. After acting, always state the exact amounts and counts (e.g. "Paid $1,275 to Snowdrift Data Co." or "Ran payroll for 5 contractors totaling $19,300").
- All payments are shielded USDC settled on confidential rails. Use plain USD amounts (e.g. $4,200).
- When you create a viewing key, always give the user the disclosure link in the form /disclose/<key>.
- When asked to pay a vendor that isn't in the list, just proceed — the system creates the vendor automatically.
- For ambiguous requests, call get_state first to ground yourself rather than asking the user to clarify.
- When you dispatch a fleet, tell the user the run takes a minute or so and they can watch it live on the Agents page.
- Every payroll and vendor payment automatically emails the recipient a claim link (visible in the Outbox). To pay someone not in the lists, use send_money with their email — always give the user the claim URL afterward.`;

export function selectModel(): LanguageModel | null {
  if (process.env.AI_GATEWAY_API_KEY) return "anthropic/claude-sonnet-5";
  if (process.env.ANTHROPIC_API_KEY) return anthropic("claude-sonnet-4-5");
  return null;
}

export const NO_KEY_ERROR =
  "Set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY in .env.local to enable the copilot.";

export type ActionReport = { name: string; summary: string };

/** Build the tool set. `onAction` (if given) is called once per executed tool
 * with a terse human summary — used by one-shot endpoints to report actions. */
export function buildTools(onAction?: (a: ActionReport) => void) {
  const report = (name: string, summary: string) => onAction?.({ name, summary });
  return {
    get_state: tool({
      description:
        "Read the current dashboard state: treasury balance, month-to-date totals, contractors, vendors, recent payments, agent runs, and viewing keys. Use this to ground yourself before acting on ambiguous requests.",
      inputSchema: z.object({}),
      execute: async () => {
        const s = getSnapshot();
        report("get_state", "read ledger");
        return {
          balance: s.balance,
          totals: s.totals,
          chain: s.chain,
          contractors: s.contractors.map((c) => ({ id: c.id, name: c.name, email: c.email, country: c.country, role: c.role, amount: c.amount })),
          vendors: s.vendors.map((v) => ({ id: v.id, name: v.name, email: v.email, category: v.category })),
          recentPayments: s.payments.slice(0, 5).map((p) => ({ counterparty: p.counterparty, amount: p.amount, kind: p.kind })),
          runs: s.runs.slice(0, 10).map((r) => ({ id: r.id, goal: r.goal, status: r.status, spent: r.spent, budget: r.budget })),
          viewingKeys: s.keys.slice(0, 10).map((k) => ({ key: k.key, label: k.label })),
        };
      },
    }),
    run_payroll: tool({
      description:
        "Run contractor payroll. Omit contractorIds to pay everyone, or pass specific contractor IDs to pay a subset. Amounts come from each contractor's pay cycle.",
      inputSchema: z.object({
        contractorIds: z.array(z.string()).optional().describe("Specific contractor IDs to pay; omit to pay all."),
      }),
      execute: async ({ contractorIds }) => {
        const r = runPayroll(contractorIds);
        report("run_payroll", `${r.count} paid · $${r.total.toLocaleString()}`);
        return { count: r.count, total: r.total, names: r.payments.map((p) => p.counterparty) };
      },
    }),
    pay_vendor: tool({
      description:
        "Send a confidential USDC payment to a vendor. If the vendor is not already known, it is created automatically. Amount must be greater than 0.",
      inputSchema: z.object({
        vendor: z.string().describe("Vendor name or ID."),
        amount: z.number().positive().describe("Amount in USD."),
        memo: z.string().optional().describe("Optional memo for the payment."),
      }),
      execute: async ({ vendor, amount, memo }) => {
        const p = payVendor({ vendor, amount, memo });
        report("pay_vendor", `$${p.amount.toLocaleString()} → ${p.counterparty}`);
        return { counterparty: p.counterparty, amount: p.amount, sig: p.sig, memo: p.memo };
      },
    }),
    send_money: tool({
      description:
        "Pay any email address. Sends shielded USDC into escrow and emails the recipient a claim link + QR that opens a wallet Sable creates for them. Works for people not in the contractor or vendor lists.",
      inputSchema: z.object({
        email: z.string().describe("Recipient's email address."),
        amount: z.number().positive().describe("Amount in USD."),
        memo: z.string().optional().describe("Optional memo for the payment."),
      }),
      execute: async ({ email, amount, memo }) => {
        const r = payByEmail({ email, amount, memo });
        if ("error" in r) return { error: r.error };
        report("send_money", `$${r.payment.amount.toLocaleString()} → ${email}`);
        return {
          counterparty: r.payment.counterparty,
          amount: r.payment.amount,
          claimUrl: r.claimUrl,
          note: "Share the claim link — it also appears in the Outbox.",
        };
      },
    }),
    dispatch_fleet: tool({
      description:
        "Dispatch an autonomous agent fleet to accomplish a goal, paying x402 endpoints under a hard total budget cap. Subagents each get a delegated sub-budget; overspend attempts are refused by the budget guard. The run can be watched live on the Agents page. Budget must be at least 0.5.",
      inputSchema: z.object({
        goal: z.string().describe("What the fleet should accomplish."),
        budget: z.number().min(0.5).describe("Total budget cap in USD (>= 0.5)."),
      }),
      execute: async ({ goal, budget }) => {
        const run = dispatchFleet(goal, budget);
        report("dispatch_fleet", `fleet dispatched · $${run.budget} cap`);
        return {
          runId: run.id,
          budget: run.budget,
          subagents: run.subagents.map((sa) => ({ name: sa.name, role: sa.role, cap: sa.cap })),
          note: "The run can be watched live on the Agents page.",
        };
      },
    }),
    create_viewing_key: tool({
      description:
        "Mint a scoped viewing key that discloses a subset of shielded payments to an auditor. Scope can be a single payment, all payments to a vendor, all spend in a fleet run, or the full ledger. Returns a /disclose/<key> link to share.",
      inputSchema: z.object({
        scopeType: z.enum(["payment", "vendor", "run", "all"]).describe("What the key discloses."),
        id: z.string().optional().describe("The payment, vendor, or run ID (required unless scopeType is 'all')."),
        label: z.string().optional().describe("Human-readable label for the key."),
      }),
      execute: async ({ scopeType, id, label }) => {
        let scope: ViewingKeyScope;
        if (scopeType === "all") {
          scope = { type: "all" };
        } else {
          if (!id) return { error: `scopeType '${scopeType}' requires an id.` };
          scope = { type: scopeType, id };
        }
        const vk = createViewingKey(scope, label);
        report("create_viewing_key", vk.label);
        return { key: vk.key, label: vk.label, discloseUrl: `/disclose/${vk.key}` };
      },
    }),
    halt_run: tool({
      description:
        "The kill switch. Immediately halt a running agent fleet, revoking every subagent's delegation so no further payments can settle.",
      inputSchema: z.object({
        runId: z.string().describe("The run ID to halt."),
      }),
      execute: async ({ runId }) => {
        const run = haltRun(runId);
        if (!run) return { error: "Run not found." };
        report("halt_run", `halted ${run.id}`);
        return { runId: run.id, status: run.status, spent: run.spent };
      },
    }),
  };
}
