"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLive } from "@/lib/useLive";
import { usdc, treasuryBalance } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/payroll", label: "Payroll" },
  { href: "/vendors", label: "Vendors" },
  { href: "/agents", label: "Agents" },
  { href: "/ledger", label: "Ledger" },
  { href: "/outbox", label: "Outbox", suffix: "email" },
  { href: "/explorer", label: "Explorer", suffix: "public" },
];

export function Sidebar() {
  const pathname = usePathname();
  const snap = useLive();
  const treasury = snap ? treasuryBalance(snap) : null;

  return (
    <aside className="w-[232px] flex-none h-screen sticky top-0 border-r hairline flex flex-col px-4 py-6">
      <div className="px-2">
        <div className="flex items-center gap-2">
          <span className="shield-dot" />
          <span className="display text-ink" style={{ fontSize: 22 }}>
            Sable
          </span>
        </div>
        <div className="eyebrow mt-1.5">private spending layer</div>
      </div>

      <nav className="flex-1 mt-8 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-panel2 text-ink" : "text-dim hover:text-ink"
              }`}
            >
              <span>{item.label}</span>
              {item.suffix ? <span className="chip">{item.suffix}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="panel p-4 mt-6">
        <div className="eyebrow">Treasury</div>
        <div className="num text-lg text-ink mt-1.5">
          {treasury != null ? usdc(treasury) : <span className="text-faint">…</span>}
        </div>
        <div className="mt-3">
          <span className="chip chip-veil">all transfers shielded</span>
        </div>
        {snap?.chain.mode === "devnet" && snap.chain.treasuryAddress ? (
          <div className="mt-2">
            <a
              href={`https://explorer.solana.com/address/${snap.chain.treasuryAddress}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="chip chip-ok"
              title="View treasury on Solana Explorer"
            >
              live on devnet
            </a>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
