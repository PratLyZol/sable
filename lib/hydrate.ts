// One-line hydration for API routes. Importing the state modules registers
// their persistence slices (store, claims, outbox, x402 nonces); hydrate()
// then pulls any newer copies from the database. Call at the top of every API
// route handler so a fresh serverless instance sees the shared state.

import "@/lib/store";
import "@/lib/claims";
import "@/lib/x402";
import { hydrate } from "@/lib/persist";

export async function hydrateState(): Promise<void> {
  await hydrate();
}
