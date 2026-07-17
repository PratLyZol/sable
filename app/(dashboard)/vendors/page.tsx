"use client";

import { useState } from "react";
import Link from "next/link";
import { useLive } from "@/lib/useLive";
import { usd, timeAgo, shortSig } from "@/lib/format";
import type { Payment, ViewingKey } from "@/lib/store";

const inputCls = "bg-panel2 border hairline rounded-lg px-3 py-2 w-full text-ink";

export default function Vendors() {
  const snap = useLive();
  const vendors = snap?.vendors ?? [];
  const keys = snap?.keys ?? [];
  const vendorPayments = (snap?.payments ?? []).filter((p) => p.kind === "vendor");

  // pay-a-vendor form
  const [vendor, setVendor] = useState("");
  const [newVendor, setNewVendor] = useState(false);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Payment | null>(null);

  // per-row disclosure keys
  const [disclosed, setDisclosed] = useState<Record<string, ViewingKey>>({});
  const [disclosing, setDisclosing] = useState<Record<string, boolean>>({});

  const send = async () => {
    const amt = parseFloat(amount);
    if (sending || !vendor.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setSending(true);
    setSent(null);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendor: vendor.trim(), amount: amt, memo: memo.trim() || undefined }),
      });
      if (res.ok) {
        setSent(await res.json());
        setAmount("");
        setMemo("");
      }
    } finally {
      setSending(false);
    }
  };

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
        </p>
      </header>

      <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        {/* LEFT column */}
        <div className="flex flex-col gap-6">
          <div className="panel-raised p-5">
            <div className="eyebrow mb-3">Pay a vendor</div>

            <label className="text-xs text-dim">Vendor</label>
            {newVendor ? (
              <input
                className={`${inputCls} mt-1`}
                placeholder="New vendor name"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            ) : (
              <select
                className={`${inputCls} mt-1`}
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              >
                <option value="">Select vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name} · {v.category}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn-ghost btn mt-1 text-xs"
              onClick={() => {
                setNewVendor((n) => !n);
                setVendor("");
              }}
            >
              {newVendor ? "← Pick existing vendor" : "New vendor…"}
            </button>

            <label className="text-xs text-dim mt-3 block">Amount (USDC)</label>
            <input
              className={`${inputCls} num mt-1`}
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />

            <label className="text-xs text-dim mt-3 block">Memo</label>
            <input
              className={`${inputCls} mt-1`}
              placeholder="What is this for?"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />

            <button className="btn-gold btn mt-4 w-full justify-center" onClick={send} disabled={sending}>
              {sending ? "Sending…" : "Send shielded payment"}
            </button>

            {sent && (
              <div className="panel mt-4 flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="chip chip-veil">
                  <span className="shield-dot" /> shielded
                </span>
                <span className="text-ink text-sm">{sent.counterparty}</span>
                <span className="num text-ink text-sm">{usd(sent.amount)}</span>
                <span className="sig">{shortSig(sent.sig)}</span>
              </div>
            )}
          </div>

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
