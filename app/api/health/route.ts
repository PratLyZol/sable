// Self-diagnosis endpoint: no static imports, so this route always loads even
// when the shared state graph is broken. Each module is imported dynamically
// and its failure (if any) is reported verbatim — the fastest way to see why
// API routes 500 on a host whose logs we can't reach.

export const dynamic = "force-dynamic";

export async function GET() {
  const report: Record<string, string> = {};
  const probe = async (name: string, imp: () => Promise<unknown>) => {
    try {
      await imp();
      report[name] = "ok";
    } catch (err: unknown) {
      report[name] = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
    }
  };

  await probe("persist", () => import("@/lib/persist"));
  await probe("claims", () => import("@/lib/claims"));
  await probe("x402", () => import("@/lib/x402"));
  await probe("chain", () => import("@/lib/chain"));
  await probe("email", () => import("@/lib/email"));
  await probe("store", () => import("@/lib/store"));
  await probe("copilot", () => import("@/lib/copilot"));

  let snapshot = "skipped";
  try {
    const { hydrateState } = await import("@/lib/hydrate");
    await hydrateState();
    const { getSnapshot } = await import("@/lib/store");
    const s = getSnapshot();
    snapshot = `ok · ${s.payments.length} payments · ${s.contractors.length} contractors · mode ${s.chain.mode}`;
  } catch (err: unknown) {
    snapshot = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
  }

  return Response.json({
    report,
    snapshot,
    env: {
      mode: process.env.SABLE_MODE ?? null,
      db: !!process.env.DATABASE_URL,
      smtp: !!process.env.SABLE_SMTP_USER,
      mint: !!process.env.SABLE_MINT,
      treasury: !!process.env.SABLE_TREASURY_SECRET,
      publicUrl: process.env.SABLE_PUBLIC_URL ?? null,
    },
  });
}
