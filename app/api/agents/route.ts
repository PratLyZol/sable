import { NextResponse } from "next/server";
import { dispatchFleet } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { goal?: unknown; budget?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const budget = typeof body.budget === "number" ? body.budget : NaN;

  if (!goal) {
    return NextResponse.json({ error: "goal is required" }, { status: 400 });
  }
  if (!Number.isFinite(budget) || budget < 0.5) {
    return NextResponse.json({ error: "budget must be at least 0.5" }, { status: 400 });
  }

  return NextResponse.json(dispatchFleet(goal, budget));
}
