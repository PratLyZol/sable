import { NextResponse } from "next/server";
import { getOutbox } from "@/lib/claims";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ emails: getOutbox() });
}
