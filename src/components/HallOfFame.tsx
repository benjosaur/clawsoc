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

export default function HallOfFame() {
  const [data, setData] = useState<HallOfFameResponse | null>(null);

  useEffect(() => {
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
  }, []);

  if (!data) {
    return (
      <>
        <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
          Hall of Fame
        </h2>
        <div className="flex-1 flex items-center justify-center text-[11px] text-zinc-300 font-mono">
          loading...
        </div>
      </>
    );
  }

  const ago = Math.round((Date.now() - data.updatedAt) / 60000);

  return (
    <>
      <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
        Hall of Fame
        <span className="ml-2 text-[9px] font-normal normal-case tracking-normal text-zinc-300">
          {ago < 1 ? "<1m ago" : `${ago}m ago`} | min {data.priorWeight} games
        </span>
      </h2>
      <div className="space-y-0.5 overflow-y-auto min-h-0 flex-1">
        {data.entries.length === 0 ? (
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
    </>
  );
}
