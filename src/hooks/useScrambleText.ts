"use client";

import { useState, useEffect, useRef } from "react";

const SCRAMBLE_CHARS =
  "!@#$%^&*+-=[]{}|;:<>?/~" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "0123456789" +
  "\u2588\u2591\u2592\u2593\u2580\u2584";

const CHARS_ARRAY = Array.from(SCRAMBLE_CHARS);

function randomChar(): string {
  return CHARS_ARRAY[Math.floor(Math.random() * CHARS_ARRAY.length)];
}

export interface ScrambleChar {
  char: string;
  overlay: string | null; // random char to show on top, or null if revealed/hidden
  hidden: boolean;        // true for chars beyond the scramble window
}

interface ScrambleOptions {
  delay?: number;
  speed?: number;
  scrambleSpeed?: number;
  enabled?: boolean;
}

export function useScrambleText(text: string, options: ScrambleOptions = {}) {
  const {
    delay = 0,
    speed = 40,
    scrambleSpeed = 50,
    enabled = true,
  } = options;

  const graphemes = useRef(Array.from(text));
  const [chars, setChars] = useState<ScrambleChar[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    graphemes.current = Array.from(text);
  }, [text]);

  useEffect(() => {
    if (!enabled) {
      setIsComplete(false);
      return;
    }

    const src = graphemes.current;
    const totalChars = src.length;
    const startTime = performance.now() + delay;
    const lookahead = 5;

    function tick() {
      const elapsed = performance.now() - startTime;
      const revealedCount = elapsed < 0 ? 0 : Math.min(totalChars, Math.floor(elapsed / speed));
      const scrambleEnd = Math.min(totalChars, revealedCount + lookahead);

      const next: ScrambleChar[] = src.map((ch, i) => {
        if (i < revealedCount) return { char: ch, overlay: null, hidden: false };
        if (i < scrambleEnd) return { char: ch, overlay: /\s/.test(ch) ? null : randomChar(), hidden: false };
        return { char: ch, overlay: null, hidden: true };
      });

      setChars(next);

      if (revealedCount >= totalChars) {
        setIsComplete(true);
        if (intervalId) clearInterval(intervalId);
      }
    }

    const intervalId = setInterval(tick, scrambleSpeed);
    tick();

    return () => clearInterval(intervalId);
  }, [text, delay, speed, scrambleSpeed, enabled]);

  return { chars, isComplete };
}
