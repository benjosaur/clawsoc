"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { GameLogEntry, MatchRecord, TimeoutRecord, StrategyType } from "@/simulation/types";
import type { ParticleMeta } from "@/hooks/useServerSimulation";
import { STRATEGY_SHORT, STRATEGY_TOOLTIP } from "@/components/StrategyTip";

function getFaction(coopPct: number) {
  if (coopPct >= 75) return { label: "True Cooperative", emoji: "🕊️", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" };
  if (coopPct >= 50) return { label: "Pragmatic Cooperative", emoji: "⚖️", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" };
  if (coopPct >= 25) return { label: "Pragmatic Defector", emoji: "🗡️", color: "text-orange-700", bg: "bg-orange-50 border-orange-200" };
  return { label: "True Defector", emoji: "😈", color: "text-red-700", bg: "bg-red-50 border-red-200" };
}

interface Props {
  entries: GameLogEntry[];
  selectedId?: string | null;
  label?: string;
  particles?: ParticleMeta[];
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

function ParticipantRow({
  participant,
  decision,
  score,
  message,
  lookup,
}: {
  participant: { id: string; strategy: StrategyType };
  decision: "cooperate" | "defect";
  score: number;
  message?: string;
  lookup?: ParticleMeta;
}) {
  const total = lookup ? lookup.cc + lookup.cd + lookup.dc + lookup.dd : 0;
  const coopPct = total > 0 && lookup ? ((lookup.cc + lookup.cd) / total) * 100 : 0;
  const faction = total > 0 ? getFaction(coopPct) : null;

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: lookup?.color ?? "hsl(60,50%,45%)" }}
        />
        <span className="text-[10px]">{participant.strategy === "external" ? "🦞" : "🤖"}</span>
        <span className="font-medium text-zinc-900">{participant.id}</span>
        {STRATEGY_SHORT[participant.strategy] && (
          <span className="relative group cursor-default text-zinc-500 text-[9px] tracking-wide bg-zinc-100 px-1 py-0.5 rounded">
            {STRATEGY_SHORT[participant.strategy]}
            {STRATEGY_TOOLTIP[participant.strategy] && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] font-mono bg-white text-zinc-600 border border-zinc-200 rounded shadow-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {STRATEGY_TOOLTIP[participant.strategy]}
              </span>
            )}
          </span>
        )}
        {faction && (
          <span className={`ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded border ${faction.bg} ${faction.color}`}>
            {faction.emoji} {faction.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <DecisionBadge decision={decision} />
        <span className={decision === "cooperate" ? "text-emerald-600" : "text-red-500"}>+{score}</span>
      </div>
      {message && (
        <p className="mt-1.5 text-zinc-500 italic leading-snug">
          &ldquo;{message}&rdquo;
        </p>
      )}
    </div>
  );
}

function MatchModalContent({ entry, particleMap }: { entry: MatchRecord; particleMap: Map<string, ParticleMeta> }) {
  return (
    <>
      <div className="mb-3">
        <ParticipantRow
          participant={entry.particleA}
          decision={entry.decisionA}
          score={entry.scoreA}
          message={entry.messageA}
          lookup={particleMap.get(entry.particleA.id)}
        />
      </div>
      <div className="border-t border-zinc-100 pt-3">
        <ParticipantRow
          participant={entry.particleB}
          decision={entry.decisionB}
          score={entry.scoreB}
          message={entry.messageB}
          lookup={particleMap.get(entry.particleB.id)}
        />
      </div>
    </>
  );
}

function TimeoutModalContent({ entry }: { entry: TimeoutRecord }) {
  return (
    <>
      <div className="font-semibold text-zinc-900 mb-1">Timed Out</div>
      <div className="text-zinc-600">
        {entry.particleA.id} vs {entry.particleB.id}
      </div>
      {entry.reason && (
        <div className="mt-1 text-zinc-400 italic">{entry.reason}</div>
      )}
    </>
  );
}

function EntryModal({ entry, onClose, particleMap }: { entry: GameLogEntry; onClose: () => void; particleMap: Map<string, ParticleMeta> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative w-80 p-4 rounded-xl bg-white text-sm shadow-xl border border-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-600 text-lg leading-none cursor-pointer"
          onClick={onClose}
        >
          &times;
        </button>
        {entry.type === "match" ? (
          <MatchModalContent entry={entry} particleMap={particleMap} />
        ) : (
          <TimeoutModalContent entry={entry} />
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function MatchHistoryPanel({ entries, selectedId, label, particles = [] }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const particleMap = useMemo(() => {
    const map = new Map<string, ParticleMeta>();
    for (const p of particles) map.set(p.id, p);
    return map;
  }, [particles]);

  const recent = [...entries].reverse();
  const filtered =
    selectedId != null
      ? recent.filter(
          (e) => e.particleA.id === selectedId || e.particleB.id === selectedId,
        )
      : recent;

  const openEntry = openId ? filtered.find((e) => e.id === openId) : null;

  return (
    <>
      <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-widest mb-1 flex-shrink-0">
        {label ?? "Game Log"}
      </h2>
      <div className="space-y-1.5 overflow-y-auto overflow-x-hidden min-h-0 flex-1">
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-400 font-mono">
            {selectedId != null ? "no games yet" : "waiting..."}
          </p>
        )}
        {filtered.map((entry) =>
          entry.type === "match" ? (
            <div
              key={entry.id}
              className="text-sm font-mono text-zinc-600 flex gap-2 cursor-pointer hover:bg-zinc-50 rounded -mx-1 px-1 transition-colors"
              onClick={() => setOpenId(entry.id)}
            >
              {/* Left: player A */}
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1">
                  <span className="flex-shrink-0">{entry.particleA.strategy === "external" ? "🦞" : "🤖"}</span>
                  <DecisionBadge decision={entry.decisionA} />
                  <span className={`${entry.decisionA === "cooperate" ? "text-emerald-600" : "text-red-500"} tabular-nums flex-shrink-0`}>+{entry.scoreA}</span>
                  <span className="truncate">{entry.particleA.id}</span>
                </div>
                {entry.messageA && (
                  <p className="text-xs text-zinc-500 truncate">
                    &ldquo;{entry.messageA}&rdquo;
                  </p>
                )}
              </div>
              {/* Right: player B */}
              <div className="flex-1 min-w-0 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span className="truncate">{entry.particleB.id}</span>
                  <span className={`${entry.decisionB === "cooperate" ? "text-emerald-600" : "text-red-500"} tabular-nums flex-shrink-0`}>+{entry.scoreB}</span>
                  <DecisionBadge decision={entry.decisionB} />
                  <span className="flex-shrink-0">{entry.particleB.strategy === "external" ? "🦞" : "🤖"}</span>
                </div>
                {entry.messageB && (
                  <p className="text-xs text-zinc-500 truncate">
                    &ldquo;{entry.messageB}&rdquo;
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div
              key={entry.id}
              className="text-sm font-mono text-zinc-500 flex gap-2 cursor-pointer hover:bg-zinc-50 rounded -mx-1 px-1 transition-colors"
              onClick={() => setOpenId(entry.id)}
            >
              <div className="flex-1 min-w-0 text-left truncate">{entry.particleA.id}</div>
              <span className="text-zinc-400 italic text-xs flex-shrink-0">timed out</span>
              <div className="flex-1 min-w-0 text-right truncate">{entry.particleB.id}</div>
            </div>
          ),
        )}
      </div>

      {openEntry && (
        <EntryModal entry={openEntry} onClose={() => setOpenId(null)} particleMap={particleMap} />
      )}
    </>
  );
}
