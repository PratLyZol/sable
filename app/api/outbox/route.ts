import { NextResponse } from "next/server";
import { getOutbox } from "@/lib/claims";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

export async function GET() {
  await hydrateState();
  return NextResponse.json({ emails: getOutbox() });
}
