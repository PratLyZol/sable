import { NextResponse } from "next/server";
import { addContractor } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { name?: string; email?: string; amount?: number; role?: string; country?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const result = addContractor({
    name: body.name ?? "",
    email: body.email ?? "",
    amount: Number(body.amount),
    role: body.role,
    country: body.country,
  });
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
