export interface Vec2 {
  x: number;
  y: number;
}

export type Decision = "cooperate" | "defect";

export type StrategyType =
  | "always_cooperate"
  | "always_defect"
  | "tit_for_tat"
  | "random"
  | "grudger";

export type ParticleState = "moving" | "colliding";

export interface Particle {
  id: number;
  label: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  color: string;
  state: ParticleState;
  score: number;
  strategy: StrategyType;
  matchHistory: { opponentId: number; myDecision: Decision; theirDecision: Decision }[];
}

export interface MatchRecord {
  id: string;
  tick: number;
  particleA: { id: number; label: string; strategy: StrategyType };
  particleB: { id: number; label: string; strategy: StrategyType };
  decisionA: Decision;
  decisionB: Decision;
  scoreA: number;
  scoreB: number;
  timestamp: number;
}

export interface FloatingPopup {
  x: number;
  y: number;
  text: string;
  color: string;
  spawnTick: number;
  delayTicks: number;
  durationTicks: number;
}

export interface SimulationConfig {
  canvasWidth: number;
  canvasHeight: number;
  particleCount: number;
  particleRadius: number;
  minSpeed: number;
  maxSpeed: number;
  freezeDurationTicks: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  canvasWidth: 800,
  canvasHeight: 600,
  particleCount: 20,
  particleRadius: 10,
  minSpeed: 0.7,
  maxSpeed: 1.8,
  freezeDurationTicks: 45,
};
