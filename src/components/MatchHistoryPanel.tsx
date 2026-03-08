"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { GameLogEntry, MatchRecord, TimeoutRecord } from "@/simulation/types";

interface Props {
  entries: GameLogEntry[];
  selectedId?: string | null;
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

const STRATEGY_LABELS: Record<string, string> = {
  always_cooperate: "Always Cooperate",
  always_defect: "Always Defect",
  tit_for_tat: "Tit for Tat",
  random: "Random",
  grudger: "Grudger",
  external: "External",
};

function strategyEmoji(strategy: string): string {
  if (strategy === "external") return "\uD83E\uDD9E";
  return "\uD83E\uDD16";
}

function MatchModalContent({ entry }: { entry: MatchRecord }) {
  return (
    <>
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-zinc-900">{strategyEmoji(entry.particleA.strategy)} {entry.particleA.id}</span>
          <span className="text-zinc-400">{STRATEGY_LABELS[entry.particleA.strategy] ?? entry.particleA.strategy}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <DecisionBadge decision={entry.decisionA} />
          <span className="text-zinc-500">+{entry.scoreA}</span>
        </div>
        {entry.messageA && (
          <p className="mt-1.5 text-zinc-500 italic leading-snug">
            &ldquo;{entry.messageA}&rdquo;
          </p>
        )}
      </div>
      <div className="border-t border-zinc-100 pt-3">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-zinc-900">{strategyEmoji(entry.particleB.strategy)} {entry.particleB.id}</span>
          <span className="text-zinc-400">{STRATEGY_LABELS[entry.particleB.strategy] ?? entry.particleB.strategy}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <DecisionBadge decision={entry.decisionB} />
          <span className="text-zinc-500">+{entry.scoreB}</span>
        </div>
        {entry.messageB && (
          <p className="mt-1.5 text-zinc-500 italic leading-snug">
            &ldquo;{entry.messageB}&rdquo;
          </p>
        )}
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

function EntryModal({ entry, onClose }: { entry: GameLogEntry; onClose: () => void }) {
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
          <MatchModalContent entry={entry} />
        ) : (
          <TimeoutModalContent entry={entry} />
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function MatchHistoryPanel({ entries, selectedId, label }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

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
                  <span className="flex-shrink-0">{strategyEmoji(entry.particleA.strategy)}</span>
                  <DecisionBadge decision={entry.decisionA} />
                  <span className="text-zinc-400 tabular-nums flex-shrink-0">+{entry.scoreA}</span>
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
                  <span className="text-zinc-400 tabular-nums flex-shrink-0">+{entry.scoreB}</span>
                  <DecisionBadge decision={entry.decisionB} />
                  <span className="flex-shrink-0">{strategyEmoji(entry.particleB.strategy)}</span>
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
        <EntryModal entry={openEntry} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
