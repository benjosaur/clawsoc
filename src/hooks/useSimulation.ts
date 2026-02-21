"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { SimulationEngine } from "@/simulation/engine";
import { SimulationConfig, DEFAULT_CONFIG, Particle, MatchRecord } from "@/simulation/types";

export interface SimulationState {
  particles: Particle[];
  matchHistory: MatchRecord[];
  tick: number;
}

export function useSimulation(config: SimulationConfig = DEFAULT_CONFIG) {
  const engineRef = useRef<SimulationEngine>(new SimulationEngine(config));
  const rafRef = useRef<number>(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [state, setState] = useState<SimulationState>({
    particles: engineRef.current.particles,
    matchHistory: [],
    tick: 0,
  });

  // Throttle React state updates to ~20fps
  const lastUpdateRef = useRef(0);

  const loop = useCallback(() => {
    if (!pausedRef.current) {
      engineRef.current.step();

      const now = performance.now();
      if (now - lastUpdateRef.current > 50) {
        lastUpdateRef.current = now;
        const engine = engineRef.current;
        setState({
          particles: engine.particles.map((p) => ({ ...p, position: { ...p.position }, velocity: { ...p.velocity } })),
          matchHistory: engine.matchHistory.slice(-50),
          tick: engine.tick,
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
    engineRef.current.reset();
    setState({
      particles: engineRef.current.particles.map((p) => ({ ...p, position: { ...p.position }, velocity: { ...p.velocity } })),
      matchHistory: [],
      tick: 0,
    });
  }, []);

  return { state, paused, togglePause, reset, engineRef };
}
