"use client";

import { useRef, useEffect } from "react";
import type { StrategyType } from "@/simulation/types";
import { STRATEGY_SHORT, STRATEGY_TOOLTIP, useStrategyTip, StrategyTipPortal } from "@/components/StrategyTip";

interface ParticleData {
  id: string;
  color: string;
  avgScore: number;
  strategy: StrategyType;
}

interface Props {
  particles: ParticleData[];
  selectedId?: string | null;
  singleRow?: boolean;
  onSelect?: (id: string | null) => void;
}

export default function ScoreBoard({ particles, selectedId, singleRow, onSelect }: Props) {
  const sorted = [...particles].sort((a, b) => b.avgScore - a.avgScore);
  const selectedRef = useRef<HTMLDivElement>(null);
  const { tip, showTip, hideTip } = useStrategyTip();

  useEffect(() => {
    if (selectedId != null && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  const showSingle = singleRow && selectedId != null;
  const lobbyAvg = particles.length > 0
    ? particles.reduce((s, p) => s + p.avgScore, 0) / particles.length
    : 0;

  const rows = showSingle
    ? sorted.filter((p) => p.id === selectedId)
    : sorted;

  return (
    <>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
        Avg Score - Live
      </h2>
      <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
        {rows.map((p) => {
          const rank = sorted.indexOf(p) + 1;
          const isSelected = selectedId != null && p.id === selectedId;
          const delta = p.avgScore - lobbyAvg;
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
                onMouseEnter={STRATEGY_TOOLTIP[p.strategy] ? (e) => showTip(e, STRATEGY_TOOLTIP[p.strategy]!) : undefined}
                onMouseLeave={STRATEGY_TOOLTIP[p.strategy] ? hideTip : undefined}
              >
                {STRATEGY_SHORT[p.strategy] ?? ""}
              </span>
              <span className="text-zinc-900 font-semibold w-12 text-right tabular-nums">
                {p.avgScore.toFixed(2)}
              </span>
              {showSingle && (
                <span
                  className={`text-[10px] w-14 text-right tabular-nums cursor-default ${
                    delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-zinc-400"
                  }`}
                  title="Diff vs room average"
                >
                  {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <StrategyTipPortal tip={tip} />
    </>
  );
}
