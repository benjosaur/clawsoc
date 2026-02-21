"use client";

import { MatchRecord } from "@/simulation/types";

interface Props {
  matches: MatchRecord[];
}

function DecisionBadge({ decision }: { decision: "cooperate" | "defect" }) {
  return (
    <span
      className={`font-bold ${
        decision === "cooperate" ? "text-green-400" : "text-red-400"
      }`}
    >
      {decision === "cooperate" ? "C" : "D"}
    </span>
  );
}

export default function MatchHistoryPanel({ matches }: Props) {
  const recent = [...matches].reverse();

  return (
    <div className="bg-slate-800 rounded-lg p-3">
      <h2 className="text-sm font-bold text-slate-200 mb-2">Match History</h2>
      <div className="space-y-1 max-h-[340px] overflow-y-auto">
        {recent.length === 0 && (
          <p className="text-xs text-slate-500">No matches yet...</p>
        )}
        {recent.map((m) => (
          <div key={m.id} className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
            <span className="truncate max-w-[60px]">{m.particleA.label}</span>
            <DecisionBadge decision={m.decisionA} />
            <span className="text-slate-600">vs</span>
            <DecisionBadge decision={m.decisionB} />
            <span className="truncate max-w-[60px]">{m.particleB.label}</span>
            <span className="text-slate-600 ml-auto">
              {m.scoreA}/{m.scoreB}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
