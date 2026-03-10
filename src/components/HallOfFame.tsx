"use client";

import { useState, useEffect } from "react";
import type { HallOfFameResponse } from "@/simulation/types";
import { STRATEGY_SHORT, STRATEGY_TOOLTIP, useStrategyTip, StrategyTipPortal } from "@/components/StrategyTip";

const PAGE_SIZE = 20;

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectPlayer?: (label: string, isLive: boolean) => void;
}

export default function HallOfFame({ open, onClose, onSelectPlayer }: Props) {
  const [data, setData] = useState<HallOfFameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [includeBots, setIncludeBots] = useState(false);
  const { tip, showTip, hideTip } = useStrategyTip();

  const fetchPage = (p: number) => {
    setError(null);
    fetch(`/api/halloffame?page=${p}&pageSize=${PAGE_SIZE}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch((err) => {
        console.error("[HallOfFame] fetch failed:", err);
        setError("Failed to load leaderboard");
      });
  };

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    setPage(1);
    fetchPage(1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToPage = (p: number) => {
    setPage(p);
    setData(null);
    fetchPage(p);
  };

  if (!open) return null;

  const totalPages = data ? Math.max(1, Math.ceil(data.totalEntries / PAGE_SIZE)) : 1;

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
        {data && (
          <div className="text-xs text-zinc-500 text-center mb-2">
            Only those with {data.priorWeight} games are worthy to enter
          </div>
        )}
        <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-3">
          <span>Updated when a player leaves or hourly on the server</span>
          <button
            onClick={() => setIncludeBots(!includeBots)}
            className="flex items-center gap-2 cursor-pointer select-none text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            <span>Include bots</span>
            <span
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${includeBots ? "bg-amber-400" : "bg-zinc-200"}`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${includeBots ? "translate-x-3.5" : "translate-x-0.5"}`}
              />
            </span>
          </button>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-400 uppercase font-mono border-b border-zinc-100 pb-1.5 mb-1">
          <span className="w-5 text-right">#</span>
          <span className="w-2.5" />
          <span className="w-4" />
          <span className="flex-1">Name</span>
          {includeBots && <span className="w-10">Strat</span>}
          <span className="w-10 text-right">Games</span>
          <span className="w-12 text-right">Avg</span>
          <span className="w-16 text-right">Rating</span>
        </div>

        <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
          {!data ? (
            error ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <span className="text-xs text-red-500 font-mono">{error}</span>
                <button
                  onClick={() => fetchPage(page)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 underline cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center text-xs text-zinc-300 font-mono py-8">
                loading...
              </div>
            )
          ) : (includeBots ? data.entries : data.entries.filter(e => e.isExternal)).length === 0 ? (
            <div className="text-xs text-zinc-300 font-mono py-4 text-center">
              No players qualify yet (need {data.priorWeight}+ games)
            </div>
          ) : (
            (includeBots ? data.entries : data.entries.filter(e => e.isExternal)).map((entry, i) => {
              const rank = (data.page - 1) * data.pageSize + i + 1;
              const hue = Math.round((entry.coopPct / 100) * 120);
              const color = `hsl(${hue},70%,42%)`;
              return (
                <div
                  key={entry.label}
                  className="flex items-center gap-2 text-xs font-mono py-0.5 cursor-pointer hover:bg-zinc-50 rounded"
                  onClick={() => {
                    onSelectPlayer?.(entry.label, entry.isLive);
                    onClose();
                  }}
                >
                  <span className="text-zinc-500 w-5 text-right">{rank}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="w-4 text-center flex-shrink-0">{entry.isExternal ? "\u{1F99E}" : "\u{1F916}"}</span>
                  <span
                    className={`flex-1 truncate flex items-center gap-1 ${entry.isExternal ? "" : "text-zinc-700"}`}
                    style={entry.isExternal ? { color: "#E54D2E" } : undefined}
                  >
                    {entry.label}
                    {entry.isLive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 online-dot" title="Live" />
                    )}
                  </span>
                  {includeBots && (
                    <span
                      className="text-zinc-500 w-10 text-[10px] tracking-wide cursor-default"
                      onMouseEnter={STRATEGY_TOOLTIP[entry.strategy] ? (e) => showTip(e, STRATEGY_TOOLTIP[entry.strategy]!) : undefined}
                      onMouseLeave={hideTip}
                    >
                      {STRATEGY_SHORT[entry.strategy] ?? ""}
                    </span>
                  )}
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

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 pt-3 mt-2 border-t border-zinc-100">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-default"
            >
              &lsaquo;
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={`w-6 h-6 rounded text-xs font-mono ${
                  p === page
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-default"
            >
              &rsaquo;
            </button>
          </div>
        )}
      </div>
      <StrategyTipPortal tip={tip} />
    </div>
  );
}
