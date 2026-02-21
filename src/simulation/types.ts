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
  useLLM: boolean;
  matchHistory: { opponentId: number; myDecision: Decision; theirDecision: Decision }[];
}

export interface AgentClassConfig {
  strategy: StrategyType;
  count: number;
  useLLM: boolean;
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

export type CollisionPhase =
  | "greeting"
  | "messaging_a"
  | "messaging_b"
  | "deciding"
  | "resolved";

export interface SpeechBubble {
  particleId: number;
  text: string;
  spawnTick: number;
  durationTicks: number;
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
  agentClasses: AgentClassConfig[];
  particleRadius: number;
  minSpeed: number;
  maxSpeed: number;
  freezeDurationTicks: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  canvasWidth: 800,
  canvasHeight: 600,
  agentClasses: [
    { strategy: "always_cooperate", count: 4, useLLM: false },
    { strategy: "always_defect",    count: 4, useLLM: false },
    { strategy: "tit_for_tat",      count: 4, useLLM: false },
    { strategy: "random",           count: 4, useLLM: false },
    { strategy: "grudger",          count: 4, useLLM: false },
  ],
  particleRadius: 10,
  minSpeed: 0.7,
  maxSpeed: 1.8,
  freezeDurationTicks: 45,
};
