"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "▚▞▟▙▛▜░▒▓◧◨◩◪";

function scramble(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return s;
}

/**
 * The signature element: a shielded value rendered as live ciphertext.
 * `revealed=false` → ticking scramble glyphs (what the public chain sees).
 * Flipping to `revealed=true` decrypts left-to-right into the real value.
 */
export function Cipher({
  value,
  revealed,
  className = "",
}: {
  value: string;
  revealed: boolean;
  className?: string;
}) {
  const len = Math.max(value.length, 6);
  const [text, setText] = useState(() => scramble(len));
  const [settled, setSettled] = useState(revealed);
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (raf.current) clearInterval(raf.current);
    if (!revealed) {
      setSettled(false);
      raf.current = setInterval(() => setText(scramble(len)), 140);
    } else {
      // decrypt animation: characters settle left to right
      let step = 0;
      const total = value.length;
      raf.current = setInterval(() => {
        step += Math.max(1, Math.ceil(total / 14));
        if (step >= total) {
          setText(value);
          setSettled(true);
          if (raf.current) clearInterval(raf.current);
        } else {
          setText(value.slice(0, step) + scramble(total - step));
        }
      }, 40);
    }
    return () => {
      if (raf.current) clearInterval(raf.current);
    };
  }, [revealed, value, len]);

  return (
    <span
      className={`cipher ${!revealed ? "cipher-hidden" : ""} ${className}`}
      style={settled ? { color: "inherit" } : undefined}
      aria-label={revealed ? value : "shielded amount"}
    >
      {revealed && settled ? value : text}
    </span>
  );
}
