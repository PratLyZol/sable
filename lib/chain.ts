// Server-only Solana devnet settlement layer for Sable.
//
// DEVNET ONLY. This module must never be imported from a client component:
// it loads the treasury secret key and signs transactions. All chain work is
// server-side. Keypairs live under .sable/ (gitignored) and are never logged
// or returned.
import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

// --- constants ---
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const DECIMALS = 6;
const BASE = 10 ** DECIMALS;
const SABLE_DIR = ".sable";

// --- paths (resolved from process.cwd()) ---
function sablePath(...parts: string[]): string {
  return path.resolve(process.cwd(), SABLE_DIR, ...parts);
}
function treasuryPath(): string {
  const env = process.env.SABLE_TREASURY_KEYPAIR;
  return env
    ? path.resolve(process.cwd(), env)
    : sablePath("treasury.json");
}
function mintPath(): string {
  return sablePath("mint.json");
}
function recipientsPath(): string {
  return sablePath("recipients.json");
}

// --- public URL helpers ---
export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

// --- mode ---
export type ChainMode = "sim" | "devnet";
export function chainMode(): ChainMode {
  if (process.env.SABLE_MODE === "devnet" && fs.existsSync(treasuryPath())) {
    return "devnet";
  }
  return "sim";
}

// --- lazy singletons ---
let _connection: Connection | null = null;
function connection(): Connection {
  if (!_connection) {
    const url = process.env.SABLE_RPC_URL ?? clusterApiUrl("devnet");
    _connection = new Connection(url, "confirmed");
  }
  return _connection;
}

let _treasury: Keypair | null = null;
function treasury(): Keypair {
  if (!_treasury) {
    const p = treasuryPath();
    if (!fs.existsSync(p)) {
      throw new Error(
        `Treasury keypair not found at ${p}. Run \`npm run devnet:setup\`.`,
      );
    }
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")));
    _treasury = Keypair.fromSecretKey(secret);
  }
  return _treasury;
}

let _mint: PublicKey | null = null;
function mint(): PublicKey {
  if (!_mint) {
    const p = mintPath();
    if (!fs.existsSync(p)) {
      throw new Error(
        `Mint not found at ${p}. Run \`npm run devnet:setup\` to create the devnet mint.`,
      );
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { mint: string };
    _mint = new PublicKey(raw.mint);
  }
  return _mint;
}

// treasuryAddressSync: cached from keypair file, no RPC — safe in getSnapshot().
let _treasuryAddr: string | null = null;
export function treasuryAddressSync(): string | null {
  if (_treasuryAddr) return _treasuryAddr;
  try {
    const p = treasuryPath();
    if (!fs.existsSync(p)) return null;
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")));
    _treasuryAddr = Keypair.fromSecretKey(secret).publicKey.toBase58();
    return _treasuryAddr;
  } catch {
    return null;
  }
}

// --- recipient registry ---
type RecipientRecord = { pubkey: string; keypairPath: string };
type Registry = Record<string, RecipientRecord>;

let _registry: Registry | null = null;
function loadRegistry(): Registry {
  if (_registry) return _registry;
  const p = recipientsPath();
  if (fs.existsSync(p)) {
    _registry = JSON.parse(fs.readFileSync(p, "utf8")) as Registry;
  } else {
    _registry = {};
  }
  return _registry;
}
function saveRegistry(reg: Registry): void {
  fs.writeFileSync(recipientsPath(), JSON.stringify(reg, null, 2));
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "recipient"
  );
}

// Serialize registry mutations so parallel first-use of the same name does not
// create two keypairs.
const _recipientLocks = new Map<string, Promise<string>>();

