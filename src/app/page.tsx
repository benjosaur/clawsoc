"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { DEFAULT_CONFIG } from "@/simulation/types";
import type { GameLogEntry, StrategyType } from "@/simulation/types";
import { useServerSimulation } from "@/hooks/useServerSimulation";
import SimulationCanvas from "@/components/SimulationCanvas";
import ScoreBoard from "@/components/ScoreBoard";
import TotalScoreBoard from "@/components/TotalScoreBoard";
import MatchHistoryPanel from "@/components/MatchHistoryPanel";
import PlayerSearch from "@/components/PlayerSearch";
import PanelTabs from "@/components/PanelTabs";
import PlayerStats from "@/components/PlayerStats";
import JoinModal from "@/components/JoinModal";
import HallOfFame from "@/components/HallOfFame";

export default function Home() {
  const { state, simRef, metaRef, popupsRef, connected } =
    useServerSimulation();
  const total = state.totalCooperations + state.totalDefections;
  const coopPct =
    total > 0 ? Math.round((state.totalCooperations / total) * 100) : 0;
  const externalCount = state.particles.filter(p => p.strategy === "external").length;
  const npcCount = state.particles.length - externalCount;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showJoinModal, setShowJoinModal] = useState(true);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [offlinePlayer, setOfflinePlayer] = useState<{
    id: string;
    strategy: StrategyType;
    score: number;
    avgScore: number;
    cc: number; cd: number; dc: number; dd: number;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNotFound, setSearchNotFound] = useState(false);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id !== null) { setOfflinePlayer(null); setSearchNotFound(false); }
  }, []);

  const searchDatabase = useCallback(async (query: string) => {
    setSearching(true);
    setOfflinePlayer(null);
    setSelectedId(null);
    setSearchNotFound(false);
    try {
      const res = await fetch(`/api/player/lookup?name=${encodeURIComponent(query)}`);
      if (res.status === 404) {
        setSearchNotFound(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "live") {
        setSelectedId(data.id);
      } else if (data.status === "offline") {
        setOfflinePlayer({
          id: data.id,
          strategy: data.strategy,
          score: data.score,
          avgScore: data.avgScore,
          cc: data.cc, cd: data.cd, dc: data.dc, dd: data.dd,
        });
      }
    } catch (err) {
      console.error("Player lookup failed:", err);
    } finally {
      setSearching(false);
    }
  }, []);
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

  const selectedParticle = selectedId != null
    ? state.particles.find((p) => p.id === selectedId)
    : undefined;
  const isOffline = offlinePlayer != null && selectedId == null;
  const hasSelection = selectedId != null || isOffline;
  const avgPanel = <ScoreBoard particles={state.particles} selectedId={selectedId} singleRow={hasSelection} onSelect={handleSelect} />;
  const totalPanel = <TotalScoreBoard particles={state.particles} selectedId={selectedId} singleRow={hasSelection} onSelect={handleSelect} />;
  const logPanel = <MatchHistoryPanel entries={state.gameLog} selectedId={selectedId} particles={state.particles} />;
  const displayParticle = isOffline
    ? {
        id: offlinePlayer.id,
        color: "#9CA3AF",
        score: offlinePlayer.score,
        avgScore: offlinePlayer.avgScore,
        strategy: offlinePlayer.strategy,
        cc: offlinePlayer.cc, cd: offlinePlayer.cd,
        dc: offlinePlayer.dc, dd: offlinePlayer.dd,
      }
    : selectedParticle;
  const playerStatsPanel = (
    <PlayerStats
      particle={displayParticle}

      onDeselect={() => { setSelectedId(null); setOfflinePlayer(null); }}
      offline={isOffline}
    />
  );
  const playerLogPanel = <MatchHistoryPanel entries={playerLog} label="Match Log" particles={state.particles} />;

  return (
    <main className="min-h-screen p-4 md:p-8 flex flex-col items-center gap-2 md:gap-3 overflow-x-hidden">
      <header className="w-full max-w-screen-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg md:text-2xl font-semibold tracking-tight text-zinc-900">
            ClawSoc
          </h1>
          <span className="hidden sm:inline text-sm md:text-base text-zinc-400 font-normal tracking-wide">
            We live in a society 🤡
          </span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-sm font-mono">
            <span className="relative group cursor-default" style={{ color: "#E54D2E" }}>
              🦞 {externalCount}
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] bg-white text-zinc-600 border border-zinc-200 rounded shadow-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {externalCount} AI Agents playing
              </span>
            </span>
            <span className="text-zinc-400 relative group cursor-default">
              🤖 {npcCount}
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] bg-white text-zinc-600 border border-zinc-200 rounded shadow-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {npcCount} NPCs playing
              </span>
            </span>
          </div>
          <span className="hof-rainbow">
            <button
              onClick={() => setShowHallOfFame(true)}
              className="px-2 py-0.5 md:px-4 md:py-1.5 bg-amber-100 hover:bg-amber-50 text-[11px] md:text-sm font-medium text-amber-700"
            >
              Hall of Fame
            </button>
          </span>
          <button
            onClick={() => setShowJoinModal(true)}
            className="px-2 py-0.5 md:px-4 md:py-1.5 border border-emerald-300 bg-emerald-100 hover:bg-emerald-50 rounded text-[11px] md:text-sm font-medium text-emerald-700"
          >
            Join
          </button>
        </div>
      </header>

      {/* Desktop: side-by-side | Mobile: stacked */}
      <div className="w-full max-w-screen-2xl flex flex-col md:flex-row gap-4 md:gap-5">
        {/* Canvas + controls — constrain so 4:3 canvas fits in viewport height */}
        <div
          className="flex flex-col gap-1.5 min-w-0"
          style={{ flex: "3 1 0%", maxWidth: "min(100%, calc((100vh - 12rem) * 4 / 3))" }}
        >
          <div ref={canvasContainerRef} className="w-full">
            <SimulationCanvas
              simRef={simRef}
              metaRef={metaRef}
              popupsRef={popupsRef}
              containerRef={canvasContainerRef}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </div>

          <div className="flex items-start justify-center gap-2 text-[8px] md:text-[11px] font-mono">
            <div className="flex flex-wrap gap-x-3 text-zinc-400">
              <span>Colour: Coop %<span className="hidden md:inline"> (R = 0%, Y = 50%, G = 100%)</span></span>
              <span>Number: Avg Score<span className="hidden md:inline"> (Rounded)</span></span>
            </div>
            <div className="ml-auto flex items-center gap-1.5 md:gap-3">
              {!connected && (
                <span className="text-[10px] text-amber-500">
                  reconnecting...
                </span>
              )}
              <span className="text-emerald-600">
                {state.totalCooperations}C
              </span>
              <span className="text-red-500">{state.totalDefections}D</span>
              {total > 0 && (
                <span className="hidden md:inline text-zinc-400">{coopPct}% coop</span>
              )}
              <span className="text-zinc-300">t={state.tick}</span>
            </div>
          </div>
        </div>

        {/* Desktop sidebar — match canvas height */}
        <div
          className="hidden md:flex min-w-72 lg:min-w-80 xl:min-w-96 flex-col gap-1"
          style={{ flex: "1 0 0%", height: canvasHeight }}
        >
          <div className="flex-shrink-0 pb-1">
            <PlayerSearch
              particles={state.particles}
              selectedId={selectedId}
              onSelect={handleSelect}
              onSearchDatabase={searchDatabase}
              isSearching={searching}
              offlinePlayerLabel={offlinePlayer?.id ?? null}
              notFound={searchNotFound}
              onClearNotFound={() => setSearchNotFound(false)}
            />
          </div>
          {hasSelection ? (
            <>
              <div className="flex-shrink-0 flex flex-col">{totalPanel}</div>
              <div className="flex-shrink-0 flex flex-col border-t border-zinc-100 pt-1">
                {avgPanel}
              </div>
              <div className="flex-[3] min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {playerStatsPanel}
              </div>
              {!isOffline && (
                <div className="flex-[3] min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                  {playerLogPanel}
                </div>
              )}
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
        <div className="md:hidden flex flex-col" style={{ height: "50vh" }}>
          <div className="pb-2">
            <PlayerSearch
              particles={state.particles}
              selectedId={selectedId}
              onSelect={handleSelect}
              onSearchDatabase={searchDatabase}
              isSearching={searching}
              offlinePlayerLabel={offlinePlayer?.id ?? null}
              notFound={searchNotFound}
              onClearNotFound={() => setSearchNotFound(false)}
            />
          </div>
          <PanelTabs
            avgPanel={avgPanel}
            totalPanel={totalPanel}
            logPanel={logPanel}
            playerPanel={selectedId != null || isOffline ? playerStatsPanel : undefined}
          />
        </div>
      </div>
      <JoinModal open={showJoinModal} onClose={() => setShowJoinModal(false)} externalCount={externalCount} />
      <HallOfFame open={showHallOfFame} onClose={() => setShowHallOfFame(false)} />
    </main>
  );
}
