"use client";

import { DEFAULT_CONFIG } from "@/simulation/types";
import { useSimulation } from "@/hooks/useSimulation";
import SimulationCanvas from "@/components/SimulationCanvas";
import ScoreBoard from "@/components/ScoreBoard";
import MatchHistoryPanel from "@/components/MatchHistoryPanel";

export default function Home() {
  const { state, paused, togglePause, reset, engineRef } = useSimulation(DEFAULT_CONFIG);

  return (
    <main className="min-h-screen p-6 flex flex-col items-center gap-4">
      <h1 className="text-2xl font-bold tracking-tight text-slate-100">
        ClawSoc <span className="text-slate-500 font-normal">-- Society of LLMs</span>
      </h1>

      <div className="flex gap-4">
        {/* Left: Simulation */}
        <div className="flex flex-col gap-3">
          <SimulationCanvas engineRef={engineRef} config={DEFAULT_CONFIG} />

          <div className="flex items-center gap-3">
            <button
              onClick={togglePause}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={reset}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
            >
              Reset
            </button>
            <span className="text-xs text-slate-500 ml-auto font-mono">
              tick {state.tick}
            </span>
          </div>
        </div>

        {/* Right: Panel */}
        <div className="w-64 flex flex-col gap-3">
          <ScoreBoard particles={state.particles} />
          <MatchHistoryPanel matches={state.matchHistory} />
        </div>
      </div>
    </main>
  );
}
