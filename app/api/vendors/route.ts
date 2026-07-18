import { NextResponse } from "next/server";
import { payVendor } from "@/lib/store";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await hydrateState();
  let body: { vendor?: unknown; amount?: unknown; memo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const vendor = typeof body.vendor === "string" ? body.vendor.trim() : "";
  const amount = typeof body.amount === "number" ? body.amount : NaN;
  const memo = typeof body.memo === "string" ? body.memo : undefined;

  if (!vendor) {
    return NextResponse.json({ error: "vendor is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
  }

  return NextResponse.json(payVendor({ vendor, amount, memo }));
}
