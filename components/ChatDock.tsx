"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

// Map raw tool names to short, human labels for the action chips.
const TOOL_LABELS: Record<string, string> = {
  run_payroll: "run payroll",
  pay_vendor: "pay vendor",
  dispatch_fleet: "dispatch fleet",
  create_viewing_key: "mint viewing key",
  halt_run: "kill switch",
  get_state: "read ledger",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

// Pull a terse numeric summary out of a tool result, when it has one.
function summarize(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const o = output as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof o.count === "number") bits.push(`${o.count} paid`);
  if (typeof o.total === "number") bits.push(`$${o.total.toFixed(2)}`);
  if (typeof o.amount === "number") bits.push(`$${o.amount.toFixed(2)}`);
  if (typeof o.key === "string") bits.push(o.key);
  if (typeof o.runId === "string") bits.push(o.runId);
  if (typeof o.status === "string" && bits.length === 0) bits.push(o.status);
  return bits.join(" · ");
}

const SUGGESTIONS = [
  "Run payroll for everyone",
  "Pay Halcyon Cloud $2,140 for July infra",
  "Dispatch a fleet: market-research brief, $5 cap",
];

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  if (!open) {
    return (
      <button
        className="btn-gold fixed bottom-6 right-6 z-50 rounded-full px-5 py-3 shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        onClick={() => setOpen(true)}
      >
        ✦ Copilot
      </button>
    );
  }

  const send = (text: string) => {
    const t = text.trim();
    if (!t || status !== "ready") return;
    sendMessage({ text: t });
    setInput("");
  };

  return (
    <div className="panel-raised fixed bottom-6 right-6 z-50 flex h-[560px] max-h-[80vh] w-[400px] flex-col shadow-[0_24px_60px_rgba(0,0,0,.5)]">
      {/* Header */}
      <div className="hairline flex items-center gap-2 border-t-0 px-4 py-3">
        <span className="shield-dot" />
        <span className="font-medium">Sable copilot</span>
        <span className="text-xs text-faint">executes on your behalf</span>
        <button className="btn-ghost ml-auto" onClick={() => setOpen(false)} aria-label="Collapse copilot">
          —
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-dim">Ask me to run payroll, pay a vendor, or dispatch a fleet.</p>
            <div className="flex flex-col items-start gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn text-xs" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={m.role === "user" ? "max-w-[85%] rounded-lg bg-panel2 px-3 py-2" : "w-full"}>
                {m.parts.map((part, i) => {
                  if (part.type === "text") {
                    return (
                      <p
                        key={i}
                        className={
                          m.role === "user"
                            ? "text-sm leading-relaxed"
                            : "whitespace-pre-wrap text-sm leading-relaxed"
                        }
                      >
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    const p = part as {
                      type: string;
                      state: string;
                      output?: unknown;
                    };
                    const name = part.type.slice("tool-".length);
                    const label = toolLabel(name);
                    const done = p.state === "output-available";
                    const errored = p.state === "output-error";
                    if (errored) {
                      return (
                        <div key={i} className="mt-1">
                          <span className="chip chip-bad">✕ {label} failed</span>
                        </div>
                      );
                    }
                    if (done) {
                      const extra = summarize(p.output);
                      return (
                        <div key={i} className="mt-1">
                          <span className="chip chip-ok">
                            ✓ {label}
                            {extra ? ` — ${extra}` : ""}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="mt-1">
                        <span className="chip chip-gold pulse">⋯ {label}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))
        )}

        {error ? (
          <div className="flex flex-col items-start gap-1">
            <span className="chip chip-bad">✕ error</span>
            <p className="text-xs text-bad">{error.message}</p>
          </div>
        ) : null}
      </div>

      {/* Input */}
      <form
        className="hairline flex items-center gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm"
          placeholder="Tell the copilot what to do…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-gold" disabled={status !== "ready"}>
          Send
        </button>
      </form>
    </div>
  );
}
