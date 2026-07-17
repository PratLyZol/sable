import { NextResponse } from "next/server";
import { createViewingKey, type ViewingKeyScope } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { scope?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const scope = body.scope as ViewingKeyScope | undefined;
  const label = typeof body.label === "string" ? body.label : undefined;

  if (!scope || typeof scope !== "object" || typeof (scope as { type?: unknown }).type !== "string") {
    return NextResponse.json({ error: "scope is required" }, { status: 400 });
  }

  return NextResponse.json(createViewingKey(scope, label));
}
