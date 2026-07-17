"use client";

import { useLive } from "@/lib/useLive";
import { timeAgo, shortSig } from "@/lib/format";
import { Cipher } from "@/components/Cipher";
import type { ExplorerEntry } from "@/lib/store";

function KindChip({ kind }: { kind: ExplorerEntry["kind"] }) {
  if (kind === "revoke") return <span className="chip chip-bad">revoke</span>;
  if (kind === "delegate") return <span className="chip">delegate</span>;
  return <span className="chip chip-veil">ct:transfer</span>;
}

export default function Explorer() {
  const snap = useLive();
  const entries = snap?.explorer ?? [];

  return (
    <div>
      <div className="panel p-6" style={{ background: "#0f0d0c" }}>
        <header className="mb-6">
          <div className="eyebrow">sablescan.io — public view</div>
          <h1 className="display text-3xl text-ink mt-2">What the world sees.</h1>
          <p className="text-dim mt-2">
            Every Sable transfer, as any chain observer sees it. Amounts and counterparties are ciphertext.
          </p>
        </header>

        <div className="mb-5">
          <span className="chip chip-veil">
            <span className="shield-dot" /> {entries.length} confidential transfers · 0 amounts legible
          </span>
        </div>

        <div className="max-h-[560px] overflow-y-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Signature</th>
                <th>Program</th>
                <th>Kind</th>
                <th>Age</th>
                <th>Amount</th>
                <th>Counterparty</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-faint text-xs">…</td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.sig}>
                    <td className="num text-xs text-dim">{e.slot.toLocaleString("en-US")}</td>
                    <td className="sig text-xs">{shortSig(e.sig, 8)}</td>
                    <td className="num text-xs text-faint">{e.program}</td>
                    <td>
                      <KindChip kind={e.kind} />
                    </td>
                    <td className="num text-xs text-faint">{timeAgo(e.ts)}</td>
                    <td className="text-xs">
                      <Cipher value="$0,000.00" revealed={false} />
                    </td>
                    <td className="text-xs">
                      <Cipher value="0x00000000" revealed={false} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-faint mt-5">
          This is the entire public record. Payroll, vendor pricing, and agent strategy are illegible without a
          viewing key.
        </p>
      </div>
    </div>
  );
}
