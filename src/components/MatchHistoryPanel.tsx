"use client";

import { GameLogEntry } from "@/simulation/types";

interface Props {
  entries: GameLogEntry[];
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

export default function MatchHistoryPanel({ entries }: Props) {
  const recent = [...entries].reverse();

  return (
    <div>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-2">
        Game Log
      </h2>
      <div className="space-y-px max-h-[320px] overflow-y-auto">
        {recent.length === 0 && (
          <p className="text-[11px] text-zinc-300 font-mono">waiting...</p>
        )}
        {recent.map((entry) =>
          entry.type === "match" ? (
            <div key={entry.id} className="mb-1">
              <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                <span className="truncate max-w-[52px]">{entry.particleA.label}</span>
                <DecisionBadge decision={entry.decisionA} />
                <span className="text-zinc-300">:</span>
                <DecisionBadge decision={entry.decisionB} />
                <span className="truncate max-w-[52px]">{entry.particleB.label}</span>
                <span className="text-zinc-300 ml-auto tabular-nums">
                  {entry.scoreA}/{entry.scoreB}
                </span>
              </div>
              {(entry.messageA || entry.messageB) && (
                <div className="ml-3 space-y-px">
                  {entry.messageA && (
                    <p className="text-[9px] font-mono text-zinc-300 truncate max-w-[200px]">
                      &ldquo;{entry.messageA}&rdquo;
                    </p>
                  )}
                  {entry.messageB && (
                    <p className="text-[9px] font-mono text-zinc-300 truncate max-w-[200px]">
                      &ldquo;{entry.messageB}&rdquo;
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div key={entry.id} className="text-[10px] font-mono text-zinc-400 flex items-center gap-1 mb-1">
              <span className="truncate max-w-[52px]">{entry.particleA.label}</span>
              <span className="text-zinc-300">&times;</span>
              <span className="truncate max-w-[52px]">{entry.particleB.label}</span>
              <span className="text-zinc-300 ml-auto italic">timed out</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
