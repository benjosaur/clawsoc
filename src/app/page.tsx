"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { DEFAULT_CONFIG } from "@/simulation/types";
import type { GameLogEntry, StrategyType } from "@/simulation/types";
import { useServerSimulation } from "@/hooks/useServerSimulation";
import SimulationCanvas, { WORLD_PAD } from "@/components/SimulationCanvas";
import ScoreBoard from "@/components/ScoreBoard";
import MatchHistoryPanel from "@/components/MatchHistoryPanel";
import PlayerSearch from "@/components/PlayerSearch";
import PanelTabs from "@/components/PanelTabs";
import PlayerStats from "@/components/PlayerStats";
import JoinModal from "@/components/JoinModal";
import HallOfFame from "@/components/HallOfFame";
import JoinToast from "@/components/JoinToast";

export default function Home() {
  const { state, simRef, metaRef, popupsRef, joinEventsRef, connected } =
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
  const [starCount, setStarCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://api.github.com/repos/benjosaur/clawsoc")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.stargazers_count != null) setStarCount(d.stargazers_count); })
      .catch(() => {});
  }, []);
  const selectionChangedRef = useRef(false);

  const handleSelect = useCallback((id: string | null) => {
    if (id !== null) selectionChangedRef.current = true;
    setSelectedId(id);
    if (id !== null) { setOfflinePlayer(null); setSearchNotFound(false); }
  }, []);

  // Click anywhere outside selection-interactive zones to deselect
  useEffect(() => {
    function handleGlobalClick(e: MouseEvent) {
      if (selectionChangedRef.current) {
        selectionChangedRef.current = false;
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest('[data-no-deselect]')) return;
      setSelectedId(null);
      setOfflinePlayer(null);
      setSearchNotFound(false);
    }
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
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
        Math.round(w * (DEFAULT_CONFIG.canvasHeight / DEFAULT_CONFIG.canvasWidth)),
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
  const scorePanel = <ScoreBoard particles={state.particles} selectedId={selectedId} singleRow={hasSelection} onSelect={handleSelect} />;
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
      <header className="relative z-10 w-full max-w-screen-2xl flex items-center justify-between">
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
          <a
            href="https://github.com/benjosaur/clawsoc"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-0.5 md:px-2.5 md:py-1 border border-zinc-200 bg-white hover:bg-zinc-50 rounded text-[11px] md:text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 md:w-4 md:h-4 fill-current" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {starCount !== null && (
              <>
                <span className="text-zinc-300">★</span>
                <span className="font-medium">{starCount}</span>
              </>
            )}
          </a>
          <span className="hof-rainbow">
            <button
              onClick={() => setShowHallOfFame(true)}
              className="px-2 py-0.5 md:px-4 md:py-1.5 bg-[#fef7d9] hover:bg-amber-50 text-[11px] md:text-sm font-medium text-amber-700"
            >
              Hall of Fame
            </button>
          </span>
          <button
            onClick={() => setShowJoinModal(true)}
            className="px-2 py-0.5 md:px-4 md:py-1.5 border border-emerald-300 bg-[#d8f5e3] hover:bg-emerald-50 rounded text-[11px] md:text-sm font-medium text-emerald-700"
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

          <div className="relative z-10 shadow-[0_0_16px_8px_rgba(255,255,255,0.3)] flex items-start justify-center gap-2 text-[8px] md:text-[11px] font-mono">
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
          className="relative z-10 bg-[#fafafa] shadow-[0_0_16px_8px_#fafafa] hidden md:flex min-w-72 lg:min-w-80 xl:min-w-96 flex-col gap-1"
          style={{ flex: "1 0 0%", height: canvasHeight }}
        >
          <div className="flex-shrink-0 pb-1" data-no-deselect>
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
              {!isOffline && (
                <div className="flex-shrink-0 flex flex-col">{scorePanel}</div>
              )}
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
              <div className="flex-1 min-h-0 flex flex-col">{scorePanel}</div>
              <div className="flex-1 min-h-0 flex flex-col border-t border-zinc-100 pt-1">
                {logPanel}
              </div>
            </>
          )}
        </div>

        {/* Mobile tabs */}
        <div className="relative z-10 bg-[#fafafa] shadow-[0_0_24px_16px_#fafafa] md:hidden flex flex-col" style={{ height: "50vh" }}>
          <div className="pb-2" data-no-deselect>
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
            scorePanel={scorePanel}
            logPanel={logPanel}
            playerPanel={selectedId != null || isOffline ? playerStatsPanel : undefined}
          />
        </div>
      </div>
      <JoinToast joinEventsRef={joinEventsRef} onSelect={handleSelect} />
      <div data-no-deselect>
        <JoinModal open={showJoinModal} onClose={() => setShowJoinModal(false)} externalCount={externalCount} />
        <HallOfFame
          open={showHallOfFame}
          onClose={() => setShowHallOfFame(false)}
          onSelectPlayer={(label, isLive) => {
            if (isLive) {
              handleSelect(label);
            } else {
              searchDatabase(label);
            }
          }}
        />
      </div>
    </main>
  );
}
