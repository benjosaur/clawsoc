import type { GameLogEntry, StrategyType } from "./types";

// --- Simulation events (shared between server emit and client apply) ---

export type SimEvent =
  | {
      e: "freeze"; tick: number;
      a: string; b: string;
      ax: number; ay: number; avx: number; avy: number;
      bx: number; by: number; bvx: number; bvy: number;
    }
  | {
      e: "unfreeze"; tick: number;
      a: string; b: string;
      ax: number; ay: number; avx: number; avy: number;
      bx: number; by: number; bvx: number; bvy: number;
    }
  | {
      e: "abort"; tick: number;
      a: string; b: string;
      ax: number; ay: number; avx: number; avy: number;
      bx: number; by: number; bvx: number; bvy: number;
    }
  | { e: "add"; id: string; x: number; y: number; vx: number; vy: number; radius: number; strategy: StrategyType }
  | { e: "remove"; id: string }
  | { e: "park"; id: string }
  | { e: "unpark"; id: string; x: number; y: number; vx: number; vy: number }
  | {
      e: "turn"; tick: number;
      a: string; b: string;
      speaker: "a" | "b";
      turnType: "message" | "decision";
      content: string;
    };

// --- Server → Client frames ---

/** Sent on connect and on reset: full simulation snapshot. */
export interface InitFrame {
  type: "init";
  tick: number;
  config: { canvasWidth: number; canvasHeight: number };
  particles: {
    id: string;
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
    state: number; // 0=moving, 1=colliding, 3=parked
  }[];
  meta: { id: string; radius: number; strategy: StrategyType }[];
}

/** Sent when simulation events occur (collisions, unfreezes). */
export interface EventFrame {
  type: "e";
  tick: number;
  events: SimEvent[];
  pop?: [number, number, string, string][]; // [x, y, text, color]
  pos?: { id: string; x: number; y: number; vx: number; vy: number }[];
  pmu?: [string, number, number, number, number, number][]; // [id, hue, avgScore, score, r30Total, r30Avg]
  log?: GameLogEntry[];
}

/** Server → Client: safety-net metadata fallback, every ~30s. */
export interface SlowFrame {
  type: "s";
  tick: number;
  particles: {
    id: string;
    hue: number;
    score: number;
    avgScore: number;
    cc: number;
    cd: number;
    dc: number;
    dd: number;
    r30Total: number;
    r30Avg: number;
  }[];
  totalC: number;
  totalD: number;
}

export type ServerFrame = InitFrame | EventFrame | SlowFrame;
