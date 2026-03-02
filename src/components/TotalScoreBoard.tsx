"use client";

import { useRef, useEffect } from "react";
import type { StrategyType } from "@/simulation/types";

const STRATEGY_SHORT: Record<StrategyType, string> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
  external: "EXT",
};

interface ParticleData {
  id: number;
  label: string;
  color: string;
  score: number;
  strategy: StrategyType;
}

interface Props {
  particles: ParticleData[];
  selectedId?: number | null;
}

export default function TotalScoreBoard({ particles, selectedId }: Props) {
  const sorted = [...particles].sort((a, b) => b.score - a.score);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId != null && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  return (
    <>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
        Total Score
      </h2>
      <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
        {sorted.map((p, i) => {
          const isSelected = selectedId != null && p.id === selectedId;
          return (
            <div
              key={p.id}
              ref={isSelected ? selectedRef : undefined}
              className={`flex items-center gap-1.5 text-[11px] font-mono py-px ${
                isSelected ? "bg-amber-50 rounded" : ""
              }`}
            >
              <span className="text-zinc-300 w-3 text-right">{i + 1}</span>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-zinc-600 flex-1 truncate">{p.label}</span>
              <span className="text-zinc-300 text-[9px] tracking-wide">
                {STRATEGY_SHORT[p.strategy]}
              </span>
              <span className="text-zinc-900 font-semibold w-8 text-right tabular-nums">
                {p.score}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
