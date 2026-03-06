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
  | "grudger"
  | "external";

export interface OpponentRecord {
  lastTheirDecision: Decision;
  cc: number;
  cd: number;
  dc: number;
  dd: number;
}

export function totalMatches(history: Record<number, OpponentRecord>): number {
  let n = 0;
  for (const r of Object.values(history)) n += r.cc + r.cd + r.dc + r.dd;
  return n;
}

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
  matchHistory: Record<number, OpponentRecord>;
  isExternal: boolean;
  externalOwner?: string;
}

export interface AgentClassConfig {
  strategy: StrategyType;
  count: number;
  useLLM: boolean;
  names?: string[];
}

export interface MatchRecord {
  type: "match";
  id: string;
  tick: number;
  particleA: { id: number; label: string; strategy: StrategyType };
  particleB: { id: number; label: string; strategy: StrategyType };
  decisionA: Decision;
  decisionB: Decision;
  scoreA: number;
  scoreB: number;
  messageA?: string;
  messageB?: string;
  timestamp: number;
}

export interface TimeoutRecord {
  type: "timeout";
  id: string;
  tick: number;
  particleA: { id: number; label: string };
  particleB: { id: number; label: string };
  reason: string;
  timestamp: number;
}

export type GameLogEntry = MatchRecord | TimeoutRecord;

export type CollisionPhase =
  | "greeting"
  | "messaging_a"
  | "messaging_b"
  | "deciding"
  | "resolved";

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
    { strategy: "always_cooperate", count: 20, useLLM: false },
    { strategy: "always_defect", count: 20, useLLM: false },
    { strategy: "tit_for_tat", count: 20, useLLM: false },
    { strategy: "random", count: 20, useLLM: false },
    { strategy: "grudger", count: 20, useLLM: false },
  ],
  particleRadius: 4,
  minSpeed: 0.1,
  maxSpeed: 0.2,
  freezeDurationTicks: 45,
};
