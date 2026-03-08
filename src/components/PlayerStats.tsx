"use client";

import type { StrategyType } from "@/simulation/types";

const STRATEGY_SHORT: Record<StrategyType, string> = {
  always_cooperate: "COOP",
  always_defect: "DEFT",
  tit_for_tat: "TFT",
  random: "RAND",
  grudger: "GRDG",
  external: "\u{1F99E}",
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
  greeting?: string;
}

interface Props {
  particle: ParticleData | undefined;
  onDeselect?: () => void;
  offline?: boolean;
}

function getFaction(coopPct: number) {
  if (coopPct >= 75) return { label: "True Cooperative", emoji: "\u{1F6E1}\u{FE0F}", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", tooltip: "Cooperates 75-100% of the time" };
  if (coopPct >= 50) return { label: "Pragmatic Cooperative", emoji: "\u{2696}\u{FE0F}", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", tooltip: "Cooperates 50-75% of the time" };
  if (coopPct >= 25) return { label: "Pragmatic Defector", emoji: "\u{1F5E1}\u{FE0F}", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", tooltip: "Cooperates 25-50% of the time" };
  return { label: "True Defector", emoji: "\u{1F480}", color: "text-red-700", bg: "bg-red-50 border-red-200", tooltip: "Cooperates 0-25% of the time" };
}

export default function PlayerStats({ particle, onDeselect, offline }: Props) {
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
  const faction = getFaction(coopPct);

  return (
    <>
      <div className="flex items-center mb-1 flex-shrink-0">
        <h2 className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">
          Player Stats
        </h2>
        {onDeselect && (
          <button
            onClick={onDeselect}
            className="ml-auto text-zinc-300 hover:text-zinc-500 transition-colors text-xs leading-none px-0.5 cursor-pointer"
            aria-label="Deselect player"
          >
            &times;
          </button>
        )}
      </div>
      <div className="overflow-y-auto min-h-0 flex-1 text-[11px] font-mono">
        {/* Name + strategy + faction badge */}
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
          {!offline && total > 0 && (
            <span className={`ml-auto text-[8px] font-semibold px-1.5 py-0.5 rounded border cursor-default ${faction.bg} ${faction.color}`} title={faction.tooltip}>
              {faction.emoji} {faction.label}
            </span>
          )}
        </div>

        {/* Greeting (external agents only) */}
        {particle.greeting && (
          <p className="mt-1 text-[10px] text-zinc-400 italic leading-tight line-clamp-3">
            &ldquo;{particle.greeting}&rdquo;
          </p>
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

        {/* Badge row */}
        <div className="mt-1.5 flex items-center gap-2 text-[10px]">
          {total >= 100 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700 font-semibold text-[8px]">
              {"\u{1F3DB}\u{FE0F}"} Centurion
            </span>
          )}
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
