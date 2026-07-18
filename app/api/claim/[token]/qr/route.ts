import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { resolveClaimToken, claimUrlFor } from "@/lib/claims";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  await hydrateState();
  const { token } = await params;
  const record = resolveClaimToken(token);
  if (!record) {
    return NextResponse.json({ error: "Claim link not found or expired" }, { status: 404 });
  }

  const png = await QRCode.toBuffer(claimUrlFor(token), { width: 360, margin: 1 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
