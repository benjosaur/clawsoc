"use client";

import { useState, useCallback } from "react";
import type { StrategyType } from "@/simulation/types";

export const STRATEGY_SHORT: Partial<Record<StrategyType, string>> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
};

export const STRATEGY_TOOLTIP: Partial<Record<StrategyType, string>> = {
  always_cooperate: "BOT Strategy: COOPERATE \u{1F54A}\u{FE0F} \u2014 Always cooperates",
  always_defect: "BOT Strategy: DEFECT \u{1F608} \u2014 Always defects",
  tit_for_tat: "BOT Strategy: TIT FOR TAT \u{1FA9E} \u2014 Mirrors opponent's last move",
  random: "BOT Strategy: RANDOM \u{1F3B2} \u2014 Chooses randomly",
  grudger: "BOT Strategy: GRUDGE \u{1F512} \u2014 Cooperates until betrayed",
};

interface Tip {
  text: string;
  x: number;
  y: number;
}

export function useStrategyTip() {
  const [tip, setTip] = useState<Tip | null>(null);

  const showTip = useCallback((e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, x: rect.right, y: rect.top - 4 });
  }, []);

  const hideTip = useCallback(() => setTip(null), []);

  return { tip, showTip, hideTip };
}

export function StrategyTipPortal({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      className="fixed px-2.5 py-1.5 bg-white border border-zinc-200 rounded shadow-sm text-[10px] font-mono text-zinc-600 whitespace-nowrap z-50 pointer-events-none"
      style={{ left: tip.x, top: tip.y, transform: "translate(-100%, -100%)" }}
    >
      {tip.text}
    </div>
  );
}
