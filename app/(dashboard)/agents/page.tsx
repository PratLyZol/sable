"use client";

import { useState } from "react";
import { useLive } from "@/lib/useLive";
import { clock, usd } from "@/lib/format";
import type { AgentRun, Payment, Subagent, SubagentEvent } from "@/lib/store";

const PRESETS: Array<{ label: string; goal: string }> = [
  { label: "Market-research brief", goal: "Assemble a market-research brief on stablecoin payment APIs" },
  { label: "Competitive pricing scan", goal: "Run a competitive pricing scan across x402 API data vendors" },
  { label: "Dataset acquisition + verification", goal: "Acquire and verify a dataset of stablecoin transaction volumes" },
];

function pct(spent: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.max(0, (spent / cap) * 100));
}

// A budget/cap fill bar. `h` sets the track height class.
function CapBar({ spent, cap, h }: { spent: number; cap: number; h: string }) {
  return (
    <div className={`${h} w-full overflow-hidden rounded-full bg-panel2`}>
      <div
        className={`${h} rounded-full`}
        style={{ width: `${pct(spent, cap)}%`, background: "var(--gold)" }}
      />
    </div>
  );
}

function statusChip(status: AgentRun["status"] | Subagent["status"]) {
  switch (status) {
    case "running":
    case "working":
      return <span className="chip chip-gold pulse">{status}</span>;
    case "complete":
    case "done":
      return <span className="chip chip-ok">{status}</span>;
    case "halted":
      return <span className="chip chip-bad">{status}</span>;
    case "pending":
      return <span className="chip text-dim">queued</span>;
    default:
      return <span className="chip">{status}</span>;
  }
}

function eventColor(kind: SubagentEvent["kind"]): string {
  switch (kind) {
    case "x402":
      return "text-veil";
    case "pay":
      return "text-ok";
    case "blocked":
      return "text-bad font-medium";
    case "done":
      return "text-gold";
    default:
      return "text-dim";
  }
}

function SubagentRow({ sa }: { sa: Subagent }) {
  const events = sa.events.slice(-6);
  return (
    <div className="hairline space-y-2 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="num text-veil">{sa.name}</span>
          <span className="ml-2 text-xs text-dim">{sa.role}</span>
          <p className="text-xs text-faint">{sa.task}</p>
        </div>
        <div className="flex-none">{statusChip(sa.status)}</div>
      </div>

      <div className="space-y-1">
        <CapBar spent={sa.spent} cap={sa.cap} h="h-1" />
        <div className="num text-xs text-faint">
          {usd(sa.spent)} / {usd(sa.cap)}
        </div>
      </div>

      {events.length > 0 ? (
        <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
          {events.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span className="flex-none text-faint">{clock(e.ts)}</span>
              <span className={eventColor(e.kind)}>{e.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunCard({ run, payments }: { run: AgentRun; payments: Payment[] }) {
  const [halting, setHalting] = useState(false);
  const runPayments = payments.filter((p) => p.runId === run.id);

  const halt = async () => {
    setHalting(true);
    try {
      await fetch("/api/agents/halt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
    } finally {
      setHalting(false);
    }
  };

  return (
    <div className="panel space-y-4 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{run.goal}</p>
        <div className="flex flex-none items-center gap-2">
          {statusChip(run.status)}
          {run.status === "running" ? (
            <button className="btn-danger" onClick={halt} disabled={halting}>
              Kill switch
            </button>
          ) : null}
        </div>
      </div>

      {/* Budget bar */}
      <div className="space-y-1.5">
        <CapBar spent={run.spent} cap={run.budget} h="h-2" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="num">
              {usd(run.spent)} of {usd(run.budget)}
            </span>
            {run.blocked.length > 0 ? (
              <span className="text-xs text-bad">✕ {run.blocked.length} refused</span>
            ) : null}
          </div>
          <span className="text-xs text-faint">hard cap — enforced at signature</span>
        </div>
      </div>

      {/* Spend tree */}
      <div className="space-y-1">
        {run.subagents.map((sa) => (
          <SubagentRow key={sa.id} sa={sa} />
        ))}
      </div>

      {/* Deliverable */}
      {run.result ? (
        <div className="panel-raised space-y-2 p-4">
          <div className="eyebrow">Deliverable</div>
          <p className="text-sm leading-relaxed">{run.result}</p>
        </div>
      ) : null}

      {/* Payments */}
      {runPayments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {runPayments.map((p) =>
            p.explorerUrl ? (
              <a
                key={p.id}
                href={p.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="chip chip-veil num hover:underline"
                title="View on Solana Explorer"
              >
                {usd(p.amount)} → {p.counterparty}
              </a>
            ) : (
              <span key={p.id} className="chip chip-veil num">
                {usd(p.amount)} → {p.counterparty}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function AgentsPage() {
  const snap = useLive();
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState(5);
  const [dispatching, setDispatching] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || dispatching) return;
    if (!Number.isFinite(budget) || budget < 0.5) {
      setFormError("Budget must be at least $0.50.");
      return;
    }
    setFormError(null);
    setDispatching(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), budget }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.error ?? "Dispatch failed.");
        return;
      }
      setGoal("");
    } finally {
      setDispatching(false);
    }
  };

  const runs = snap?.runs ?? null;
  const payments = snap?.payments ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <div className="eyebrow">Agent dispatch</div>
        <h1 className="display text-3xl">Hand it a goal and a budget.</h1>
        <p className="text-dim">
          Subagents pay their own way over x402 — shielded, capped, revocable.
        </p>
      </header>

      {/* Dispatch form */}
      <form onSubmit={dispatch} className="panel-raised space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm"
            placeholder="Assemble a market-research brief on stablecoin payment APIs"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <input
            type="number"
            min={0.5}
            step={0.5}
            className="num w-28 rounded-lg bg-panel2 px-3 py-2 text-sm"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
          <button type="submit" className="btn-gold" disabled={dispatching || !goal.trim()}>
            Dispatch fleet
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => setGoal(p.goal)}>
              {p.label}
            </button>
          ))}
        </div>

        {formError ? <p className="text-xs text-bad">{formError}</p> : null}

        <p className="text-xs text-dim">
          The orchestrator mints each subagent a scoped session key. The master key never leaves the vault.
        </p>
      </form>

      {/* Fleet runs */}
      {runs === null ? (
        <div className="panel p-5 text-dim">…</div>
      ) : runs.length === 0 ? (
        <div className="panel p-5 text-dim">
          No fleets dispatched yet. Give the orchestrator a goal above, or ask the copilot.
        </div>
      ) : (
        <div className="space-y-5">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} payments={payments} />
          ))}
        </div>
      )}
    </div>
  );
}
