"use client";

import { GameLogEntry } from "@/simulation/types";

interface Props {
  entries: GameLogEntry[];
  selectedId?: number | null;
  label?: string;
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

export default function MatchHistoryPanel({ entries, selectedId, label }: Props) {
  const recent = [...entries].reverse();
  const filtered =
    selectedId != null
      ? recent.filter(
          (e) => e.particleA.id === selectedId || e.particleB.id === selectedId,
        )
      : recent;

  return (
    <>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
        {label ?? "Game Log"}
      </h2>
      <div className="space-y-1 overflow-y-auto min-h-0 flex-1">
        {filtered.length === 0 && (
          <p className="text-[11px] text-zinc-400 font-mono">
            {selectedId != null ? "no games yet" : "waiting..."}
          </p>
        )}
        {filtered.map((entry) =>
          entry.type === "match" ? (
            <div
              key={entry.id}
              className="text-[10px] font-mono text-zinc-600 flex gap-2"
            >
              {/* Left: player A */}
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1">
                  <span className="truncate">{entry.particleA.label}</span>
                  <DecisionBadge decision={entry.decisionA} />
                  <span className="text-zinc-500 tabular-nums">+{entry.scoreA}</span>
                </div>
                {entry.messageA && (
                  <p className="text-[9px] text-zinc-400 truncate">
                    &ldquo;{entry.messageA}&rdquo;
                  </p>
                )}
              </div>
              {/* Right: player B */}
              <div className="flex-1 min-w-0 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span className="text-zinc-500 tabular-nums">+{entry.scoreB}</span>
                  <DecisionBadge decision={entry.decisionB} />
                  <span className="truncate">{entry.particleB.label}</span>
                </div>
                {entry.messageB && (
                  <p className="text-[9px] text-zinc-400 truncate">
                    &ldquo;{entry.messageB}&rdquo;
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div
              key={entry.id}
              className="text-[10px] font-mono text-zinc-500 flex gap-2"
            >
              <div className="flex-1 min-w-0 text-left truncate">{entry.particleA.label}</div>
              <span className="text-zinc-400 italic text-[9px] flex-shrink-0">timed out</span>
              <div className="flex-1 min-w-0 text-right truncate">{entry.particleB.label}</div>
            </div>
          ),
        )}
      </div>
    </>
  );
}
