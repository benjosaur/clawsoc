"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { DEFAULT_CONFIG } from "@/simulation/types";
import type { GameLogEntry } from "@/simulation/types";
import { useServerSimulation } from "@/hooks/useServerSimulation";
import SimulationCanvas from "@/components/SimulationCanvas";
import ScoreBoard from "@/components/ScoreBoard";
import TotalScoreBoard from "@/components/TotalScoreBoard";
import MatchHistoryPanel from "@/components/MatchHistoryPanel";
import PlayerSearch from "@/components/PlayerSearch";
import PanelTabs from "@/components/PanelTabs";
import PlayerStats from "@/components/PlayerStats";

export default function Home() {
  const { state, paused, togglePause, reset, viewRef, interpRef, connected } =
    useServerSimulation();
  const total = state.totalCooperations + state.totalDefections;
  const coopPct =
    total > 0 ? Math.round((state.totalCooperations / total) * 100) : 0;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const handleSelect = useCallback((id: number | null) => setSelectedId(id), []);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState<number>(
    DEFAULT_CONFIG.canvasHeight,
  );

  // Accumulated player-specific match log (persists across server refreshes)
  const [playerLog, setPlayerLog] = useState<GameLogEntry[]>([]);
  const seenLogIds = useRef<Set<string>>(new Set());

  // Reset accumulated log when selection changes
  useEffect(() => {
    setPlayerLog([]);
    seenLogIds.current.clear();
  }, [selectedId]);

  // Merge new player-specific entries as they arrive
  useEffect(() => {
    if (selectedId == null) return;
    const fresh = state.gameLog.filter(
      (e) =>
        (e.particleA.id === selectedId || e.particleB.id === selectedId) &&
        !seenLogIds.current.has(e.id),
    );
    if (fresh.length > 0) {
      for (const e of fresh) seenLogIds.current.add(e.id);
      setPlayerLog((prev) => [...prev, ...fresh]);
    }
  }, [state.gameLog, selectedId]);

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setCanvasHeight(
        Math.round(
          w * (DEFAULT_CONFIG.canvasHeight / DEFAULT_CONFIG.canvasWidth),
        ),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const avgPanel = <ScoreBoard particles={state.particles} selectedId={selectedId} />;
  const totalPanel = <TotalScoreBoard particles={state.particles} selectedId={selectedId} />;
  const logPanel = <MatchHistoryPanel entries={state.gameLog} selectedId={selectedId} />;
  const selectedParticle = selectedId != null
    ? state.particles.find((p) => p.id === selectedId)
    : undefined;
  const playerStatsPanel = <PlayerStats particle={selectedParticle} allParticles={state.particles} onDeselect={() => setSelectedId(null)} />;
  const playerLogPanel = <MatchHistoryPanel entries={playerLog} label="Match Log" />;

  return (
    <main className="min-h-screen p-4 md:p-8 flex flex-col items-center gap-4 md:gap-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          ClawSoc
        </h1>
        <span className="text-sm text-zinc-400 font-normal tracking-wide">
          We live in a society 🤡
        </span>
        <PlayerSearch
          particles={state.particles}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>

      {/* Desktop: side-by-side | Mobile: stacked */}
      <div className="w-full max-w-screen-2xl flex flex-col md:flex-row gap-4 md:gap-5">
        {/* Canvas + controls — constrain so 4:3 canvas fits in viewport height */}
        <div
          className="flex flex-col gap-3 flex-1 min-w-0"
          style={{ maxWidth: "min(100%, calc((100vh - 12rem) * 4 / 3))" }}
        >
          <div ref={canvasContainerRef} className="w-full">
            <SimulationCanvas
              viewRef={viewRef}
              interpRef={interpRef}
              config={DEFAULT_CONFIG}
              containerRef={canvasContainerRef}
              selectedId={selectedId}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={togglePause}
              className="px-3 py-1 border border-zinc-200 hover:bg-zinc-50 rounded text-xs font-medium text-zinc-700 transition-colors"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={reset}
              className="px-3 py-1 border border-zinc-200 hover:bg-zinc-50 rounded text-xs font-medium text-zinc-700 transition-colors"
            >
              Reset
            </button>
            {!connected && (
              <span className="text-[10px] text-amber-500 font-mono">
                reconnecting...
              </span>
            )}
            <div className="ml-auto flex items-center gap-3 text-[11px] font-mono">
              <span className="text-zinc-400">{state.particles.length} players</span>
              <span className="text-emerald-600">
                {state.totalCooperations}C
              </span>
              <span className="text-red-500">{state.totalDefections}D</span>
              {total > 0 && (
                <span className="text-zinc-400">{coopPct}% coop</span>
              )}
              <span className="text-zinc-300">t={state.tick}</span>
            </div>
          </div>
        </div>

        {/* Desktop sidebar — match canvas height */}
        <div
          className="hidden md:flex w-64 lg:w-72 xl:w-80 shrink-0 flex-col gap-1"
          style={{ height: canvasHeight }}
        >
          {selectedId != null ? (
            <>
              <div className="flex-[2] min-h-0 flex flex-col">{totalPanel}</div>
              <div className="flex-[2] min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {avgPanel}
              </div>
              <div className="flex-[3] min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {playerStatsPanel}
              </div>
              <div className="flex-[3] min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {playerLogPanel}
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 min-h-0 flex flex-col">{totalPanel}</div>
              <div className="flex-1 min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {avgPanel}
              </div>
              <div className="flex-1 min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {logPanel}
              </div>
            </>
          )}
        </div>

        {/* Mobile tabs */}
        <div className="md:hidden flex flex-col" style={{ minHeight: "40vh" }}>
          <PanelTabs
            avgPanel={avgPanel}
            totalPanel={totalPanel}
            logPanel={logPanel}
            playerPanel={selectedId != null ? playerStatsPanel : undefined}
          />
        </div>
      </div>
    </main>
  );
}
