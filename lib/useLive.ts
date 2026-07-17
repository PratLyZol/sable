"use client";

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./store";

/** Polls /api/state so every surface reflects chat- and agent-driven mutations live. */
export function useLive(intervalMs = 1500): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const dead = useRef(false);

  useEffect(() => {
    dead.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (res.ok && !dead.current) setSnap(await res.json());
      } catch {
        // dev server hiccup — keep polling
      }
      if (!dead.current) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      dead.current = true;
      clearTimeout(timer);
    };
  }, [intervalMs]);

  return snap;
}