export async function recipientAddress(name: string): Promise<string> {
  const reg = loadRegistry();
  const existing = reg[name];
  if (existing) return existing.pubkey;

  const pending = _recipientLocks.get(name);
  if (pending) return pending;

  const task = (async () => {
    // Re-check under the lock in case another caller just wrote it.
    const fresh = loadRegistry();
    if (fresh[name]) return fresh[name].pubkey;

    const slug = slugify(name);
    let file = sablePath(`r_${slug}.json`);
    // Avoid clobbering an unrelated keypair with the same slug.
    let n = 2;
    const usedPaths = new Set(Object.values(fresh).map((r) => r.keypairPath));
    while (fs.existsSync(file) || usedPaths.has(path.relative(process.cwd(), file))) {
      file = sablePath(`r_${slug}-${n}.json`);
      n += 1;
    }
    const kp = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    fs.chmodSync(file, 0o600);
    const pubkey = kp.publicKey.toBase58();
    fresh[name] = {
      pubkey,
      keypairPath: path.relative(process.cwd(), file),
    };
    saveRegistry(fresh);
    _registry = fresh;
    return pubkey;
  })();

  _recipientLocks.set(name, task);
  try {
    return await task;
  } finally {
    _recipientLocks.delete(name);
  }
}

// --- ATA creation serialization (per owner) so parallel payroll to the same
// recipient does not double-create. ---
const _ataLocks = new Map<string, Promise<PublicKey>>();

async function ensureAta(owner: PublicKey): Promise<PublicKey> {
  const key = owner.toBase58();
  const pending = _ataLocks.get(key);
  if (pending) return pending;
  const task = (async () => {
    const acct = await getOrCreateAssociatedTokenAccount(
      connection(),
      treasury(),
      mint(),
      owner,
      false,
      "confirmed",
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );
    return acct.address;
  })();
  _ataLocks.set(key, task);
  try {
    return await task;
  } finally {
    _ataLocks.delete(key);
  }
}

// --- settle ---
export type SettleResult = { sig: string; explorerUrl: string };

export async function settleOnChain(opts: {
  recipient: string;
  amount: number;
  memo: string;
}): Promise<SettleResult> {
  const { recipient, amount, memo } = opts;
  if (!(amount > 0)) {
    throw new Error(`settleOnChain: amount must be positive, got ${amount}`);
  }
  const baseUnits = BigInt(Math.round(amount * BASE));
  if (baseUnits <= BigInt(0)) {
    throw new Error(`settleOnChain: amount ${amount} rounds to zero base units`);
  }

  const ownerAddr = await recipientAddress(recipient);
  const owner = new PublicKey(ownerAddr);

  const tre = treasury();
  const mintPk = mint();

  const sourceAta = getAssociatedTokenAddressSync(
    mintPk,
    tre.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const destAta = await ensureAta(owner);

  const transferIx = createTransferCheckedInstruction(
    sourceAta,
    mintPk,
    destAta,
    tre.publicKey,
    baseUnits,
    DECIMALS,
    [],
    TOKEN_2022_PROGRAM_ID,
  );
  const memoIx = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf8"),
  });

  const tx = new Transaction().add(transferIx, memoIx);
  try {
    const sig = await sendAndConfirmTransaction(connection(), tx, [tre], {
      commitment: "confirmed",
    });
    return { sig, explorerUrl: explorerTx(sig) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`settleOnChain failed for "${recipient}": ${msg}`);
  }
}

