import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/store";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

export async function GET() {
  await hydrateState();
  return NextResponse.json(getSnapshot());
}
