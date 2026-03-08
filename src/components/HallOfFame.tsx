"use client";

import { useState, useEffect } from "react";
import type { StrategyType, HallOfFameResponse } from "@/simulation/types";

const STRATEGY_SHORT: Record<StrategyType, string> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
  external: "\u{1F99E}",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function HallOfFame({ open, onClose }: Props) {
  const [data, setData] = useState<HallOfFameResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    let active = true;
    const fetchData = () => {
      fetch("/api/halloffame")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (active && d) setData(d); })
        .catch(() => {});
    };
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => { active = false; clearInterval(interval); };
  }, [open]);

  if (!open) return null;

  const ago = data ? Math.round((Date.now() - data.updatedAt) / 60000) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl border border-gray-200 p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
        >
          &times;
        </button>

        <h2 className="text-lg font-bold text-center mb-1">
          Hall of Fame
        </h2>
        {data && (
          <p className="text-[10px] text-zinc-400 text-center mb-3">
            {ago < 1 ? "<1m ago" : `${ago}m ago`} | min {data.priorWeight} games
          </p>
        )}

        <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
          {!data ? (
            <div className="flex items-center justify-center text-[11px] text-zinc-300 font-mono py-8">
              loading...
            </div>
          ) : data.entries.length === 0 ? (
            <div className="text-[11px] text-zinc-300 font-mono py-4 text-center">
              No players qualify yet (need {data.priorWeight}+ games)
            </div>
          ) : (
            data.entries.map((entry, i) => {
              const rank = (data.page - 1) * data.pageSize + i + 1;
              const hue = Math.round((entry.coopPct / 100) * 120);
              const color = `hsl(${hue},70%,42%)`;
              return (
                <div
                  key={entry.label}
                  className="flex items-center gap-1.5 text-[11px] font-mono py-px"
                >
                  <span className="text-zinc-300 w-4 text-right">{rank}</span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className={`flex-1 truncate ${entry.isExternal ? "" : "text-zinc-600"}`}
                    style={entry.isExternal ? { color: "#E54D2E" } : undefined}
                  >
                    {entry.label}
                  </span>
                  {entry.isLive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Live" />
                  )}
                  <span className="text-zinc-300 text-[9px] tracking-wide">
                    {STRATEGY_SHORT[entry.strategy]}
                  </span>
                  <span className="text-zinc-400 text-[9px] w-8 text-right tabular-nums" title="Games played">
                    {entry.games}
                  </span>
                  <span className="text-zinc-400 text-[9px] w-10 text-right tabular-nums" title="Avg score">
                    {entry.avgScore.toFixed(2)}
                  </span>
                  <span className="text-zinc-900 font-semibold w-14 text-right tabular-nums" title="Bayesian rating">
                    {entry.bayesianRating.toFixed(4)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