// --- verify ---
export async function verifyOnChain(
  sig: string,
  expect: { payTo: string; minAmount: number; memoIncludes?: string },
): Promise<{ valid: boolean; reason?: string }> {
  const conn = connection();
  let tx = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    tx = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!tx) {
    return { valid: false, reason: "transaction not found" };
  }
  if (tx.meta?.err) {
    return { valid: false, reason: `transaction failed: ${JSON.stringify(tx.meta.err)}` };
  }

  let owner: PublicKey;
  let mintPk: PublicKey;
  try {
    owner = new PublicKey(expect.payTo);
    mintPk = mint();
  } catch (e) {
    return {
      valid: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
  const expectedAta = getAssociatedTokenAddressSync(
    mintPk,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  ).toBase58();
  const mintStr = mintPk.toBase58();
  const minBase = BigInt(Math.round(expect.minAmount * BASE));

  // Re-parse with jsonParsed to inspect the token transfer instruction.
  let parsedTx = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    parsedTx = await conn.getParsedTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (parsedTx) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!parsedTx) {
    return { valid: false, reason: "parsed transaction not found" };
  }

  const instructions = parsedTx.transaction.message
    .instructions as Array<{
    program?: string;
    programId: PublicKey;
    // Token instructions parse to an object; the Memo program parses to a
    // plain string.
    parsed?:
      | string
      | {
          type?: string;
          info?: Record<string, unknown>;
        };
  }>;

  // Find a token transferChecked/transfer to the expected ATA of our mint.
  let transferOk = false;
  for (const ix of instructions) {
    const parsed = ix.parsed;
    if (!parsed || typeof parsed === "string" || !parsed.info) continue;
    const type = parsed.type;
    if (type !== "transferChecked" && type !== "transfer") continue;
    const info = parsed.info as {
      destination?: string;
      mint?: string;
      amount?: string;
      tokenAmount?: { amount?: string };
    };
    if (info.destination !== expectedAta) continue;
    // transferChecked includes mint; guard when present.
    if (info.mint && info.mint !== mintStr) continue;
    const amountStr =
      info.tokenAmount?.amount ?? info.amount ?? undefined;
    if (amountStr === undefined) continue;
    let amt: bigint;
    try {
      amt = BigInt(amountStr);
    } catch {
      continue;
    }
    if (amt >= minBase) {
      transferOk = true;
      break;
    }
  }
  if (!transferOk) {
    return {
      valid: false,
      reason: `no transfer of >= ${expect.minAmount} of mint ${mintStr} to ${expect.payTo}`,
    };
  }

  // Memo check: look in parsed memo instructions and in log messages.
  if (expect.memoIncludes) {
    const needle = expect.memoIncludes;
    let memoFound = false;
    for (const ix of instructions) {
      const parsed = ix.parsed;
      if (typeof parsed === "string") {
        if (parsed.includes(needle)) {
          memoFound = true;
          break;
        }
        continue;
      }
      const info = parsed?.info as { memo?: string } | undefined;
      if (info?.memo && info.memo.includes(needle)) {
        memoFound = true;
        break;
      }
    }
    if (!memoFound) {
      const logs = parsedTx.meta?.logMessages ?? [];
      memoFound = logs.some((l) => l.includes(needle));
    }
    if (!memoFound) {
      return { valid: false, reason: `memo does not include "${needle}"` };
    }
  }

  return { valid: true };
}

// --- treasury status ---
export async function treasuryStatus(): Promise<{
  address: string;
  sol: number;
  token: number;
  mint: string;
  explorerUrl: string;
}> {
  const tre = treasury();
  const mintPk = mint();
  const conn = connection();
  const address = tre.publicKey.toBase58();

  const lamports = await conn.getBalance(tre.publicKey);
  const sol = lamports / LAMPORTS_PER_SOL;

  let token = 0;
  try {
    const ata = getAssociatedTokenAddressSync(
      mintPk,
      tre.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const acct = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
    token = Number(acct.amount) / BASE;
  } catch {
    token = 0;
  }

  return {
    address,
    sol,
    token,
    mint: mintPk.toBase58(),
    explorerUrl: explorerAddr(address),
  };
}

// treasuryTokenSync: last-known on-chain token balance, safe in getSnapshot().
// Returns the cached value immediately and refreshes via RPC in the background
// at most once per TTL, so the 1.5s state poll never blocks on the network.
// null until the first fetch completes (or if the ATA doesn't exist yet).
const TOKEN_BALANCE_TTL_MS = 5_000;
let _tokenBalance: number | null = null;
let _tokenFetchedAt = 0;
let _tokenFetching = false;
export function treasuryTokenSync(): number | null {
  if (!_tokenFetching && Date.now() - _tokenFetchedAt > TOKEN_BALANCE_TTL_MS) {
    _tokenFetching = true;
    (async () => {
      const ata = getAssociatedTokenAddressSync(
        mint(),
        treasury().publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );
      const acct = await getAccount(connection(), ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      _tokenBalance = Number(acct.amount) / BASE;
    })()
      .catch(() => {}) // RPC hiccup — keep the stale value and retry after TTL
      .finally(() => {
        _tokenFetchedAt = Date.now();
        _tokenFetching = false;
      });
  }
  return _tokenBalance;
}
