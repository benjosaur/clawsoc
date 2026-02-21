"use client";

import { Particle, StrategyType } from "@/simulation/types";

const STRATEGY_SHORT: Record<StrategyType, string> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
};

interface Props {
  particles: Particle[];
}

export default function ScoreBoard({ particles }: Props) {
  const sorted = [...particles].sort((a, b) => b.score - a.score);

  return (
    <div className="bg-slate-800 rounded-lg p-3">
      <h2 className="text-sm font-bold text-slate-200 mb-2">Leaderboard</h2>
      <div className="space-y-1">
        {sorted.map((p, i) => (
          <div
            key={p.id}
            className="flex items-center gap-2 text-xs font-mono py-0.5"
          >
            <span className="text-slate-500 w-4 text-right">{i + 1}</span>
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-slate-300 flex-1 truncate">{p.label}</span>
            <span className="text-slate-500 text-[10px]">
              {STRATEGY_SHORT[p.strategy]}
            </span>
            <span className="text-slate-100 font-bold w-8 text-right">
              {p.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
