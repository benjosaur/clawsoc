"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { ConversationTurn, Decision, GameLogEntry, MatchRecord, StrategyType } from "@/simulation/types";
import type { InitFrame, EventFrame, SlowFrame, ServerFrame, WireGameLogEntry } from "@/simulation/protocol";

/** Particle metadata from slow frames, keyed by id. */
export interface ParticleMeta {
  id: string;
  color: string;
  score: number;
  avgScore: number;
  r30Total: number;
  r30Avg: number;
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
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  state: number; // 0=moving, 1=colliding, 2=approaching, 3=parked
  /** Correction offset from position sync — lerped to zero over several ticks. */
  cx: number; cy: number;
  /** Approach target (collision point) — used when state=2. */
  tx: number; ty: number;
  /** Server entry velocity (approach direction) — used when state=2. */
  tvx: number; tvy: number;
  /** Local tick at which approach ends and state transitions to 1. */
  freezeAt: number;
}

/** Simulation state maintained by the hook, advanced by the canvas rAF. */
export interface SimState {
  particles: ClientParticle[];
  config: { canvasWidth: number; canvasHeight: number; particleRadius: number };
  localTick: number;
  lastAdvanceTime: number;
}

export interface ClientPopup {
  key: number;
  x: number; y: number; text: string; color: string; spawnTime: number;
}

export interface JoinEvent {
  id: string;
  time: number;
}

const POPUP_DURATION_MS = 670;

/** Derive popup color from score text: +0/+3 = cooperated (green), +1/+5 = defected (red). */
function popupColor(text: string): string {
  const n = parseInt(text.replace("+", ""), 10);
  return n === 0 || n === 3 ? "#16a34a" : "#dc2626";
}

/** Expand compact wire conversation [speaker, value, speaker, value, ...] back to ConversationTurn[]. */
function expandConversation(compact: (string | number)[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < compact.length; i += 2) {
    const speaker = compact[i] as "a" | "b";
    const val = compact[i + 1];
    if (typeof val === "string") {
      turns.push({ speaker, type: "message", content: val });
    } else {
      const decision: Decision = val === 0 ? "cooperate" : "defect";
      turns.push({ speaker, type: "decision", content: "", decision });
    }
  }
  return turns;
}

/** Expand a compact wire game log entry to the full MatchRecord. */
function expandWireEntry(wire: WireGameLogEntry, staticMeta: Map<string, { id: string; strategy: StrategyType }>): GameLogEntry {
  const conversation = expandConversation(wire.conversation);
  const firstA = conversation.find((t) => t.speaker === "a" && t.type === "message");
  const firstB = conversation.find((t) => t.speaker === "b" && t.type === "message");
  return {
    type: "match",
    id: wire.id,
    tick: 0,
    particleA: { id: wire.particleA, strategy: staticMeta.get(wire.particleA)?.strategy ?? "random" },
    particleB: { id: wire.particleB, strategy: staticMeta.get(wire.particleB)?.strategy ?? "random" },
    decisionA: wire.decisionA,
    decisionB: wire.decisionB,
    scoreA: wire.scoreA,
    scoreB: wire.scoreB,
    conversation,
    messageA: firstA?.content,
    messageB: firstB?.content,
    timestamp: 0,
  } satisfies MatchRecord;
}

