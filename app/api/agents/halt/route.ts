import { NextResponse } from "next/server";
import { haltRun } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { runId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const run = haltRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
