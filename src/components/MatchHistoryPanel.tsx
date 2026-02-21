"use client";

import { MatchRecord } from "@/simulation/types";

interface Props {
  matches: MatchRecord[];
}

function DecisionBadge({ decision }: { decision: "cooperate" | "defect" }) {
  return (
    <span
      className={`font-semibold ${
        decision === "cooperate" ? "text-emerald-600" : "text-red-500"
      }`}
    >
      {decision === "cooperate" ? "C" : "D"}
    </span>
  );
}

export default function MatchHistoryPanel({ matches }: Props) {
  const recent = [...matches].reverse();

  return (
    <div>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-2">
        Match Log
      </h2>
      <div className="space-y-px max-h-[320px] overflow-y-auto">
        {recent.length === 0 && (
          <p className="text-[11px] text-zinc-300 font-mono">waiting...</p>
        )}
        {recent.map((m) => (
          <div key={m.id} className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
            <span className="truncate max-w-[52px]">{m.particleA.label}</span>
            <DecisionBadge decision={m.decisionA} />
            <span className="text-zinc-300">:</span>
            <DecisionBadge decision={m.decisionB} />
            <span className="truncate max-w-[52px]">{m.particleB.label}</span>
            <span className="text-zinc-300 ml-auto tabular-nums">
              {m.scoreA}/{m.scoreB}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
