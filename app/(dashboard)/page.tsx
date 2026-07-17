"use client";

import Link from "next/link";
import { useLive } from "@/lib/useLive";
import { usdc, timeAgo } from "@/lib/format";
import type { PaymentKind } from "@/lib/store";

const KIND_LABEL: Record<PaymentKind, string> = {
  payroll: "payroll",
  vendor: "vendor",
  agent: "agent",
};

function KindChip({ kind }: { kind: PaymentKind }) {
  return <span className={`chip ${kind === "agent" ? "chip-veil" : ""}`}>{KIND_LABEL[kind]}</span>;
}

function Dim() {
  return <span className="text-faint">…</span>;
}

export default function Overview() {
  const snap = useLive();
  const runningRun = snap?.runs.find((r) => r.status === "running");

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Control plane</div>
        <h1 className="display text-3xl text-ink mt-2">Private by default. Disclosable on demand.</h1>
        <p className="text-dim mt-2">
          Payroll, vendors, and agent fleets settle over shielded stablecoin transfers — one treasury, one ledger.
        </p>
        {snap?.chain.mode === "devnet" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="chip chip-ok">Settling live on Solana devnet</span>
            <span className="text-xs text-dim">
              Payments below carry real transaction signatures — click any to verify on-chain.
            </span>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-4 gap-4">
        <div className="panel p-4">
          <div className="eyebrow">Treasury</div>
          <div className="num text-2xl text-ink mt-2">{snap ? usdc(snap.balance) : <Dim />}</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Payroll MTD</div>
          <div className="num text-2xl text-ink mt-2">{snap ? usdc(snap.totals.payrollMtd) : <Dim />}</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Agent spend</div>
          <div className="num text-2xl text-ink mt-2">{snap ? usdc(snap.totals.agentSpend) : <Dim />}</div>
          <div className="mt-2">
            {snap ? (
              snap.totals.blockedAttempts > 0 ? (
                <span className="chip chip-bad">{snap.totals.blockedAttempts} overspend refused</span>
              ) : (
                <span className="chip chip-ok">0 overspends</span>
              )
            ) : null}
          </div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Shielded transfers</div>
          <div className="num text-2xl text-ink mt-2">{snap ? snap.totals.shieldedCount : <Dim />}</div>
          <div className="mt-2">
            <span className="chip chip-veil">shielded</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4 mt-4">
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--line-strong)]">
            <div className="eyebrow">Recent activity</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>Counterparty</th>
                <th>Memo</th>
                <th className="text-right">Amount</th>
                <th className="text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {snap ? (
                snap.payments.slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <KindChip kind={p.kind} />
                    </td>
                    <td>
                      <div className="text-ink">{p.counterparty}</div>
                      <div className="text-faint text-xs">{p.detail}</div>
                    </td>
                    <td className="text-dim">{p.memo}</td>
                    <td className="num text-ink text-right">{usdc(p.amount)}</td>
                    <td className="text-faint text-right whitespace-nowrap">{timeAgo(p.ts)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="text-faint" colSpan={5}>
                    …
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel-raised p-4">
            <div className="flex items-center gap-2">
              <span className="shield-dot" />
              <span className="num text-ink">{snap ? snap.totals.shieldedCount : "…"}</span>
              <span className="text-dim text-sm">transfers shielded</span>
            </div>
            <div className="text-dim text-sm mt-2">
              <span className="num text-ink">{snap ? snap.keys.length : "…"}</span> viewing keys outstanding
            </div>
            <p className="text-xs text-dim mt-3">
              Amounts and counterparties are encrypted on-chain. Only viewing-key holders can decrypt.
            </p>
          </div>

          {runningRun ? (
            <Link href="/agents" className="panel p-4 block hover:border-[var(--line-strong)] transition-colors">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Active fleet</div>
                <span className="chip chip-veil pulse">fleet running</span>
              </div>
              <div className="text-ink text-sm mt-2">{runningRun.goal}</div>
              <div className="num text-sm text-dim mt-2">
                <span className="text-ink">{usdc(runningRun.spent)}</span> / {usdc(runningRun.budget)}
              </div>
            </Link>
          ) : null}

          <div className="panel p-4">
            <div className="eyebrow">Quick actions</div>
            <div className="flex flex-col gap-2 mt-3">
              <Link href="/payroll" className="btn justify-center">
                Run payroll
              </Link>
              <Link href="/agents" className="btn justify-center">
                Dispatch a fleet
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
