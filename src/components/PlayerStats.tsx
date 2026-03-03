"use client";

import type { StrategyType } from "@/simulation/types";

const STRATEGY_SHORT: Record<StrategyType, string> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
  external: "EXT",
};

interface ParticleData {
  id: number;
  label: string;
  color: string;
  score: number;
  avgScore: number;
  strategy: StrategyType;
  cc: number;
  cd: number;
  dc: number;
  dd: number;
}

interface Props {
  particle: ParticleData | undefined;
  allParticles: ParticleData[];
  onDeselect?: () => void;
  offline?: boolean;
}

export default function PlayerStats({ particle, allParticles, onDeselect, offline }: Props) {
  if (!particle) {
    return (
      <>
        <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
          Player Stats
        </h2>
        <div className="flex-1 flex items-center justify-center text-[11px] text-zinc-300">
          Select a player
        </div>
      </>
    );
  }

  const cc = particle.cc || 0;
  const cd = particle.cd || 0;
  const dc = particle.dc || 0;
  const dd = particle.dd || 0;
  const total = cc + cd + dc + dd;
  const coopPct = total > 0 ? (cc + cd) / total * 100 : 0;

  // Rankings & lobby averages (skip for offline players)
  const n = allParticles.length || 1;
  let rankTotal = 0, rankAvg = 0, deltaTotal = 0, deltaAvg = 0;
  if (!offline) {
    const byTotal = [...allParticles].sort((a, b) => b.score - a.score);
    const byAvg = [...allParticles].sort((a, b) => b.avgScore - a.avgScore);
    rankTotal = byTotal.findIndex((p) => p.id === particle.id) + 1;
    rankAvg = byAvg.findIndex((p) => p.id === particle.id) + 1;
    const lobbyAvgTotal = allParticles.reduce((s, p) => s + p.score, 0) / n;
    const lobbyAvgAvg = allParticles.reduce((s, p) => s + p.avgScore, 0) / n;
    deltaTotal = particle.score - lobbyAvgTotal;
    deltaAvg = particle.avgScore - lobbyAvgAvg;
  }

  return (
    <>
      <div className="flex items-center mb-1 flex-shrink-0">
        <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">
          Player Stats
        </h2>
        {onDeselect && (
          <button
            onClick={onDeselect}
            className="ml-auto text-zinc-300 hover:text-zinc-500 transition-colors text-xs leading-none px-0.5"
            aria-label="Deselect player"
          >
            &times;
          </button>
        )}
      </div>
      <div className="overflow-y-auto min-h-0 flex-1 text-[11px] font-mono">
        {/* Name + strategy */}
        <div className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: offline ? "#9CA3AF" : particle.color }}
          />
          <span className="text-zinc-800 font-semibold truncate">{particle.label}</span>
          <span className="text-zinc-300 text-[9px] tracking-wide">
            {STRATEGY_SHORT[particle.strategy]}
          </span>
          {offline && (
            <span className="ml-auto text-[8px] font-semibold tracking-wider text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">
              OFFLINE
            </span>
          )}
        </div>

        {/* Score row */}
        <div className="mt-1.5 flex items-center justify-between text-[10px]">
          <span className="flex items-center gap-1">
            <span className="text-zinc-400">Total</span>
            <span className="text-zinc-800 font-semibold">{particle.score}</span>
            {!offline && <Delta value={deltaTotal} />}
          </span>
          <span className="flex items-center gap-1">
            <span className="text-zinc-400">Avg</span>
            <span className="text-zinc-800 font-semibold">{particle.avgScore.toFixed(1)}</span>
            {!offline && <Delta value={deltaAvg} />}
          </span>
        </div>

        {/* Rank row */}
        {!offline && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-600">Rank #{rankTotal}{medal(rankTotal, n)}</span>
            <span className="text-zinc-600">Rank #{rankAvg}{medal(rankAvg, n)}</span>
          </div>
        )}

        {/* Cooperation bar */}
        <div className="mt-2 space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">{total} games</span>
            <span className="font-semibold" style={{ color: offline ? "#9CA3AF" : particle.color }}>
              {coopPct.toFixed(0)}% coop
            </span>
          </div>
          <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${coopPct}%`, backgroundColor: offline ? "#9CA3AF" : particle.color }}
            />
          </div>
        </div>

        {/* Outcome matrix */}
        <table className="mt-2 w-full text-[10px] border-collapse">
          <thead>
            <tr>
              <th />
              <th className="text-zinc-400 font-normal text-right px-1">Opp C</th>
              <th className="text-zinc-400 font-normal text-right px-1">Opp D</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-zinc-400 pr-1">You C</td>
              <td className="text-right px-1 text-emerald-700 font-medium">{cc}</td>
              <td className="text-right px-1 text-amber-600 font-medium">{cd}</td>
            </tr>
            <tr>
              <td className="text-zinc-400 pr-1">You D</td>
              <td className="text-right px-1 text-orange-600 font-medium">{dc}</td>
              <td className="text-right px-1 text-red-600 font-medium">{dd}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function medal(rank: number, total: number): string {
  if (rank === 1) return " \u{1F947}"; // gold
  if (rank === 2) return " \u{1F948}"; // silver
  if (rank === 3) return " \u{1F949}"; // bronze
  if (rank === total && total > 3) return " \u{1F944}"; // spoon
  return "";
}

function Delta({ value }: { value: number }) {
  const sign = value >= 0 ? "+" : "";
  const color = value > 0 ? "text-emerald-600" : value < 0 ? "text-red-500" : "text-zinc-400";
  return <span className={`${color} text-[10px]`}>{sign}{value.toFixed(1)}</span>;
}
