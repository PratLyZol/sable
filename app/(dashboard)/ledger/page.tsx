"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "@/lib/useLive";
import { usdc, clock, shortSig } from "@/lib/format";
import type { Payment, PaymentKind, ViewingKey } from "@/lib/store";

type Filter = "all" | PaymentKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "payroll", label: "Payroll" },
  { id: "vendor", label: "Vendors" },
  { id: "agent", label: "Agents" },
];

function dateShort(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function KindChip({ kind }: { kind: PaymentKind }) {
  const label = kind === "vendor" ? "vendor" : kind;
  return <span className={`chip ${kind === "agent" ? "chip-veil" : ""}`}>{label}</span>;
}

// Renders a payment's on-chain signature: a live "settling" chip while the
// devnet transfer confirms, "failed" on error, an Explorer link once the real
// sig lands, or the plain sig for simulated transfers.
function PaymentSig({ p }: { p: Payment }) {
  if (p.status === "settling") return <span className="chip chip-gold pulse">settling ⛓</span>;
  if (p.status === "failed") return <span className="chip chip-bad">failed</span>;
  if (p.explorerUrl)
    return (
      <a
        href={p.explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="sig hover:underline"
        title="View on Solana Explorer"
      >
        {shortSig(p.sig)}
      </a>
    );
  return <span className="sig">{shortSig(p.sig)}</span>;
}

export default function Ledger() {
  const snap = useLive();
  const [filter, setFilter] = useState<Filter>("all");
  const [auditorKey, setAuditorKey] = useState<ViewingKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const payments = snap?.payments ?? [];
  const filtered = filter === "all" ? payments : payments.filter((p) => p.kind === filter);

  const sumOf = (k: PaymentKind) =>
    payments.filter((p) => p.kind === k).reduce((a, p) => a + p.amount, 0);
  const grandTotal = filtered.reduce((a, p) => a + p.amount, 0);

  async function createKey() {
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: { type: "all" }, label: "Full ledger — auditor" }),
      });
      if (res.ok) setAuditorKey(await res.json());
    } finally {
      setCreating(false);
    }
  }

  function copyKey() {
    if (!auditorKey) return;
    navigator.clipboard?.writeText(auditorKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Reconciliation</div>
        <h1 className="display text-3xl text-ink mt-2">One ledger. Every rail.</h1>
      </header>

      <div className="flex items-center gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`chip ${filter === f.id ? "chip-gold" : ""}`}
            style={{ cursor: "pointer" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="panel p-4">
          <div className="eyebrow">Payroll</div>
          <div className="num text-xl text-ink mt-2">{snap ? usdc(sumOf("payroll")) : <span className="text-faint">…</span>}</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Vendors</div>
          <div className="num text-xl text-ink mt-2">{snap ? usdc(sumOf("vendor")) : <span className="text-faint">…</span>}</div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Agents</div>
          <div className="num text-xl text-ink mt-2">{snap ? usdc(sumOf("agent")) : <span className="text-faint">…</span>}</div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-strong)]">
          <div className="eyebrow">Ledger</div>
          <div className="flex items-center gap-2">
            {auditorKey ? (
              <>
                <button
                  onClick={copyKey}
                  className="chip chip-gold"
                  style={{ cursor: "pointer" }}
                  title="Copy viewing key"
                >
                  {copied ? "copied" : shortSig(auditorKey.key, 8)}
                </button>
                <Link href={`/disclose/${auditorKey.key}`} className="text-gold text-sm">
                  open auditor view →
                </Link>
              </>
            ) : (
              <button onClick={createKey} disabled={creating} className="btn-gold btn">
                {creating ? "Creating…" : "Create viewing key"}
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[560px] overflow-y-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Counterparty</th>
                <th>Memo</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Signature</th>
              </tr>
            </thead>
            <tbody>
              {snap ? (
                filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      <div className="num text-ink">{clock(p.ts)}</div>
                      <div className="text-faint text-xs">{dateShort(p.ts)}</div>
                    </td>
                    <td>
                      <KindChip kind={p.kind} />
                    </td>
                    <td>
                      <div className="text-ink">{p.counterparty}</div>
                      <div className="text-faint text-xs">
                        {p.detail}
                        {p.runId ? <span className="ml-2">run: {p.runId.slice(0, 8)}</span> : null}
                      </div>
                    </td>
                    <td className="text-dim">{p.memo}</td>
                    <td className="num text-ink text-right">{usdc(p.amount)}</td>
                    <td className="text-right">
                      <PaymentSig p={p} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="text-faint" colSpan={6}>
                    …
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--line-strong)]">
          <span className="text-dim text-sm">
            {snap ? `${filtered.length} transfer${filtered.length === 1 ? "" : "s"}` : "…"}
          </span>
          <span className="num text-ink">{snap ? usdc(grandTotal) : ""}</span>
        </div>
      </div>
    </div>
  );
}
