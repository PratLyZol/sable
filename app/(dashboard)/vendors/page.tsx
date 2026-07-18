"use client";

import { useState } from "react";
import Link from "next/link";
import { useLive } from "@/lib/useLive";
import { usd, timeAgo, shortSig } from "@/lib/format";
import type { Payment, ViewingKey } from "@/lib/store";

export default function Vendors() {
  const snap = useLive();
  const keys = snap?.keys ?? [];
  const vendorPayments = (snap?.payments ?? []).filter((p) => p.kind === "vendor");

  // per-row disclosure keys
  const [disclosed, setDisclosed] = useState<Record<string, ViewingKey>>({});
  const [disclosing, setDisclosing] = useState<Record<string, boolean>>({});

  const disclose = async (p: Payment) => {
    if (disclosing[p.id] || disclosed[p.id]) return;
    setDisclosing((d) => ({ ...d, [p.id]: true }));
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: { type: "payment", id: p.id },
          label: `${p.counterparty} — single payment`,
        }),
      });
      if (res.ok) {
        const key: ViewingKey = await res.json();
        setDisclosed((d) => ({ ...d, [p.id]: key }));
      }
    } finally {
      setDisclosing((d) => ({ ...d, [p.id]: false }));
    }
  };

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Confidential vendor payments</div>
        <h1 className="display text-3xl text-ink mt-2">Pay suppliers, not the whole chain.</h1>
        <p className="text-dim mt-2">
          Amounts and counterparties settle shielded. Hand an auditor a viewing key for exactly what they need to see.
          To send one, ask the copilot — “Pay Halcyon Cloud $2,140 for July infra.”
        </p>
      </header>

      <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        {/* LEFT column */}
        <div className="flex flex-col gap-6">
          <div className="panel p-5">
            <div className="eyebrow mb-3">Viewing keys</div>
            <div className="flex flex-col gap-2.5">
              {keys.length === 0 ? (
                <span className="text-faint">…</span>
              ) : (
                keys.map((k) => (
                  <div key={k.key} className="flex items-center gap-2 flex-wrap">
                    <span className="chip chip-gold">{shortSig(k.key, 4)}</span>
                    <span className="text-dim text-sm min-w-0 truncate">{k.label}</span>
                    <span className="text-faint text-xs">{timeAgo(k.createdAt)}</span>
                    <Link
                      href={`/disclose/${k.key}`}
                      className="text-gold text-xs ml-auto"
                    >
                      auditor view →
                    </Link>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-dim mt-4 hairline pt-3">
              A viewing key decrypts exactly its scope — one payment, one vendor, or one run — and nothing else.
            </p>
          </div>
        </div>

        {/* RIGHT column */}
        <div className="panel">
          <div className="eyebrow px-4 pt-4 pb-1">Vendor payments</div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Category</th>
                <th>Memo</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>When</th>
                <th style={{ textAlign: "right" }}>Disclose</th>
              </tr>
            </thead>
            <tbody>
              {vendorPayments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-faint">…</td>
                </tr>
              ) : (
                vendorPayments.map((p) => {
                  const key = disclosed[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="text-ink">{p.counterparty}</td>
                      <td className="text-dim">{p.detail}</td>
                      <td className="text-dim text-xs">{p.memo}</td>
                      <td className="num text-ink" style={{ textAlign: "right" }}>
                        {usd(p.amount)}
                      </td>
                      <td className="text-faint text-xs">{timeAgo(p.ts)}</td>
                      <td style={{ textAlign: "right" }}>
                        {key ? (
                          <Link href={`/disclose/${key.key}`} className="chip chip-gold">
                            {shortSig(key.key, 4)} →
                          </Link>
                        ) : (
                          <button
                            className="btn-ghost btn"
                            onClick={() => disclose(p)}
                            disabled={disclosing[p.id]}
                          >
                            {disclosing[p.id] ? "…" : "Disclose"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
