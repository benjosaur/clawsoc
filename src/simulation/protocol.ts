import type { GameLogEntry, StrategyType } from "./types";

/** Server → Client: compact positions at 10fps. */
export interface FastFrame {
  type: "f";
  t: number;                                      // tick
  p: [number, number, number, number][];           // [id, x, y, state(0=moving,1=colliding)]
  pop?: [number, number, string, string][];        // new popups only: [x, y, text, color]
}

/** Server → Client: metadata + game log at 1fps. */
export interface SlowFrame {
  type: "s";
  particles: {
    id: number;
    label: string;
    color: string;
    radius: number;
    score: number;
    avgScore: number;
    strategy: StrategyType;
  }[];
  gameLog: GameLogEntry[];
  totalC: number;
  totalD: number;
}

export type ServerFrame = FastFrame | SlowFrame;

/** Merged client-side view for canvas rendering (no React re-render). */
export interface CanvasView {
  particles: {
    id: number;
    x: number;
    y: number;
    state: number; // 0=moving, 1=colliding
    color: string;
    radius: number;
    label: string;
    avgScore: number;
  }[];
  popups: { x: number; y: number; text: string; color: string; spawnTime: number }[];
  tick: number;
}

/** Client → Server: control commands. */
export type ClientMessage =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };
