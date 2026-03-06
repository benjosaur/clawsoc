import type { GameLogEntry, StrategyType } from "./types";

// --- Simulation events (shared between server emit and client apply) ---

export type SimEvent =
  | {
      e: "freeze";
      a: number; b: number;
      ax: number; ay: number; avx: number; avy: number;
      bx: number; by: number; bvx: number; bvy: number;
    }
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
  | { e: "add"; id: number; x: number; y: number; vx: number; vy: number; radius: number; label: string; strategy: StrategyType }
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
  meta: { id: number; label: string; radius: number; strategy: StrategyType }[];
}

/** Sent when simulation events occur (collisions, unfreezes). */
export interface EventFrame {
  type: "e";
  tick: number;
  events: SimEvent[];
  pop?: [number, number, string, string][]; // [x, y, text, color]
  pos?: number[]; // flat [id, x, y, vx, vy, ...] position sync for all moving particles
}

/** Server → Client: dynamic metadata + new game log entries, every ~3s. */
export interface SlowFrame {
  type: "s";
  tick: number;
  particles: {
    id: number;
    hue: number;
    score: number;
    avgScore: number;
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
