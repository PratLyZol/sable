// Idempotent devnet bootstrap for Sable's on-chain settlement layer.
// Run with: node scripts/devnet-setup.mjs  (or `npm run devnet:setup`)
// DEVNET ONLY. Never point this at mainnet/testnet.
import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const CWD = process.cwd();
const SABLE_DIR = path.join(CWD, ".sable");
const TREASURY_PATH =
  process.env.SABLE_TREASURY_KEYPAIR &&
  path.resolve(CWD, process.env.SABLE_TREASURY_KEYPAIR);
const TREASURY_FILE = TREASURY_PATH ?? path.join(SABLE_DIR, "treasury.json");
const MINT_FILE = path.join(SABLE_DIR, "mint.json");
const DECIMALS = 6;
const BASE = 10n ** BigInt(DECIMALS);
const MIN_TOKEN_BASE = 1_000_000n * BASE; // want >= 1,000,000 whole tokens
const REFILL_BASE = 100_000_000n * BASE; // mint 100,000,000.000000 when short (1e14 base units)

const PRIMARY_RPC = "https://api.devnet.solana.com";
const FALLBACK_RPC = "https://mango.devnet.rpcpool.com";
const RPC_URL = process.env.SABLE_RPC_URL ?? clusterApiUrl("devnet");

function explorerTx(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function explorerAddr(addr) {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

function loadOrCreateTreasury() {
  if (!fs.existsSync(SABLE_DIR)) fs.mkdirSync(SABLE_DIR, { recursive: true });
  if (fs.existsSync(TREASURY_FILE)) {
    const secret = Uint8Array.from(
      JSON.parse(fs.readFileSync(TREASURY_FILE, "utf8")),
    );
    return Keypair.fromSecretKey(secret);
  }
  const kp = Keypair.generate();
  fs.writeFileSync(TREASURY_FILE, JSON.stringify(Array.from(kp.secretKey)));
  fs.chmodSync(TREASURY_FILE, 0o600);
  console.log(`Created new treasury keypair at ${TREASURY_FILE}`);
  return kp;
}

async function tryAirdrop(pubkey, url) {
  try {
    const conn = new Connection(url, "confirmed");
    const sig = await conn.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction(
      { signature: sig, ...bh },
      "confirmed",
    );
    return true;
  } catch (e) {
    console.log(`  airdrop via ${url} failed: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`RPC: ${RPC_URL}`);
  const connection = new Connection(RPC_URL, "confirmed");
  const treasury = loadOrCreateTreasury();
  const treasuryPk = treasury.publicKey;
  console.log(`Treasury: ${treasuryPk.toBase58()}`);

  // --- Step 2: ensure SOL for fees ---
  let sol = (await connection.getBalance(treasuryPk)) / LAMPORTS_PER_SOL;
  console.log(`SOL balance: ${sol}`);
  if (sol < 0.2) {
    console.log("Low SOL, attempting airdrop...");
    let ok = await tryAirdrop(treasuryPk, PRIMARY_RPC);
    if (!ok) ok = await tryAirdrop(treasuryPk, FALLBACK_RPC);
    sol = (await connection.getBalance(treasuryPk)) / LAMPORTS_PER_SOL;
    if (!ok && sol <= 0.05) {
      console.error(
        `\nAirdrops failed and balance is too low (${sol} SOL).\n` +
          `Fund the treasury manually at https://faucet.solana.com\n` +
          `  address: ${treasuryPk.toBase58()}\n` +
          `then re-run this script.`,
      );
      process.exit(1);
    }
    if (!ok) {
      console.log(
        `Airdrops failed but balance ${sol} SOL is workable; continuing.`,
      );
    }
    console.log(`SOL balance now: ${sol}`);
  }

  // --- Step 3: ensure Token-2022 mint (plain, no confidential extension) ---
  let mintPk;
  if (fs.existsSync(MINT_FILE)) {
    mintPk = new PublicKey(JSON.parse(fs.readFileSync(MINT_FILE, "utf8")).mint);
    console.log(`Existing mint: ${mintPk.toBase58()}`);
  } else {
    console.log("Creating Token-2022 mint (6 decimals)...");
    mintPk = await createMint(
      connection,
      treasury, // payer
      treasuryPk, // mint authority
      null, // freeze authority
      DECIMALS,
      undefined, // random mint keypair
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );
    fs.writeFileSync(MINT_FILE, JSON.stringify({ mint: mintPk.toBase58() }, null, 2));
    console.log(`Created mint: ${mintPk.toBase58()}`);
  }

  // --- Step 4: ensure treasury ATA holds >= 1,000,000 tokens ---
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    mintPk,
    treasuryPk,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  let tokenBase = ata.amount;
  console.log(`Treasury token balance: ${Number(tokenBase) / Number(BASE)}`);
  if (tokenBase < MIN_TOKEN_BASE) {
    console.log(
      `Minting ${Number(REFILL_BASE) / Number(BASE)} tokens to treasury...`,
    );
    await mintTo(
      connection,
      treasury,
      mintPk,
      ata.address,
      treasury, // mint authority
      REFILL_BASE,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );
    tokenBase += REFILL_BASE;
  }

  // --- Step 5: summary ---
  const finalSol = (await connection.getBalance(treasuryPk)) / LAMPORTS_PER_SOL;
  console.log("\n========= Sable devnet setup complete =========");
  console.log(`Treasury address : ${treasuryPk.toBase58()}`);
  console.log(`  SOL            : ${finalSol}`);
  console.log(`  ${explorerAddr(treasuryPk.toBase58())}`);
  console.log(`Mint             : ${mintPk.toBase58()}`);
  console.log(`  ${explorerAddr(mintPk.toBase58())}`);
  console.log(`Token balance    : ${Number(tokenBase) / Number(BASE)}`);
  console.log("===============================================");
}

main().catch((e) => {
  console.error("devnet-setup failed:", e);
  process.exit(1);
});
