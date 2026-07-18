"use client";

import { useEffect, useMemo, useState } from "react";
import { timeAgo } from "@/lib/format";

type OutboxEmail = {
  id: string;
  to: string;
  subject: string;
  html: string;
  claimUrl: string;
  ts: number;
  via: "outbox" | "resend";
  resendError?: string;
};

function CopyButton({ value }: { value: string }) {
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
      {done ? "copied" : "copy"}
    </button>
  );
}

export default function Outbox() {
  const [emails, setEmails] = useState<OutboxEmail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/outbox", { cache: "no-store" });
        if (dead) return;
        if (res.ok) {
          const json = await res.json();
          if (!dead) setEmails(json.emails ?? []);
        }
      } catch {
        /* keep last view */
      } finally {
        if (!dead) setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      dead = true;
    };
  }, []);

  const selected = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? emails[0] ?? null,
    [emails, selectedId],
  );

  return (
    <div>
      <header className="mb-8">
        <div className="eyebrow">Outbox</div>
        <h1 className="display mt-2 text-3xl text-ink">Every payment carries its claim.</h1>
        <p className="mt-2 text-dim">
          Each payout emails the recipient a private claim link. Watch them land here.
        </p>
      </header>

      {emails.length === 0 ? (
        <div className="panel p-6 text-dim">
          No emails yet. Run payroll or pay a vendor — every payment emails the recipient a claim
          link.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.6fr]">
          {/* left — list */}
          <div className="panel max-h-[560px] overflow-y-auto">
            {emails.map((e) => {
              const active = selected?.id === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  className={`flex w-full flex-col gap-1 border-b px-4 py-3 text-left hairline transition-colors ${
                    active ? "bg-panel2" : "hover:bg-panel2/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink">{e.to}</span>
                    <span className="flex-none text-xs text-faint">{timeAgo(e.ts)}</span>
                  </div>
                  <div className="truncate text-xs text-dim">{e.subject}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {e.via === "resend" ? (
                      <span className="chip chip-ok">sent · resend</span>
                    ) : (
                      <span className="chip">outbox</span>
                    )}
                    {e.resendError && (
                      <span className="chip chip-bad" title={e.resendError}>
                        send failed
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* right — preview */}
          {selected && (
            <div className="panel p-5">
              <div className="eyebrow">To</div>
              <div className="mt-1 text-ink">{selected.to}</div>
              <div className="mt-3 text-dim">{selected.subject}</div>

              <div className="mt-4 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-lg bg-panel2 px-3 py-2 font-mono text-xs text-dim">
                  {selected.claimUrl}
                </div>
                <CopyButton value={selected.claimUrl} />
                <a
                  href={selected.claimUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold text-xs hover:underline flex-none"
                >
                  open claim page →
                </a>
              </div>

              <iframe
                sandbox=""
                srcDoc={selected.html}
                className="mt-4 h-[480px] w-full rounded-lg bg-white"
                title="Email preview"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
