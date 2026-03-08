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
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = () => {
    setRefreshing(true);
    fetch("/api/halloffame")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    if (!open) return;
    setData(null);
    fetchData();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

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
          🏆 Hall of Fame 🏆
        </h2>
        <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-400 mb-3">
          {data && <span>min {data.priorWeight} games</span>}
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="hover:text-zinc-600 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <svg className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4.93 9a9 9 0 0115.04-2.34L20 4M19.07 15a9 9 0 01-15.04 2.34L4 20" />
            </svg>
          </button>
        </div>
        <p className="text-[9px] text-zinc-300 text-center mb-3">
          Stats update when players leave, or hourly for live players
        </p>

        {/* Column headers */}
        <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-400 uppercase font-mono border-b border-zinc-100 pb-1.5 mb-1">
          <span className="w-5 text-right">#</span>
          <span className="w-2.5" />
          <span className="flex-1">Name</span>
          <span className="w-10">Strat</span>
          <span className="w-10 text-right">Games</span>
          <span className="w-12 text-right">Avg</span>
          <span className="w-16 text-right">Rating</span>
        </div>

        <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
          {!data ? (
            <div className="flex items-center justify-center text-xs text-zinc-300 font-mono py-8">
              loading...
            </div>
          ) : data.entries.length === 0 ? (
            <div className="text-xs text-zinc-300 font-mono py-4 text-center">
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
                  className="flex items-center gap-2 text-xs font-mono py-0.5"
                >
                  <span className="text-zinc-500 w-5 text-right">{rank}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className={`flex-1 truncate flex items-center gap-1 ${entry.isExternal ? "" : "text-zinc-700"}`}
                    style={entry.isExternal ? { color: "#E54D2E" } : undefined}
                  >
                    {entry.label}
                    {entry.isLive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Live" />
                    )}
                  </span>
                  <span className="text-zinc-500 w-10 text-[10px] tracking-wide">
                    {STRATEGY_SHORT[entry.strategy]}
                  </span>
                  <span className="text-zinc-600 w-10 text-right tabular-nums" title="Games played">
                    {entry.games}
                  </span>
                  <span className="text-zinc-600 w-12 text-right tabular-nums" title="Avg score">
                    {entry.avgScore.toFixed(2)}
                  </span>
                  <span className="text-zinc-900 font-semibold w-16 text-right tabular-nums" title="Bayesian rating">
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
