"use client";

import { useState } from "react";
import { useLive } from "@/lib/useLive";
import { usd, timeAgo, shortSig } from "@/lib/format";
import type { Payment } from "@/lib/store";

type RunResult = { payments: Payment[]; total: number; count: number };

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

export default function Payroll() {
  const snap = useLive();
  const contractors = snap?.contractors ?? [];

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  // Default: everyone checked. Initialize lazily once contractors arrive.
  const sel = selected ?? new Set(contractors.map((c) => c.id));

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const chosen = contractors.filter((c) => sel.has(c.id));
  const total = chosen.reduce((a, c) => a + c.amount, 0);

  const run = async () => {
    if (pending || chosen.length === 0) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractorIds: chosen.map((c) => c.id) }),
      });
      if (res.ok) setResult(await res.json());
    } finally {
      setPending(false);
    }
  };

  const history = (snap?.payments ?? []).filter((p) => p.kind === "payroll").slice(0, 10);

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Walletless payroll</div>
        <h1 className="display text-3xl text-ink mt-2">Payday, without wallets.</h1>
        <p className="text-dim mt-2">
          Contractors get paid to an email. No seed phrases, no wire fees, nothing public.
        </p>
      </header>

      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>Contractor</th>
              <th>Role</th>
              <th>Country</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {contractors.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-faint">…</td>
              </tr>
            ) : (
              contractors.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={sel.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Include ${c.name}`}
                      className="accent-gold"
                    />
                  </td>
                  <td>
                    <div className="text-ink">{c.name}</div>
                    <div className="text-faint text-xs">{c.email}</div>
                  </td>
                  <td className="text-dim">{c.role}</td>
                  <td className="text-dim">
                    {c.flag} {c.country}
                  </td>
                  <td className="num text-ink" style={{ textAlign: "right" }}>
                    {usd(c.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="hairline flex items-center justify-between px-4 py-3">
          <div className="text-dim text-sm">
            {sel.size} selected · <span className="num text-ink">{usd(total)}</span>
          </div>
          <button className="btn-gold btn" onClick={run} disabled={pending || chosen.length === 0}>
            {pending ? "Settling…" : "Run payroll"}
          </button>
        </div>
      </div>

      {result && (
        <div className="panel-raised mt-4 flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="chip chip-ok">{result.count} payments settled</span>
          <span className="num text-ink">{usd(result.total)}</span>
          <span className="chip chip-veil">
            <span className="shield-dot" /> amounts shielded on-chain
          </span>
          <span className="text-xs text-dim">settled in 1.2s · $0.003 network fees</span>
        </div>
      )}

      <section className="mt-8">
        <div className="eyebrow mb-3">Payroll history</div>
        <div className="panel max-h-[420px] overflow-y-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Detail</th>
                <th>Memo</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>When</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-faint">…</td>
                </tr>
              ) : (
                history.map((p) => (
                  <tr key={p.id}>
                    <td className="text-ink">{p.counterparty}</td>
                    <td className="text-dim">{p.detail}</td>
                    <td className="text-dim text-xs">{p.memo}</td>
                    <td className="num text-ink" style={{ textAlign: "right" }}>
                      {usd(p.amount)}
                    </td>
                    <td className="text-faint text-xs">{timeAgo(p.ts)}</td>
                    <td><PaymentSig p={p} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
