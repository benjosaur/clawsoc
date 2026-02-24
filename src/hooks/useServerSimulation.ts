"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { GameLogEntry, StrategyType } from "@/simulation/types";
import type { CanvasView, FastFrame, SlowFrame, ServerFrame } from "@/simulation/protocol";

/** Particle metadata from slow frames, keyed by id. */
interface ParticleMeta {
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

/** Previous + current positions for client-side interpolation. */
export interface InterpState {
  prev: CanvasView | null;
  curr: CanvasView | null;
  frameTime: number; // performance.now() when curr arrived
}

const POPUP_DURATION_MS = 670; // ~40 ticks at 60 ticks/sec
let popupIdCounter = 0;

interface ClientPopup {
  key: number;
  x: number; y: number; text: string; color: string; spawnTime: number;
}

export function useServerSimulation() {
  const viewRef = useRef<CanvasView | null>(null);
  const interpRef = useRef<InterpState>({ prev: null, curr: null, frameTime: 0 });
  const metaRef = useRef<Map<number, ParticleMeta>>(new Map());
  const popupsRef = useRef<ClientPopup[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryCount = useRef(0);

  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState<ServerSimulationState>({
    particles: [],
    gameLog: [],
    tick: 0,
    totalCooperations: 0,
    totalDefections: 0,
  });

  const handleFastFrame = useCallback((frame: FastFrame) => {
    const now = performance.now();
    const meta = metaRef.current;
    const particles = frame.p.map(([id, x, y, st]) => {
      const m = meta.get(id);
      return {
        id,
        x,
        y,
        state: st,
        color: m?.color ?? "#888",
        radius: m?.radius ?? 10,
        label: m?.label ?? "",
        avgScore: m?.avgScore ?? 0,
      };
    });

    // Expire old popups
    popupsRef.current = popupsRef.current.filter(
      (p) => now - p.spawnTime < POPUP_DURATION_MS,
    );

    // Add popups from server, dedup by position+text against live popups
    if (frame.pop) {
      for (const [x, y, text, color] of frame.pop) {
        const exists = popupsRef.current.some(
          (p) => p.x === x && p.y === y && p.text === text,
        );
        if (!exists) {
          popupsRef.current.push({ key: ++popupIdCounter, x, y, text, color, spawnTime: now });
        }
      }
    }

    const newView: CanvasView = {
      particles,
      popups: popupsRef.current.map((p) => ({ ...p })),
      tick: frame.t,
    };

    // Rotate for interpolation
    const interp = interpRef.current;
    interp.prev = interp.curr;
    interp.curr = newView;
    interp.frameTime = now;

    viewRef.current = newView;
  }, []);

  const handleSlowFrame = useCallback((frame: SlowFrame) => {
    const newMeta = new Map<number, ParticleMeta>();
    for (const p of frame.particles) {
      newMeta.set(p.id, p);
    }
    metaRef.current = newMeta;

    setState({
      particles: frame.particles,
      gameLog: frame.gameLog,
      tick: viewRef.current?.tick ?? 0,
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
      if (frame.type === "f") {
        handleFastFrame(frame);
      } else if (frame.type === "s") {
        handleSlowFrame(frame);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Exponential backoff: 500ms, 1s, 2s, 4s, capped at 8s
      const delay = Math.min(500 * 2 ** retryCount.current, 8000);
      retryCount.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleFastFrame, handleSlowFrame]);

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
      send({ type: prev ? "resume" : "pause" });
      return !prev;
    });
  }, [send]);

  const reset = useCallback(() => {
    send({ type: "reset" });
    setPaused(false);
  }, [send]);

  return { state, paused, togglePause, reset, viewRef, interpRef, connected };
}
