// Cross-instance persistence for Sable's in-memory state.
//
// On Vercel each serverless instance has its own memory, so globalThis state
// (store, claims, outbox, x402 nonces) evaporates between requests. Each such
// module registers a named "slice" here — a dump/load pair — and every API
// route calls hydrate() before touching state. Slices live as one JSONB row
// each in the sable_kv table, with a monotonically increasing version; a slice
// is only re-loaded when the row's version is newer than what this instance
// last saw. Writes are best-effort, coalesced, and kept alive past the HTTP
// response with waitUntil. Last-write-wins across instances — acceptable for
// the demo.
//
// No DATABASE_URL → everything here is a no-op and the app stays purely
// in-memory, exactly as before.

import { neon } from "@neondatabase/serverless";
import { waitUntil } from "@vercel/functions";

type Sql = ReturnType<typeof neon>;
let _sql: Sql | null | undefined;
function sql(): Sql | null {
  if (_sql === undefined) {
    // Tolerate values pasted with surrounding quotes (dotenv strips them
    // locally; hosted env dashboards don't) and never let a malformed URL
    // throw — a broken DATABASE_URL must degrade to in-memory, not 500.
    const url = process.env.DATABASE_URL?.trim().replace(/^["']|["']$/g, "");
    try {
      _sql = url ? neon(url) : null;
    } catch {
      _sql = null;
    }
  }
  return _sql ?? null;
}

export function persistEnabled(): boolean {
  return sql() !== null;
}

export type Slice = {
  /** Serialize the slice's current in-memory state (must be JSON-safe). */
  dump: () => unknown;
  /** Install a newer copy fetched from the database into memory. */
  load: (value: unknown) => void;
};

const slices = new Map<string, Slice>();
const localVersion = new Map<string, number>();
const writing = new Set<string>();
const dirty = new Set<string>();

export function registerSlice(key: string, slice: Slice): void {
  if (!slices.has(key)) slices.set(key, slice);
}

/** Pull every registered slice that has a newer version in the database. */
export async function hydrate(): Promise<void> {
  const db = sql();
  if (!db) return;
  try {
    const rows = (await db`SELECT key, version, value FROM sable_kv`) as Array<{
      key: string;
      version: string | number;
      value: unknown;
    }>;
    for (const row of rows) {
      const slice = slices.get(row.key);
      if (!slice) continue;
      const version = Number(row.version);
      if (version > (localVersion.get(row.key) ?? 0)) {
        try {
          slice.load(row.value);
          localVersion.set(row.key, version);
        } catch {
          // A malformed row must not take the app down — keep in-memory state.
        }
      }
    }
  } catch {
    // DB hiccup — keep serving from memory.
  }
}

/** Queue a write of the slice's current state. Coalesces bursts: if a write is
 * already in flight the slice is re-dumped and re-written once it finishes. */
export function persistSlice(key: string): void {
  const db = sql();
  if (!db) return;
  if (writing.has(key)) {
    dirty.add(key);
    return;
  }
  writing.add(key);
  const writeOnce = async (): Promise<void> => {
    const slice = slices.get(key);
    if (!slice) return;
    const version = (localVersion.get(key) ?? 0) + 1;
    localVersion.set(key, version);
    const value = JSON.stringify(slice.dump());
    await db`
      INSERT INTO sable_kv (key, version, value, updated_at)
      VALUES (${key}, ${version}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE
        SET version = EXCLUDED.version, value = EXCLUDED.value, updated_at = now()`;
  };
  const task = (async () => {
    try {
      await writeOnce();
      while (dirty.has(key)) {
        dirty.delete(key);
        await writeOnce();
      }
    } catch {
      // Best-effort — a persistence failure must never break the request path.
    } finally {
      writing.delete(key);
    }
  })();
  waitUntil(task);
}

/** Keep fire-and-forget work (settlement chains, fleet orchestration, emails)
 * alive past the HTTP response on Vercel. No-op outside a request context. */
export function keepAlive(p: Promise<unknown>): void {
  waitUntil(p);
}
