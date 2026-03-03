"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { GameLogEntry, StrategyType } from "@/simulation/types";
import type { InitFrame, EventFrame, SlowFrame, ServerFrame } from "@/simulation/protocol";

/** Particle metadata from slow frames, keyed by id. */
export interface ParticleMeta {
  id: number;
  label: string;
  color: string;
  radius: number;
  score: number;
  avgScore: number;
  strategy: StrategyType;
  cc: number;
  cd: number;
  dc: number;
  dd: number;
}

export interface ServerSimulationState {
  particles: ParticleMeta[];
  gameLog: GameLogEntry[];
  tick: number;
  totalCooperations: number;
  totalDefections: number;
}

/** Client-side particle with position + velocity for deterministic movement. */
export interface ClientParticle {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  state: number; // 0=moving, 1=colliding
}

/** Simulation state maintained by the hook, advanced by the canvas rAF. */
export interface SimState {
  particles: ClientParticle[];
  config: { canvasWidth: number; canvasHeight: number };
  localTick: number;
  lastAdvanceTime: number;
}

export interface ClientPopup {
  key: number;
  x: number; y: number; text: string; color: string; spawnTime: number;
}

const POPUP_DURATION_MS = 670;

export function useServerSimulation() {
  const simRef = useRef<SimState>({
    particles: [],
    config: { canvasWidth: 800, canvasHeight: 600 },
    localTick: 0,
    lastAdvanceTime: 0,
  });
  const particleMapRef = useRef<Map<number, ClientParticle>>(new Map());
  const metaRef = useRef<Map<number, ParticleMeta>>(new Map());
  const popupsRef = useRef<ClientPopup[]>([]);
  const popupIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryCount = useRef(0);
  const pausedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState<ServerSimulationState>({
    particles: [],
    gameLog: [],
    tick: 0,
    totalCooperations: 0,
    totalDefections: 0,
  });

  const handleInit = useCallback((frame: InitFrame) => {
    const particles = frame.particles.map((p) => ({
      id: p.id, x: p.x, y: p.y,
      vx: p.vx, vy: p.vy,
      radius: p.radius, state: p.state,
    }));
    simRef.current = {
      particles,
      config: frame.config,
      localTick: frame.tick,
      lastAdvanceTime: performance.now(),
    };
    particleMapRef.current = new Map(particles.map((p) => [p.id, p]));
  }, []);

  const handleEvent = useCallback((frame: EventFrame) => {
    const sim = simRef.current;
    const map = particleMapRef.current;

    for (const ev of frame.events) {
      if (ev.e === "freeze") {
        const a = map.get(ev.a);
        const b = map.get(ev.b);
        if (a) a.state = 1;
        if (b) b.state = 1;
      } else if (ev.e === "unfreeze" || ev.e === "abort") {
        const a = map.get(ev.a);
        const b = map.get(ev.b);
        if (a) { a.x = ev.ax; a.y = ev.ay; a.vx = ev.avx; a.vy = ev.avy; a.state = 0; }
        if (b) { b.x = ev.bx; b.y = ev.by; b.vx = ev.bvx; b.vy = ev.bvy; b.state = 0; }
      } else if (ev.e === "add") {
        const cp: ClientParticle = { id: ev.id, x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy, radius: ev.radius, state: 0 };
        sim.particles.push(cp);
        map.set(ev.id, cp);
      } else if (ev.e === "remove") {
        sim.particles = sim.particles.filter((p) => p.id !== ev.id);
        map.delete(ev.id);
      }
    }

    // Sync tick — only reset the clock when server is meaningfully ahead
    const wasAhead = frame.tick > sim.localTick;
    sim.localTick = frame.tick;
    if (wasAhead) sim.lastAdvanceTime = performance.now();

    // Add popups (dedup by position+text against live popups)
    const now = performance.now();
    if (frame.pop) {
      // Expire old popups first so dedup doesn't match stale entries
      popupsRef.current = popupsRef.current.filter(
        (p) => now - p.spawnTime < POPUP_DURATION_MS,
      );
      for (const [x, y, text, color] of frame.pop) {
        const exists = popupsRef.current.some(
          (p) => p.x === x && p.y === y && p.text === text,
        );
        if (!exists) {
          popupsRef.current.push({ key: ++popupIdRef.current, x, y, text, color, spawnTime: now });
        }
      }
    }
  }, []);

  const handleSlowFrame = useCallback((frame: SlowFrame) => {
    const newMeta = new Map<number, ParticleMeta>();
    for (const p of frame.particles) {
      newMeta.set(p.id, p);
    }
    metaRef.current = newMeta;

    // Drift correction: if local tick drifted >30 ticks from server, snap
    const drift = Math.abs(simRef.current.localTick - frame.tick);
    if (drift > 30) {
      simRef.current.localTick = frame.tick;
      simRef.current.lastAdvanceTime = performance.now();
    }

    setState({
      particles: frame.particles,
      gameLog: frame.gameLog,
      tick: frame.tick,
      totalCooperations: frame.totalC,
      totalDefections: frame.totalD,
    });
  }, []);

  const connect = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryCount.current = 0;
    };

    ws.onmessage = (ev) => {
      const frame: ServerFrame = JSON.parse(ev.data);
      if (frame.type === "init") {
        handleInit(frame);
      } else if (frame.type === "e") {
        handleEvent(frame);
      } else if (frame.type === "s") {
        handleSlowFrame(frame);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      const delay = Math.min(500 * 2 ** retryCount.current, 8000);
      retryCount.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleInit, handleEvent, handleSlowFrame]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      send({ type: next ? "pause" : "resume" });
      // On resume, reset advance time so we don't fast-forward
      if (!next) {
        simRef.current.lastAdvanceTime = performance.now();
      }
      return next;
    });
  }, [send]);

  const reset = useCallback(() => {
    send({ type: "reset" });
    setPaused(false);
    pausedRef.current = false;
  }, [send]);

  return { state, paused, togglePause, reset, simRef, metaRef, popupsRef, pausedRef, connected };
}
