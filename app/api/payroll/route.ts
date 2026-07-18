import { NextResponse } from "next/server";
import { runPayroll } from "@/lib/store";
import { hydrateState } from "@/lib/hydrate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await hydrateState();
  let contractorIds: string[] | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body?.contractorIds)) contractorIds = body.contractorIds;
  } catch {
    // empty body → run full payroll
  }
  return NextResponse.json(runPayroll(contractorIds));
}
