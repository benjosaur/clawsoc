import type { GameLogEntry, StrategyType } from "./types";

// --- Simulation events (shared between server emit and client apply) ---

export type SimEvent =
  | { e: "freeze"; a: number; b: number }
  | {
      e: "unfreeze";
      a: number; b: number;
      ax: number; ay: number; avx: number; avy: number;
      bx: number; by: number; bvx: number; bvy: number;
    }
  | {
      e: "abort";
      a: number; b: number;
      ax: number; ay: number; avx: number; avy: number;
      bx: number; by: number; bvx: number; bvy: number;
    }
  | { e: "add"; id: number; x: number; y: number; vx: number; vy: number; radius: number }
  | { e: "remove"; id: number };

// --- Server → Client frames ---

/** Sent on connect and on reset: full simulation snapshot. */
export interface InitFrame {
  type: "init";
  tick: number;
  config: { canvasWidth: number; canvasHeight: number };
  particles: {
    id: number;
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
    state: number; // 0=moving, 1=colliding
  }[];
}

/** Sent when simulation events occur (collisions, unfreezes). */
export interface EventFrame {
  type: "e";
  tick: number;
  events: SimEvent[];
  pop?: [number, number, string, string][]; // [x, y, text, color]
}

/** Server → Client: metadata + game log at 1fps. */
export interface SlowFrame {
  type: "s";
  tick: number;
  particles: {
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
  }[];
  gameLog: GameLogEntry[];
  totalC: number;
  totalD: number;
}

export type ServerFrame = InitFrame | EventFrame | SlowFrame;

/** Client → Server: control commands. */
export type ClientMessage =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };
