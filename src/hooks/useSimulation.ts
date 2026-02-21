"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { SimulationEngine } from "@/simulation/engine";
import { SimulationConfig, DEFAULT_CONFIG, Particle, MatchRecord } from "@/simulation/types";
import { generateMessage } from "@/simulation/messages";

export interface SimulationState {
  particles: Particle[];
  matchHistory: MatchRecord[];
  tick: number;
  totalCooperations: number;
  totalDefections: number;
}

export function useSimulation(config: SimulationConfig = DEFAULT_CONFIG) {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) {
    const engine = new SimulationEngine(config);
    engine.onRequestLLMMessage = (side, self, opponent) => {
      const record = self.matchHistory[opponent.id];
      const priorInteractions = record
        ? { cc: record.cc, cd: record.cd, dc: record.dc, dd: record.dd }
        : null;

      fetch("/api/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: self.strategy,
          selfLabel: self.label,
          opponentLabel: opponent.label,
          priorInteractions,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`API ${res.status}`);
          return res.json();
        })
        .then((data: { message: string }) => {
          const text = data.message || generateMessage(self, opponent);
          engine.resolveMessage(
            side === "a" ? self.id : opponent.id,
            side === "a" ? opponent.id : self.id,
            side,
            text,
          );
        })
        .catch((err) => {
          console.error("LLM message generation failed:", err);
          const text = generateMessage(self, opponent);
          engine.resolveMessage(
            side === "a" ? self.id : opponent.id,
            side === "a" ? opponent.id : self.id,
            side,
            text,
          );
        });
    };
    engineRef.current = engine;
  }
  const rafRef = useRef<number>(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [state, setState] = useState<SimulationState>({
    particles: engineRef.current.particles,
    matchHistory: [],
    tick: 0,
    totalCooperations: 0,
    totalDefections: 0,
  });

  // Throttle React state updates to ~20fps
  const lastUpdateRef = useRef(0);

  const loop = useCallback(() => {
    if (!pausedRef.current) {
      engineRef.current!.step();

      const now = performance.now();
      if (now - lastUpdateRef.current > 50) {
        lastUpdateRef.current = now;
        const engine = engineRef.current!;
        setState({
          particles: engine.particles.map((p) => ({ ...p, position: { ...p.position }, velocity: { ...p.velocity } })),
          matchHistory: engine.matchHistory.slice(-50),
          tick: engine.tick,
          totalCooperations: engine.totalCooperations,
          totalDefections: engine.totalDefections,
        });
      }
    }

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      pausedRef.current = !prev;
      return !prev;
    });
  }, []);

  const reset = useCallback(() => {
    engineRef.current!.reset();
    setState({
      particles: engineRef.current!.particles.map((p) => ({ ...p, position: { ...p.position }, velocity: { ...p.velocity } })),
      matchHistory: [],
      tick: 0,
      totalCooperations: 0,
      totalDefections: 0,
    });
  }, []);

  return { state, paused, togglePause, reset, engineRef };
}
