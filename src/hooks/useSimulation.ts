"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { SimulationEngine } from "@/simulation/engine";
import { SimulationConfig, DEFAULT_CONFIG, Particle, GameLogEntry } from "@/simulation/types";
import { generateMessage } from "@/simulation/messages";

export interface SimulationState {
  particles: Particle[];
  gameLog: GameLogEntry[];
  tick: number;
  totalCooperations: number;
  totalDefections: number;
}

export function useSimulation(config: SimulationConfig = DEFAULT_CONFIG) {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) {
    const engine = new SimulationEngine(config);
    engine.onRequestLLMMessage = (side, self, opponent) => {
      // Client-only fallback: use template messages (no API route)
      const text = generateMessage(self, opponent);
      engine.resolveMessage(
        side === "a" ? self.id : opponent.id,
        side === "a" ? opponent.id : self.id,
        side,
        text,
      );
    };
    engineRef.current = engine;
  }
  const rafRef = useRef<number>(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [state, setState] = useState<SimulationState>({
    particles: engineRef.current.particles,
    gameLog: [],
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
          gameLog: engine.gameLog.slice(-50),
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
      gameLog: [],
      tick: 0,
      totalCooperations: 0,
      totalDefections: 0,
    });
  }, []);

  return { state, paused, togglePause, reset, engineRef };
}
