import { NextResponse } from "next/server";
import { resolveViewingKey } from "@/lib/store";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  await hydrateState();
  const { key } = await params;
  const result = resolveViewingKey(key);
  if (!result) {
    return NextResponse.json({ error: "Viewing key not found or revoked" }, { status: 404 });
  }
  return NextResponse.json(result);
}