export function useServerSimulation() {
  const simRef = useRef<SimState>({
    particles: [],
    config: { canvasWidth: 800, canvasHeight: 600, particleRadius: 5 },
    localTick: 0,
    lastAdvanceTime: 0,
  });
  const particleMapRef = useRef<Map<string, ClientParticle>>(new Map());
  const staticMetaRef = useRef<Map<string, { id: string; strategy: StrategyType }>>(new Map());
  const metaRef = useRef<Map<string, ParticleMeta>>(new Map());
  const gameLogRef = useRef<GameLogEntry[]>([]);
  const popupsRef = useRef<ClientPopup[]>([]);
  const popupIdRef = useRef(0);
  const joinEventsRef = useRef<JoinEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryCount = useRef(0);
  const lastMessageRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<ServerSimulationState>({
    particles: [],
    gameLog: [],
    tick: 0,
    totalCooperations: 0,
    totalDefections: 0,
  });

  const handleInit = useCallback((frame: InitFrame) => {
    const radius = frame.config.particleRadius;
    const particles = frame.particles.map((p) => ({
      id: p.id, x: p.x, y: p.y,
      vx: p.vx, vy: p.vy,
      radius, state: p.state,
      cx: 0, cy: 0,
      tx: 0, ty: 0, tvx: 0, tvy: 0, freezeAt: 0,
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
    joinEventsRef.current = [];
  }, []);

  const handleEvent = useCallback((frame: EventFrame) => {
    const sim = simRef.current;
    const map = particleMapRef.current;

    let metaChanged = false;
    for (const ev of frame.events) {
      if (ev.e === "freeze") {
        const a = map.get(ev.a);
        const b = map.get(ev.b);
        const APPROACH_TICKS = 12;
        // Rewind: the collision happened at ev.tick, but the client kept
        // advancing the particle. Undo the extra ticks so the approach
        // animation starts from where the particle visually was at collision time.
        const rewind = Math.max(0, sim.localTick - ev.tick);
        if (a) {
          a.x -= a.vx * rewind;
          a.y -= a.vy * rewind;
          a.tx = ev.ax; a.ty = ev.ay;
          a.tvx = ev.avx; a.tvy = ev.avy;
          a.freezeAt = sim.localTick + APPROACH_TICKS;
          a.cx = 0; a.cy = 0;
          a.state = 2;
        }
        if (b) {
          b.x -= b.vx * rewind;
          b.y -= b.vy * rewind;
          b.tx = ev.bx; b.ty = ev.by;
          b.tvx = ev.bvx; b.tvy = ev.bvy;
          b.freezeAt = sim.localTick + APPROACH_TICKS;
          b.cx = 0; b.cy = 0;
          b.state = 2;
        }
      } else if (ev.e === "unfreeze" || ev.e === "abort") {
        const a = map.get(ev.a);
        const b = map.get(ev.b);
        // Fast-forward: the server already advanced the particle for the
        // remaining batch steps after unfreezing. Compensate so the client
        // starts from the server's current position.
        const ff = Math.max(0, frame.tick - ev.tick);
        if (a) { a.x = ev.ax + ev.avx * ff; a.y = ev.ay + ev.avy * ff; a.vx = ev.avx; a.vy = ev.avy; a.state = 0; }
        if (b) { b.x = ev.bx + ev.bvx * ff; b.y = ev.by + ev.bvy * ff; b.vx = ev.bvx; b.vy = ev.bvy; b.state = 0; }
      } else if (ev.e === "add") {
        const radius = sim.config.particleRadius;
        const cp: ClientParticle = { id: ev.id, x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy, radius, state: 0, cx: 0, cy: 0, tx: 0, ty: 0, tvx: 0, tvy: 0, freezeAt: 0 };
        sim.particles.push(cp);
        map.set(ev.id, cp);
        staticMetaRef.current.set(ev.id, { id: ev.id, strategy: ev.strategy });
        const hue = ev.hue;
        metaRef.current.set(ev.id, {
          id: ev.id, strategy: ev.strategy,
          color: hue < 0 ? "hsl(60,50%,45%)" : `hsl(${hue},70%,42%)`,
          score: ev.score, avgScore: ev.avgScore,
          r30Total: ev.r30Total, r30Avg: ev.r30Avg,
          cc: ev.cc, cd: ev.cd, dc: ev.dc, dd: ev.dd,
        });
        metaChanged = true;
        if (ev.strategy === "external") {
          joinEventsRef.current.push({ id: ev.id, time: performance.now() });
        }
      } else if (ev.e === "park") {
        const p = map.get(ev.id);
        if (p) { p.state = 3; p.vx = 0; p.vy = 0; }
      } else if (ev.e === "unpark") {
        const p = map.get(ev.id);
        if (p) { p.x = ev.x; p.y = ev.y; p.vx = ev.vx; p.vy = ev.vy; p.state = 0; }
      } else if (ev.e === "remove") {
        sim.particles = sim.particles.filter((p) => p.id !== ev.id);
        map.delete(ev.id);
        staticMetaRef.current.delete(ev.id);
        metaRef.current.delete(ev.id);
        metaChanged = true;
      }
    }

    // Only hard-reset on catastrophic drift (reconnect, tab backgrounded).
    // Do NOT reset every frame — that discards ~10-20ms of accumulated time
    // (network latency) causing the client to step 5 ticks per 100ms instead of 6.
    if (Math.abs(sim.localTick - frame.tick) > 30) {
      sim.localTick = frame.tick;
      sim.lastAdvanceTime = performance.now();
    }

    // Apply position sync — set correction offset instead of snapping
    if (frame.pos) {
      for (const entry of frame.pos) {
        const p = map.get(entry.id);
        if (!p) continue;
        // Correction = where server says minus where client is
        p.cx = entry.x - p.x;
        p.cy = entry.y - p.y;
        // Velocity is authoritative — apply immediately
        p.vx = entry.vx;
        p.vy = entry.vy;
      }
    }

    // Add popups — derive color from score text
    const now = performance.now();
    if (frame.pop) {
      // Expire old popups first so dedup doesn't match stale entries
      popupsRef.current = popupsRef.current.filter(
        (p) => now - p.spawnTime < POPUP_DURATION_MS,
      );
      for (const [x, y, text] of frame.pop) {
        const exists = popupsRef.current.some(
          (p) => p.x === x && p.y === y && p.text === text,
        );
        if (!exists) {
          popupsRef.current.push({ key: ++popupIdRef.current, x, y, text, color: popupColor(text), spawnTime: now });
        }
      }
    }

    // Apply inline meta updates (score/color sync with popups)
    if (frame.pmu) {
      const meta = metaRef.current;
      for (const [id, hue, avgScore, score, r30Total = 0, r30Avg = 0] of frame.pmu) {
        const existing = meta.get(id);
        if (existing) {
          existing.color = hue < 0 ? "hsl(60,50%,45%)" : `hsl(${hue},70%,42%)`;
          existing.avgScore = avgScore;
          existing.score = score;
          existing.r30Total = r30Total;
          existing.r30Avg = r30Avg;
        }
      }
      // Re-render if no game log entries will trigger setState
      if (!frame.log || frame.log.length === 0) {
        setState((prev) => ({ ...prev, particles: Array.from(meta.values()) }));
      }
    }

    // Process game log entries + derive outcome matrix client-side
    if (frame.log && frame.log.length > 0) {
      const meta = metaRef.current;
      const expanded = frame.log.map((w) => expandWireEntry(w, staticMetaRef.current));
      const seen = new Set(gameLogRef.current.map((e) => e.id));
      const fresh = expanded.filter((e) => !seen.has(e.id));
      if (fresh.length > 0) {
        gameLogRef.current = [...gameLogRef.current, ...fresh].slice(-50);
        // Update cc/cd/dc/dd from match results
        for (const entry of fresh) {
          if (entry.type !== "match") continue;
          const metaA = meta.get(entry.particleA.id);
          if (metaA) {
            const key = (entry.decisionA === "cooperate" ? "c" : "d") + (entry.decisionB === "cooperate" ? "c" : "d") as "cc" | "cd" | "dc" | "dd";
            metaA[key]++;
          }
          const metaB = meta.get(entry.particleB.id);
          if (metaB) {
            const key = (entry.decisionB === "cooperate" ? "c" : "d") + (entry.decisionA === "cooperate" ? "c" : "d") as "cc" | "cd" | "dc" | "dd";
            metaB[key]++;
          }
        }
        setState((prev) => ({
          ...prev,
          particles: Array.from(meta.values()),
          gameLog: gameLogRef.current,
        }));
      }
    }

    // Re-render for add/remove if no pmu/log already triggered setState
    if (metaChanged && !frame.pmu && (!frame.log || frame.log.length === 0)) {
      setState((prev) => ({ ...prev, particles: Array.from(metaRef.current.values()) }));
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
        strategy: s?.strategy ?? "random",
        color,
        score: p.score,
        avgScore: p.avgScore,
        r30Total: p.r30Total ?? 0,
        r30Avg: p.r30Avg ?? 0,
        cc: p.cc, cd: p.cd, dc: p.dc, dd: p.dd,
      });
    }
    // Remove particles no longer in simulation
    for (const id of meta.keys()) {
      if (!particleMapRef.current.has(id)) meta.delete(id);
    }

    // Drift correction: if local tick drifted >30 ticks from server, snap
    const drift = Math.abs(simRef.current.localTick - frame.tick);
    if (drift > 30) {
      simRef.current.localTick = frame.tick;
      simRef.current.lastAdvanceTime = performance.now();
    }

    setState((prev) => ({
      ...prev,
      particles: Array.from(meta.values()),
      tick: frame.tick,
      totalCooperations: frame.totalC,
      totalDefections: frame.totalD,
    }));
  }, []);

  const connect = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryCount.current = 0;
      lastMessageRef.current = Date.now();
    };

    ws.onmessage = (ev) => {
      lastMessageRef.current = Date.now();
      const frame: ServerFrame = JSON.parse(ev.data);
      if (frame.type === "init") {
        handleInit(frame);
      } else if (frame.type === "e") {
        handleEvent(frame);
      } else if (frame.type === "s") {
        handleSlowFrame(frame);
      }
    };

    // Idle check: reconnect if server goes silent for 8s
    const idleCheck = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && Date.now() - lastMessageRef.current > 8_000) {
        clearInterval(idleCheck);
        ws.close();
      }
    }, 2_000);

    ws.onclose = () => {
      clearInterval(idleCheck);
      setConnected(false);
      wsRef.current = null;
      const delay = retryCount.current === 0 ? 0 : Math.min(500 * 2 ** (retryCount.current - 1), 8000);
      retryCount.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleInit, handleEvent, handleSlowFrame]);

  useEffect(() => {
    connect();

    const handleVisibility = () => {
      if (document.hidden) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageRef.current > 3_000) {
        ws.close(); // triggers onclose → reconnect
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { state, simRef, metaRef, popupsRef, joinEventsRef, connected };
}
