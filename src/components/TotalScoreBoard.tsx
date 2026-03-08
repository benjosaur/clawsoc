"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { StrategyType } from "@/simulation/types";

const STRATEGY_SHORT: Record<StrategyType, string> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
  external: "🦞",
};

const STRATEGY_TOOLTIP: Record<StrategyType, string> = {
  always_cooperate: "COOPERATE 🕊️ — Always cooperates",
  always_defect: "DEFECT 😈 — Always defects",
  tit_for_tat: "TIT FOR TAT 🪞 — Mirrors opponent's last move",
  random: "RANDOM 🎲 — Chooses randomly",
  grudger: "GRUDGE 🔒 — Cooperates until betrayed",
  external: "EXTERNAL 🦞 — Human or API-controlled",
};

interface ParticleData {
  id: string;
  color: string;
  score: number;
  strategy: StrategyType;
}

interface Props {
  particles: ParticleData[];
  selectedId?: string | null;
  singleRow?: boolean;
  onSelect?: (id: string | null) => void;
}

export default function TotalScoreBoard({ particles, selectedId, singleRow, onSelect }: Props) {
  const sorted = [...particles].sort((a, b) => b.score - a.score);
  const selectedRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const showTip = useCallback((e: React.MouseEvent, strategy: StrategyType) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text: STRATEGY_TOOLTIP[strategy], x: rect.right, y: rect.top - 4 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (selectedId != null && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  const showSingle = singleRow && selectedId != null;
  const lobbyAvg = particles.length > 0
    ? particles.reduce((s, p) => s + p.score, 0) / particles.length
    : 0;

  const rows = showSingle
    ? sorted.filter((p) => p.id === selectedId)
    : sorted;

  return (
    <>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
        Total Score - Live
      </h2>
      <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
        {rows.map((p) => {
          const rank = sorted.indexOf(p) + 1;
          const isSelected = selectedId != null && p.id === selectedId;
          const delta = p.score - lobbyAvg;
          return (
            <div
              key={p.id}
              ref={isSelected ? selectedRef : undefined}
              className={`flex items-center gap-1.5 text-[11px] font-mono py-px cursor-pointer hover:bg-zinc-50 ${
                isSelected ? "bg-amber-50 rounded" : ""
              }`}
              onClick={() => onSelect?.(isSelected ? null : p.id)}
            >
              <span className="text-zinc-500 w-5 text-right">{rank}</span>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-[10px]">{p.strategy === "external" ? "🦞" : "🤖"}</span>
              <span className={`flex-1 truncate ${p.strategy === "external" ? "" : "text-zinc-600"}`} style={p.strategy === "external" ? { color: "#E54D2E" } : undefined}>{p.id}</span>
              <span
                className="text-zinc-500 text-[9px] tracking-wide"
                onMouseEnter={(e) => showTip(e, p.strategy)}
                onMouseLeave={hideTip}
              >
                {STRATEGY_SHORT[p.strategy]}
              </span>
              <span className="text-zinc-900 font-semibold w-12 text-right tabular-nums">
                {p.score}
              </span>
              {showSingle && (
                <span
                  className={`text-[10px] w-14 text-right tabular-nums cursor-default ${
                    delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-zinc-400"
                  }`}
                  title="Diff vs room average"
                >
                  {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {tip && (
        <div
          className="fixed px-2.5 py-1.5 bg-white border border-zinc-200 rounded shadow-sm text-[10px] font-mono text-zinc-600 whitespace-nowrap z-50 pointer-events-none"
          style={{ left: tip.x, top: tip.y, transform: "translate(-100%, -100%)" }}
        >
          {tip.text}
        </div>
      )}
    </>
  );
}
