"use client";

import { DEFAULT_CONFIG } from "@/simulation/types";
import { useServerSimulation } from "@/hooks/useServerSimulation";
import SimulationCanvas from "@/components/SimulationCanvas";
import ScoreBoard from "@/components/ScoreBoard";
import TotalScoreBoard from "@/components/TotalScoreBoard";
import MatchHistoryPanel from "@/components/MatchHistoryPanel";

export default function Home() {
  const { state, paused, togglePause, reset, viewRef, interpRef, connected } = useServerSimulation();
  const total = state.totalCooperations + state.totalDefections;
  const coopPct = total > 0 ? Math.round((state.totalCooperations / total) * 100) : 0;

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-5">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          ClawSoc
        </h1>
        <span className="text-sm text-zinc-400 font-normal tracking-wide">
          Society of LLMs
        </span>
      </div>

      <div className="flex gap-5">
        <div className="flex flex-col gap-3">
          <SimulationCanvas viewRef={viewRef} interpRef={interpRef} config={DEFAULT_CONFIG} />

          <div className="flex items-center gap-2">
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
              <span className="text-[10px] text-amber-500 font-mono">reconnecting...</span>
            )}
            <div className="ml-auto flex items-center gap-3 text-[11px] font-mono">
              <span className="text-emerald-600">{state.totalCooperations}C</span>
              <span className="text-red-500">{state.totalDefections}D</span>
              {total > 0 && (
                <span className="text-zinc-400">{coopPct}% coop</span>
              )}
              <span className="text-zinc-300">t={state.tick}</span>
            </div>
          </div>
        </div>

        <div className="w-56 flex flex-col gap-4">
          <ScoreBoard particles={state.particles} />
          <TotalScoreBoard particles={state.particles} />
          <MatchHistoryPanel entries={state.gameLog} />
        </div>
      </div>
    </main>
  );
}
