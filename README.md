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

## Real devnet mode

The same dashboard can settle on **Solana devnet** for real instead of the in-memory rail. Three steps:

```bash
npm run devnet:setup                 # mints a token, funds the treasury, writes .sable/
# set SABLE_MODE=devnet in .env.local
npm run dev                          # restart so the server picks up the mode
```

What becomes real when `SABLE_MODE=devnet`:

- **Payments are Token-2022 transfers** of a USD token Sable mints to itself on devnet — payroll, vendor payouts, and agent spend all move real tokens between real accounts.
- **Real signatures and explorer links** — every settled payment carries its actual devnet transaction signature. Click any signature in payroll history, the ledger, the agents view, or the explorer to open it on Solana Explorer.
- **x402 endpoints are paid on-chain** — subagents hit real 402-gated endpoints and complete the `402 → pay → retry` handshake, with **replay-protected nonces** so a settled payment can't be reused.
- **The budget guard still refuses before signing** — the cap is enforced in the same single code path, so an overspend is rejected *before* any transaction is submitted, on devnet exactly as in the simulation.

**The honest caveat:** devnet's ZK proof verifier is disabled pending audit, so shielded confidential transfers can't be verified there yet. The demo token **is** confidential-transfer-ready, but devnet settlement is **public on-chain** — the shielded ledger in the app is Sable's privacy layer over the top, and mainnet is where the confidential rail lights up.

**Airdrops:** `npm run devnet:setup` generates and funds a treasury keypair stored in `.sable/`. If the built-in airdrop runs dry (devnet faucets are rate-limited), top the treasury address up at [faucet.solana.com](https://faucet.solana.com) and re-run the app.

## Pay to email (claim flow)

Every payment Sable makes — payroll, vendor payout, agent spend — emails the recipient a private claim link. No wallet, no seed phrase, nothing to install. The recipient opens the link (or scans the QR in the email) on their phone, taps **Claim funds**, and a fresh Solana keypair is generated **in their browser** and used to sweep the escrowed funds. Sable never sees the key: custody is non-custodial from the first tap.

- **Email → QR → wallet → sweep.** The claim email carries a QR of the claim link. Scanning it opens the recipient's wallet page (`/claim/<token>`), where the funds waiting in escrow are swept to a keypair held only in the recipient's `localStorage`. They can back up (copy/download) the secret key from that page.
- **The Outbox** (`/outbox`) is the sender's view: every claim email, its live preview, and a one-click **open claim page** link. With no email provider configured, this is where the emails live; with Resend configured, it mirrors what was sent.

**Demo it:**

1. **Run payroll** (`/payroll`) — the success strip links to the Outbox with the count of claim emails sent.
2. **Open the Outbox** (`/outbox`) — pick an email, preview it, and click **open claim page →**.
3. **Claim** — on the claim page, tap **Claim funds**. Watch the escrow sweep into a browser-held wallet, with the address, QR, and (in devnet) an Explorer link.

**Real email (optional):** set `RESEND_API_KEY` to send for real. The shared `onboarding@resend.dev` sender only delivers to the address that owns the Resend account, so verify your own domain (and set `SABLE_EMAIL_FROM`) to email arbitrary recipients. Without a key, everything still works — emails just land in the in-app Outbox.

**Phone-scan demo:** set `SABLE_PUBLIC_URL` to your machine's LAN IP (e.g. `http://192.168.1.42:3000`) and run the dev server with `next dev -H 0.0.0.0`. Claim links and QR codes then point at your LAN address so a phone on the same Wi-Fi can open them.

Claim bindings — which recipient claimed to which wallet address — persist in `.sable/claims.json`, so a claimed link stays bound to its wallet across restarts and refuses to be swept to a different device.

## The 3-minute demo

1. **Run payroll** (`/payroll`) — pay 5 contractors in 5 countries in one click. Then open **Explorer** (`/explorer`): the public chain view shows only ciphertext.
2. **Pay a vendor, then disclose it** (`/vendors`) — send a shielded payment, click **Disclose** on that row, and open the generated `/disclose/svk_…` link: the auditor view decrypts exactly that one payment and nothing else.
3. **Dispatch a paying fleet** (`/agents`) — goal + budget in, three subagents (`kit-alpha`, `kit-bravo`, `kit-charlie`) discover and pay for data, enrichment, and compute over x402 under scoped caps. Watch one overspend attempt get **refused by the budget guard**, live. The whole spend tree lands in the unified **Ledger** under one viewing key.
4. Or do all of it by talking to the **copilot** in the chat dock: *"Run payroll for everyone"*, *"Dispatch a fleet: market-research brief, $5 cap"*.

## What's real vs. simulated

**Real in this demo:** the three-surface dashboard, the orchestrator/subagent loop with scoped budgets, hard cap enforcement at the payment path (`guardSpend` in `lib/store.ts` is the *only* way agent money moves — overspends are refused, not logged), viewing-key scoped disclosure, the public/private explorer contrast, and an LLM copilot that executes payroll, vendor payments, fleet dispatches, viewing keys, and the kill switch through tool calls.

**Simulated by default:** the chain itself. In the default mode, payments settle into an in-memory ledger with fake Solana signatures standing in for Confidential Balances transfers; x402 quotes/settlement are scripted.

**Real with `SABLE_MODE=devnet`:** flip the switch (see [Real devnet mode](#real-devnet-mode)) and payments become on-chain Token-2022 transfers on Solana devnet, with real signatures, explorer links, and x402 endpoints paid on-chain over a replay-protected `402 → pay → retry` handshake — the budget guard still refusing overspends before anything is signed. The one thing devnet can't do yet is verify shielded confidential transfers (its ZK verifier is audit-disabled), so devnet settlement is public; the token is confidential-transfer-ready for mainnet.

Post-hackathon path: Solana Confidential Balances or Hinkal for the shielded rail on mainnet, a CDP/PayAI facilitator for x402, ERC-7710/7715-style scoped delegation on-chain, Skyfire for KYA, and Ramp-native reconciliation export.

## Why this wins "Save Time. Save Money."

- **Runaway spend is impossible** — the fleet physically can't exceed its cap; the biggest fear about autonomous paying agents is answered at the signature layer, not by policy.
- **Pricing leverage stays private** — competitors can't reverse-engineer vendor discounts or agent strategy from public chain data.
- **No wire fees, no wallet onboarding** — contractors and vendors get paid to an email, globally, in seconds.
- **Month-end close, not month-end archaeology** — payroll, vendors, and the entire agent spend tree reconcile into one ledger, disclosable to exactly the people who should see it.

## Stack

Next.js 16 (App Router) · Tailwind v4 · AI SDK v7 (`streamText` + server-side tools, `useChat`) via Vercel AI Gateway → Claude · simulated confidential-transfer + x402 rail in `lib/store.ts`.
