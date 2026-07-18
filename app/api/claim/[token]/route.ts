import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  resolveClaimToken,
  bindClaimAddress,
  recordSweep,
  recordSimSweep,
  type SweepRecord,
} from "@/lib/claims";
import { chainMode, recipientAddress, ownerTokenBalance, explorerAddr, sweepRecipient } from "@/lib/chain";
import { getSnapshot, fakeSig, type Payment } from "@/lib/store";

export const dynamic = "force-dynamic";

type ClaimPayment = {
  id: string;
  amount: number;
  memo: string;
  ts: number;
  sig: string;
  status: string;
  explorerUrl?: string;
};

type ClaimView = {
  recipientName: string;
  maskedEmail: string;
  mode: "sim" | "devnet";
  escrow: { address: string | null; balance: number; settling: boolean };
  claimed: { address: string; balance: number; explorerUrl: string | null; claimedAt: number } | null;
  payments: ClaimPayment[];
  sweeps: SweepRecord[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// "m•••a@duarte.pt": first + last char of the local part with bullets between;
// a local part of 1-2 chars is masked entirely.
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const masked = local.length <= 2 ? "•••" : `${local[0]}•••${local[local.length - 1]}`;
  return `${masked}${domain}`;
}

// Payments for this recipient that fund the claim: payroll/vendor, never agent spend.
function matchingPayments(recipientName: string): Payment[] {
  return getSnapshot().payments.filter((p) => p.counterparty === recipientName && p.kind !== "agent");
}

function toClaimPayment(p: Payment): ClaimPayment {
  return { id: p.id, amount: p.amount, memo: p.memo, ts: p.ts, sig: p.sig, status: p.status, explorerUrl: p.explorerUrl };
}

// Sim escrow balance: settled inflow for this recipient minus what's already been swept.
function simPending(recipientName: string, simSwept: number): number {
  const settled = matchingPayments(recipientName)
    .filter((p) => p.status === "settled")
    .reduce((a, p) => a + p.amount, 0);
  return round2(Math.max(0, settled - simSwept));
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = resolveClaimToken(token);
  if (!record) {
    return NextResponse.json({ error: "Claim link not found or expired" }, { status: 404 });
  }

  const mode = chainMode();
  const payments = matchingPayments(record.recipientName);
  const settling = payments.some((p) => p.status === "settling");

  let escrow: ClaimView["escrow"];
  let claimed: ClaimView["claimed"] = null;

  if (mode === "devnet") {
    const escrowAddress = await recipientAddress(record.recipientName);
    escrow = { address: escrowAddress, balance: await ownerTokenBalance(escrowAddress), settling };
    if (record.claimedAddress) {
      claimed = {
        address: record.claimedAddress,
        balance: await ownerTokenBalance(record.claimedAddress),
        explorerUrl: explorerAddr(record.claimedAddress),
        claimedAt: record.claimedAt ?? 0,
      };
    }
  } else {
    escrow = { address: null, balance: simPending(record.recipientName, record.simSwept), settling };
    if (record.claimedAddress) {
      claimed = {
        address: record.claimedAddress,
        balance: record.simSwept,
        explorerUrl: null,
        claimedAt: record.claimedAt ?? 0,
      };
    }
  }

  const view: ClaimView = {
    recipientName: record.recipientName,
    maskedEmail: maskEmail(record.email),
    mode,
    escrow,
    claimed,
    payments: payments.map(toClaimPayment),
    sweeps: record.sweeps,
  };
  return NextResponse.json(view);
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = resolveClaimToken(token);
  if (!record) {
    return NextResponse.json({ error: "Claim link not found or expired" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { address?: string };
  const address = body.address;
  if (!address || typeof address !== "string") {
    return NextResponse.json({ error: "A wallet address is required." }, { status: 400 });
  }
  try {
    new PublicKey(address);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid Solana address." }, { status: 400 });
  }

  const payments = matchingPayments(record.recipientName);
  if (payments.some((p) => p.status === "settling")) {
    return NextResponse.json(
      { error: "A payment is still settling — try again in a few seconds.", retry: true },
      { status: 409 },
    );
  }

  if (record.claimedAddress && record.claimedAddress !== address) {
    return NextResponse.json(
      { error: "This link was already claimed on another device.", boundAddress: record.claimedAddress },
      { status: 409 },
    );
  }

  const target = record.claimedAddress ?? address;

  if (chainMode() === "devnet") {
    let r;
    try {
      r = await sweepRecipient(record.recipientName, target);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 502 });
    }
    bindClaimAddress(token, target);
    if (r.amount > 0) {
      recordSweep(token, { sig: r.sig, amount: r.amount, ts: Date.now(), explorerUrl: r.explorerUrl });
    }
    return NextResponse.json({ ok: true, address: target, amount: r.amount, sig: r.sig, explorerUrl: r.explorerUrl });
  }

  const amount = simPending(record.recipientName, record.simSwept);
  const sig = fakeSig();
  bindClaimAddress(token, target);
  if (amount > 0) {
    recordSimSweep(token, amount, sig);
  }
  return NextResponse.json({ ok: true, address: target, amount, sig });
}
