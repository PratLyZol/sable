import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSnapshot());
}
