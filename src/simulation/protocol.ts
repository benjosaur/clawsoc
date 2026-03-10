import type { Decision, StrategyType } from "./types";

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
  | { e: "add"; id: string; x: number; y: number; vx: number; vy: number; strategy: StrategyType;
      score: number; hue: number; avgScore: number; r30Total: number; r30Avg: number;
      cc: number; cd: number; dc: number; dd: number }
  | { e: "remove"; id: string }
  | { e: "park"; id: string }
  | { e: "unpark"; id: string; x: number; y: number; vx: number; vy: number };

// --- Server → Client frames ---

/** Sent on connect and on reset: full simulation snapshot. */
export interface InitFrame {
  type: "init";
  tick: number;
  config: { canvasWidth: number; canvasHeight: number; particleRadius: number };
  particles: {
    id: string;
    x: number; y: number;
    vx: number; vy: number;
    state: number; // 0=moving, 1=colliding, 3=parked
  }[];
  meta: { id: string; strategy: StrategyType }[];
}

/** Compact wire format for game log entries. */
export interface WireMatchRecord {
  type: "match";
  id: string;
  particleA: { id: string; strategy: StrategyType };
  particleB: { id: string; strategy: StrategyType };
  decisionA: Decision;
  decisionB: Decision;
  scoreA: number;
  scoreB: number;
  /** Compact conversation: [speaker, value, speaker, value, ...]. Strings = messages, 0 = cooperate, 1 = defect. */
  conversation: (string | number)[];
}

export type WireGameLogEntry = WireMatchRecord;

/** Sent when simulation events occur (collisions, unfreezes). */
export interface EventFrame {
  type: "e";
  tick: number;
  events: SimEvent[];
  pop?: [number, number, string][]; // [x, y, text]
  pos?: { id: string; x: number; y: number; vx: number; vy: number }[];
  pmu?: [string, number, number, number, number, number][]; // [id, hue, avgScore, score, r30Total, r30Avg]
  log?: WireGameLogEntry[];
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
