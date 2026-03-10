"use client";

import { useRef, useEffect } from "react";
import type { StrategyType } from "@/simulation/types";
import { STRATEGY_SHORT, STRATEGY_TOOLTIP, useStrategyTip, StrategyTipPortal } from "@/components/StrategyTip";

interface ParticleData {
  id: string;
  color: string;
  score: number;
  avgScore: number;
  r30Total: number;
  r30Avg: number;
  strategy: StrategyType;
}

interface Props {
  particles: ParticleData[];
  selectedId?: string | null;
  singleRow?: boolean;
  onSelect?: (id: string | null) => void;
}

export default function ScoreBoard({ particles, selectedId, singleRow, onSelect }: Props) {
  const sorted = [...particles].sort((a, b) => b.r30Avg - a.r30Avg || b.r30Total - a.r30Total || b.avgScore - a.avgScore);
  const selectedRef = useRef<HTMLDivElement>(null);
  const { tip, showTip, hideTip } = useStrategyTip();

  useEffect(() => {
    if (selectedId != null && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  const showSingle = singleRow && selectedId != null;

  const rows = showSingle
    ? sorted.filter((p) => p.id === selectedId)
    : sorted;

  return (
    <>
      <div className="flex items-center gap-2 flex-shrink-0 mb-0.5">
        <h2 className="hidden md:block text-[11px] font-medium text-zinc-400 uppercase tracking-widest">
          Scoreboard
        </h2>
      </div>
      {/* Header row */}
      <div className="flex items-center gap-1.5 text-[9px] font-medium text-zinc-400 uppercase tracking-wider py-0.5 border-b border-zinc-100 flex-shrink-0">
        <span className="w-5 text-right">#</span>
        <span className="w-2" />
        <span className="w-4" />
        <span className="flex-1">Name</span>
        <span className="w-[38px] text-right" title="Total score (all time)">&Sigma;</span>
        <span className="w-[38px] text-right" title="Average score (all time)">Avg</span>
        <span className="w-[38px] text-right" title="Total score (30 min)">30m&Sigma;</span>
        <span className="w-[38px] text-right" title="Average score (30 min)">30m</span>
      </div>
      <div className="space-y-0 overflow-y-auto min-h-0 flex-1">
        {rows.map((p, rowIndex) => {
          const rank = showSingle ? sorted.indexOf(p) + 1 : rowIndex + 1;
          const isSelected = selectedId != null && p.id === selectedId;
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
              <span className="text-[10px] w-4">{p.strategy === "external" ? "🦞" : "🤖"}</span>
              <span className={`flex-1 truncate ${p.strategy === "external" ? "" : "text-zinc-600"}`} style={p.strategy === "external" ? { color: "#E54D2E" } : undefined}>
                {p.id}
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 online-dot align-middle ml-0.5" />
                <span
                  className="text-zinc-500 text-[9px] tracking-wide ml-1"
                  onMouseEnter={STRATEGY_TOOLTIP[p.strategy] ? (e) => showTip(e, STRATEGY_TOOLTIP[p.strategy]!) : undefined}
                  onMouseLeave={STRATEGY_TOOLTIP[p.strategy] ? hideTip : undefined}
                >
                  {STRATEGY_SHORT[p.strategy] ?? ""}
                </span>
              </span>
              <span className="text-zinc-500 w-[38px] text-right tabular-nums">
                {p.score}
              </span>
              <span className="text-zinc-500 w-[38px] text-right tabular-nums">
                {p.avgScore.toFixed(1)}
              </span>
              <span className="text-zinc-500 w-[38px] text-right tabular-nums">
                {p.r30Total}
              </span>
              <span className="text-zinc-900 font-semibold w-[38px] text-right tabular-nums">
                {p.r30Avg.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <StrategyTipPortal tip={tip} />
    </>
  );
}
