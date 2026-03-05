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
  /** Correction offset from position sync — lerped to zero over several ticks. */
  cx: number; cy: number;
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
  const staticMetaRef = useRef<Map<number, { id: number; label: string; radius: number; strategy: StrategyType }>>(new Map());
  const metaRef = useRef<Map<number, ParticleMeta>>(new Map());
  const gameLogRef = useRef<GameLogEntry[]>([]);
  const popupsRef = useRef<ClientPopup[]>([]);
  const popupIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryCount = useRef(0);
  const [connected, setConnected] = useState(false);
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
      cx: 0, cy: 0,
    }));
    simRef.current = {
      particles,
      config: frame.config,
      localTick: frame.tick,
      lastAdvanceTime: performance.now(),
    };
    particleMapRef.current = new Map(particles.map((p) => [p.id, p]));
    staticMetaRef.current = new Map(frame.meta.map((m) => [m.id, m]));
    gameLogRef.current = [];
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
        const cp: ClientParticle = { id: ev.id, x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy, radius: ev.radius, state: 0, cx: 0, cy: 0 };
        sim.particles.push(cp);
        map.set(ev.id, cp);
        staticMetaRef.current.set(ev.id, { id: ev.id, label: ev.label, radius: ev.radius, strategy: ev.strategy });
      } else if (ev.e === "remove") {
        sim.particles = sim.particles.filter((p) => p.id !== ev.id);
        map.delete(ev.id);
        staticMetaRef.current.delete(ev.id);
      }
    }

    // Sync tick — always reset clock to prevent double-advancing positions
    sim.localTick = frame.tick;
    sim.lastAdvanceTime = performance.now();

    // Apply position sync — set correction offset instead of snapping
    if (frame.pos) {
      for (let i = 0; i < frame.pos.length; i += 5) {
        const p = map.get(frame.pos[i]);
        if (!p) continue;
        const sx = frame.pos[i + 1];
        const sy = frame.pos[i + 2];
        // Correction = where server says minus where client is
        p.cx = sx - p.x;
        p.cy = sy - p.y;
        // Velocity is authoritative — apply immediately
        p.vx = frame.pos[i + 3];
        p.vy = frame.pos[i + 4];
      }
    }

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
    const meta = metaRef.current;
    // Merge delta: update only particles present in this frame
    for (const p of frame.particles) {
      const s = staticMetaRef.current.get(p.id);
      const color = p.hue < 0 ? "hsl(60,50%,45%)" : `hsl(${p.hue},70%,42%)`;
      meta.set(p.id, {
        id: p.id,
        label: s?.label ?? `#${p.id}`,
        radius: s?.radius ?? 5,
        strategy: s?.strategy ?? "random",
        color,
        score: p.score,
        avgScore: p.avgScore,
        cc: p.cc, cd: p.cd, dc: p.dc, dd: p.dd,
      });
    }
    // Remove particles no longer in simulation
    for (const id of meta.keys()) {
      if (!particleMapRef.current.has(id)) meta.delete(id);
    }

    // Accumulate incremental game log entries, dedup by id, keep last 50
    if (frame.gameLog.length > 0) {
      const seen = new Set(gameLogRef.current.map((e) => e.id));
      const fresh = frame.gameLog.filter((e) => !seen.has(e.id));
      if (fresh.length > 0) {
        gameLogRef.current = [...gameLogRef.current, ...fresh].slice(-50);
      }
    }

    // Drift correction: if local tick drifted >30 ticks from server, snap
    const drift = Math.abs(simRef.current.localTick - frame.tick);
    if (drift > 30) {
      simRef.current.localTick = frame.tick;
      simRef.current.lastAdvanceTime = performance.now();
    }

    setState({
      particles: Array.from(meta.values()),
      gameLog: gameLogRef.current,
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

  return { state, simRef, metaRef, popupsRef, connected };
}
