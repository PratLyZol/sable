"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { usd } from "@/lib/format";
import { Cipher } from "@/components/Cipher";
import type { Payment, ViewingKey } from "@/lib/store";

type Disclosure = { key: ViewingKey; payments: Payment[] };

const PAPER = "#f2ecdf";
const INK = "#2a221c";
const MUTED = "#8a7a66";
const PANEL = "#faf6ec";
const LINE = "rgba(42,34,28,.15)";
const PANEL_LINE = "rgba(42,34,28,.12)";

function scopeLabel(scope: ViewingKey["scope"]): string {
  switch (scope.type) {
    case "payment":
      return "Single payment";
    case "vendor":
      return "One vendor";
    case "run":
      return "One fleet run";
    case "all":
      return "Full ledger";
  }
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function Disclose() {
  const params = useParams();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;

  const [state, setState] = useState<"loading" | "invalid" | "valid">("loading");
  const [data, setData] = useState<Disclosure | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`/api/disclose/${key}`, { cache: "no-store" });
        if (dead) return;
        if (!res.ok) {
          setState("invalid");
          return;
        }
        const json: Disclosure = await res.json();
        setData(json);
        setState("valid");
        // the decrypt-settle moment
        setTimeout(() => {
          if (!dead) setRevealed(true);
        }, 700);
      } catch {
        if (!dead) setState("invalid");
      }
    })();
    return () => {
      dead = true;
    };
  }, [key]);

  return (
    <div style={{ background: PAPER, color: INK, minHeight: "100vh" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "56px 24px" }}>
        {state === "loading" && (
          <div style={{ fontFamily: "var(--font-data), monospace", color: MUTED, fontSize: 12 }}>
            Resolving viewing key…
          </div>
        )}

        {state === "invalid" && (
          <div>
            <h1 className="display" style={{ fontSize: 34, color: INK }}>
              This key opens nothing.
            </h1>
            <p style={{ color: "#5b4f42", marginTop: 10 }}>The viewing key is unknown or was revoked.</p>
            <Link href="/" style={{ color: "#7a5f1f", marginTop: 20, display: "inline-block" }}>
              ← Back to Sable
            </Link>
          </div>
        )}

        {state === "valid" && data && (
          <div>
            <header style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 22, marginBottom: 24 }}>
              <div
                style={{
                  fontFamily: "var(--font-data), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  fontSize: 10.5,
                  color: MUTED,
                }}
              >
                Sable · auditor view
              </div>
              <h1 className="display" style={{ fontSize: 32, color: INK, marginTop: 10 }}>
                Disclosed under viewing key
              </h1>
              <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span
                  className="num"
                  style={{
                    background: "#e9dfc8",
                    color: "#7a5f1f",
                    borderRadius: 999,
                    padding: "3px 12px",
                    fontSize: 12,
                  }}
                >
                  {data.key.key}
                </span>
                <span style={{ color: "#5b4f42", fontSize: 13 }}>{scopeLabel(data.key.scope)}</span>
                <span style={{ color: MUTED, fontSize: 13 }}>· {data.key.label}</span>
                <span style={{ color: MUTED, fontSize: 13, marginLeft: "auto" }}>
                  Issued {fmtDate(data.key.createdAt)}
                </span>
              </div>
            </header>

            <div
              style={{
                background: PANEL,
                border: `1px solid ${PANEL_LINE}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <table className="tbl" style={{ color: INK }}>
                <thead>
                  <tr>
                    <th style={{ color: MUTED, borderColor: LINE }}>Counterparty</th>
                    <th style={{ color: MUTED, borderColor: LINE }}>Detail</th>
                    <th style={{ color: MUTED, borderColor: LINE }}>Memo</th>
                    <th style={{ color: MUTED, borderColor: LINE }}>Date</th>
                    <th style={{ color: MUTED, borderColor: LINE, textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: MUTED, borderColor: LINE }}>
                        No payments in scope.
                      </td>
                    </tr>
                  ) : (
                    data.payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ color: INK, borderColor: LINE }}>{p.counterparty}</td>
                        <td style={{ color: "#5b4f42", borderColor: LINE }}>{p.detail}</td>
                        <td style={{ color: "#5b4f42", borderColor: LINE, fontSize: 12 }}>{p.memo}</td>
                        <td style={{ color: MUTED, borderColor: LINE, fontSize: 12 }}>{fmtDate(p.ts)}</td>
                        <td className="num" style={{ color: INK, borderColor: LINE, textAlign: "right" }}>
                          <Cipher value={usd(p.amount)} revealed={revealed} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 12px",
                  borderTop: `1px solid ${LINE}`,
                }}
              >
                <span style={{ color: MUTED, fontSize: 12 }}>
                  {data.payments.length} payment{data.payments.length === 1 ? "" : "s"} disclosed
                </span>
                <span className="num" style={{ color: INK }}>
                  {usd(data.payments.reduce((a, p) => a + p.amount, 0))}
                </span>
              </div>
            </div>

            <p style={{ color: MUTED, fontSize: 12, marginTop: 18 }}>
              Scope: exactly {data.payments.length} payment{data.payments.length === 1 ? "" : "s"}. Nothing else
              about this ledger is visible to the key holder.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
