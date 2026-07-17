# Sable

**The private spending layer for AI agents — and the humans who run them.**

> Ramp Emerging Builders Hackathon — Track: **Save Time. Save Money.**

Sable is a privacy-first control plane for stablecoin payments. It gives businesses walletless payroll and vendor payouts, and it lets them **dispatch AI subagents with real budgets that autonomously pay for what they need over x402** — data, APIs, compute — and bring back the result. Every payment is shielded from competitors and rolled up under a viewing key you can hand your auditor. Private by default, disclosable on demand, budgeted so nothing runs away.

---

## Running it

```bash
npm install
cp .env.example .env.local   # add one key to enable the copilot chat
npm run dev
```

Open http://localhost:3000.

The copilot chat dock (bottom-right) needs **one** of these in `.env.local`:

- `AI_GATEWAY_API_KEY` — Vercel AI Gateway key (recommended)
- `ANTHROPIC_API_KEY` — direct Anthropic key

Everything else runs with zero configuration: the confidential-transfer rail, x402 settlement, and delegation layer are simulated in-process (see below), with the budget cap genuinely enforced in the only code path that moves agent money.

## The 3-minute demo

1. **Run payroll** (`/payroll`) — pay 5 contractors in 5 countries in one click. Then open **Explorer** (`/explorer`): the public chain view shows only ciphertext.
2. **Pay a vendor, then disclose it** (`/vendors`) — send a shielded payment, click **Disclose** on that row, and open the generated `/disclose/svk_…` link: the auditor view decrypts exactly that one payment and nothing else.
3. **Dispatch a paying fleet** (`/agents`) — goal + budget in, three subagents (`kit-alpha`, `kit-bravo`, `kit-charlie`) discover and pay for data, enrichment, and compute over x402 under scoped caps. Watch one overspend attempt get **refused by the budget guard**, live. The whole spend tree lands in the unified **Ledger** under one viewing key.
4. Or do all of it by talking to the **copilot** in the chat dock: *"Run payroll for everyone"*, *"Dispatch a fleet: market-research brief, $5 cap"*.

## What's real vs. simulated

**Real in this demo:** the three-surface dashboard, the orchestrator/subagent loop with scoped budgets, hard cap enforcement at the payment path (`guardSpend` in `lib/store.ts` is the *only* way agent money moves — overspends are refused, not logged), viewing-key scoped disclosure, the public/private explorer contrast, and an LLM copilot that executes payroll, vendor payments, fleet dispatches, viewing keys, and the kill switch through tool calls.

**Simulated:** the chain itself. Payments settle into an in-memory ledger with fake Solana signatures standing in for Confidential Balances transfers; x402 quotes/settlement are scripted. Post-hackathon path: Solana Confidential Balances or Hinkal for the shielded rail, a CDP/PayAI facilitator for x402, ERC-7710/7715-style scoped delegation on-chain, Skyfire for KYA, and Ramp-native reconciliation export.

## Why this wins "Save Time. Save Money."

- **Runaway spend is impossible** — the fleet physically can't exceed its cap; the biggest fear about autonomous paying agents is answered at the signature layer, not by policy.
- **Pricing leverage stays private** — competitors can't reverse-engineer vendor discounts or agent strategy from public chain data.
- **No wire fees, no wallet onboarding** — contractors and vendors get paid to an email, globally, in seconds.
- **Month-end close, not month-end archaeology** — payroll, vendors, and the entire agent spend tree reconcile into one ledger, disclosable to exactly the people who should see it.

## Stack

Next.js 16 (App Router) · Tailwind v4 · AI SDK v7 (`streamText` + server-side tools, `useChat`) via Vercel AI Gateway → Claude · simulated confidential-transfer + x402 rail in `lib/store.ts`.
