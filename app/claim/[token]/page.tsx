"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Keypair } from "@solana/web3.js";
import QRCode from "qrcode";
import { usd, timeAgo, shortSig } from "@/lib/format";

type ClaimView = {
  recipientName: string;
  maskedEmail: string;
  mode: "sim" | "devnet";
  escrow: { address: string | null; balance: number; settling: boolean };
  claimed:
    | { address: string; balance: number; explorerUrl: string | null; claimedAt: number }
    | null;
  payments: Array<{
    id: string;
    amount: number;
    memo: string;
    ts: number;
    sig: string;
    status: string;
    explorerUrl?: string;
  }>;
  sweeps: Array<{ sig: string; amount: number; ts: number; explorerUrl?: string }>;
};

type StoredKey = { secretKey: number[]; pubkey: string };

type ClaimSuccess = { amount: number; sig: string; explorerUrl?: string };

function storageKey(token: string): string {
  return `sable-claim-${token}`;
}

function loadKey(token: string): StoredKey | null {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredKey;
    if (Array.isArray(parsed.secretKey) && typeof parsed.pubkey === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "copied" : label}
    </button>
  );
}

export default function Claim() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : params.token ?? "";

  const [state, setState] = useState<"loading" | "invalid" | "valid">("loading");
  const [data, setData] = useState<ClaimView | null>(null);
  const [stored, setStored] = useState<StoredKey | null>(null);

  const [sweeping, setSweeping] = useState(false);
  const [success, setSuccess] = useState<ClaimSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boundElsewhere, setBoundElsewhere] = useState<string | null>(null);

  const [addrQr, setAddrQr] = useState<string | null>(null);

  // Load any custodied keypair from a previous visit on this device.
  useEffect(() => {
    if (!token) return;
    setStored(loadKey(token));
  }, [token]);

  // Poll the claim view every 4s. Once the page has loaded successfully it
  // never downgrades to "invalid" on a transient fetch failure (dev-server
  // recompiles, network blips) — tracked via a ref, not the stale closure state.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (!token) return;
    let dead = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/claim/${token}`, { cache: "no-store" });
        if (dead) return;
        if (!res.ok) {
          if (!hasLoadedRef.current) setState("invalid");
          return;
        }
        const json: ClaimView = await res.json();
        if (dead) return;
        hasLoadedRef.current = true;
        setData(json);
        setState("valid");
      } catch {
        if (!dead && !hasLoadedRef.current) setState("invalid");
      } finally {
        if (!dead) setTimeout(tick, 4000);
      }
    };
    tick();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Render a QR of the wallet address once claimed.
  const claimedAddress = data?.claimed?.address ?? null;
  useEffect(() => {
    if (!claimedAddress) {
      setAddrQr(null);
      return;
    }
    let dead = false;
    QRCode.toDataURL(claimedAddress, { width: 220, margin: 1 })
      .then((url) => {
        if (!dead) setAddrQr(url);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [claimedAddress]);

  const claim = useCallback(async () => {
    if (sweeping || !token) return;
    setError(null);

    // Reuse the stored keypair, or mint one and persist BEFORE the sweep so we
    // never sweep funds to a key we haven't saved.
    let key = stored;
    if (!key) {
      const kp = Keypair.generate();
      key = { secretKey: Array.from(kp.secretKey), pubkey: kp.publicKey.toBase58() };
      try {
        localStorage.setItem(storageKey(token), JSON.stringify(key));
      } catch {
        setError("This browser blocks local storage, so your wallet key can't be saved here.");
        return;
      }
      setStored(key);
    }

    setSweeping(true);
    try {
      const res = await fetch(`/api/claim/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: key.pubkey }),
      });
      const body = await res.json().catch(() => null);

      if (res.ok && body?.ok) {
        setSuccess({ amount: body.amount, sig: body.sig, explorerUrl: body.explorerUrl });
        return;
      }
      if (res.status === 409 && body?.boundAddress) {
        if (body.boundAddress === key.pubkey) {
          // Already ours — a prior claim landed; the poll will show the wallet.
          setError(null);
        } else {
          setBoundElsewhere(body.boundAddress);
        }
        return;
      }
      setError(body?.error ?? "The sweep didn't go through. Try again in a moment.");
    } catch {
      setError("The sweep didn't go through — is the server reachable?");
    } finally {
      setSweeping(false);
    }
  }, [sweeping, token, stored]);

  const boundAddr = boundElsewhere ?? data?.claimed?.address ?? null;
  const mine = stored != null && boundAddr != null && stored.pubkey === boundAddr;
  const claimedElsewhere = boundAddr != null && !mine;

  const secretJson = stored ? JSON.stringify(stored.secretKey) : "";

  return (
    <div className="mx-auto min-h-screen max-w-[430px] px-5 py-8">
      {state === "loading" && (
        <div className="eyebrow pt-16 text-center">Opening your claim…</div>
      )}

      {state === "invalid" && (
        <div className="pt-20">
          <h1 className="display text-3xl text-ink">This link opens nothing.</h1>
          <p className="mt-3 text-dim">The claim link is unknown or was revoked.</p>
        </div>
      )}

      {state === "valid" && data && (
        <div className="space-y-6">
          {/* 1 — wordmark + greeting */}
          <header>
            <div className="flex items-center gap-2">
              <span className="shield-dot" />
              <span className="display text-ink" style={{ fontSize: 18 }}>
                Sable
              </span>
            </div>
            <h1 className="display mt-6 text-2xl text-ink">
              {data.recipientName}, you&rsquo;ve been paid.
            </h1>
            <div className="mt-3">
              <span className="chip">{data.maskedEmail}</span>
            </div>
          </header>

          {/* 2 — pending / claim */}
          {claimedElsewhere ? (
            <section className="panel-raised p-5">
              <div className="eyebrow">Already claimed</div>
              <p className="mt-2 text-dim">
                These funds were claimed on another device. Only that device holds the wallet key.
              </p>
              <div className="mt-3 break-all font-mono text-xs text-dim">{boundAddr}</div>
            </section>
          ) : (
            <section className="panel-raised p-5">
              <div className="eyebrow">In escrow for you</div>
              <div className="num mt-1 text-4xl text-ink">{usd(data.escrow.balance)}</div>

              {data.escrow.settling && (
                <div className="mt-3">
                  <span className="chip chip-gold pulse">payment settling — claim again shortly</span>
                </div>
              )}

              {success ? (
                <div className="mt-4 space-y-2">
                  <span className="chip chip-ok">{usd(success.amount)} claimed</span>
                  {success.explorerUrl && (
                    <div>
                      <a
                        href={success.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gold text-xs hover:underline"
                      >
                        view transaction →
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-gold mt-4 w-full justify-center py-3"
                  onClick={claim}
                  disabled={sweeping || data.escrow.settling || data.escrow.balance === 0}
                >
                  {sweeping ? "Sweeping…" : "Claim funds"}
                </button>
              )}

              {error && (
                <div className="mt-3">
                  <span className="chip chip-bad">{error}</span>
                </div>
              )}
            </section>
          )}

          {/* 3 — wallet (hidden when the funds live on another device's key) */}
          {data.claimed && !claimedElsewhere && (
            <section className="panel p-5">
              <div className="eyebrow">Your wallet</div>
              <div className="num mt-1 text-2xl text-ink">{usd(data.claimed.balance)}</div>

              <div className="mt-3 flex items-start gap-2">
                <div className="break-all font-mono text-xs text-dim">{data.claimed.address}</div>
                <CopyButton value={data.claimed.address} />
              </div>

              {addrQr && (
                <div className="mt-4 flex justify-center">
                  <div className="rounded-xl bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={addrQr} alt="Wallet address QR" width={220} height={220} />
                  </div>
                </div>
              )}

              {data.claimed.explorerUrl && (
                <div className="mt-3">
                  <a
                    href={data.claimed.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold text-xs hover:underline"
                  >
                    view on Solana Explorer →
                  </a>
                </div>
              )}

              <p className="mt-3 text-xs text-dim">Only you hold the key to this wallet.</p>
            </section>
          )}

          {/* 4 — backup secret */}
          {stored && !claimedElsewhere && (
            <details className="panel p-5">
              <summary className="cursor-pointer text-ink">Back up your secret key</summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-dim">
                  Sable never sees this key. Anyone with it controls your funds. Save it somewhere
                  safe.
                </p>
                <div className="max-h-32 overflow-auto rounded-lg bg-panel2 p-3 font-mono text-xs break-all text-dim">
                  {secretJson}
                </div>
                <div className="flex gap-2">
                  <CopyButton value={secretJson} label="copy key" />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const blob = new Blob([secretJson], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `sable-wallet-${stored.pubkey.slice(0, 8)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    download
                  </button>
                </div>
              </div>
            </details>
          )}

          {/* 5 — payments */}
          {data.payments.length > 0 && (
            <section className="panel p-5">
              <div className="eyebrow mb-3">Payments to you</div>
              <div className="space-y-3">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="num text-ink">{usd(p.amount)}</div>
                      {p.memo && <div className="truncate text-xs text-dim">{p.memo}</div>}
                    </div>
                    <div className="flex flex-none items-center gap-2 text-xs text-faint">
                      <span>{timeAgo(p.ts)}</span>
                      {p.status === "settling" ? (
                        <span className="chip chip-gold pulse">settling</span>
                      ) : p.explorerUrl ? (
                        <a
                          href={p.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="sig hover:underline"
                        >
                          {shortSig(p.sig)}
                        </a>
                      ) : (
                        <span className="sig">{shortSig(p.sig)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 6 — sim footer */}
          {data.mode === "sim" && (
            <div className="pt-2 text-center">
              <span className="chip">simulation mode — no real chain settlement</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
