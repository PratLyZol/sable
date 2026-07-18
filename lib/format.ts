import type { Snapshot } from "./store";

/**
 * Treasury balance to display: the real on-chain token balance in devnet mode
 * (null until the first RPC fetch lands), the sim ledger balance otherwise.
 */
export function treasuryBalance(snap: Snapshot): number | null {
  return snap.chain.mode === "devnet" ? snap.chain.treasuryToken : snap.balance;
}

export function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function usdc(n: number): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function shortSig(sig: string, n = 6): string {
  return `${sig.slice(0, n)}…${sig.slice(-n)}`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}
