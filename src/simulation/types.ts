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

export function totalMatches(history: Record<string, OpponentRecord>): number {
  let n = 0;
  for (const r of Object.values(history)) n += r.cc + r.cd + r.dc + r.dd;
  return n;
}

export type ParticleState = "moving" | "colliding" | "parked";

export interface Particle {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  color: string;
  state: ParticleState;
  score: number;
  scoreLog: { ts: number; pts: number }[];
  strategy: StrategyType;
  matchHistory: Record<string, OpponentRecord>;
  isExternal: boolean;
  externalOwner?: string;
}

export interface AgentClassConfig {
  strategy: StrategyType;
  count: number;
  names?: string[];
}

export interface MatchRecord {
  type: "match";
  id: string;
  tick: number;
  particleA: { id: string; strategy: StrategyType };
  particleB: { id: string; strategy: StrategyType };
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
  particleA: { id: string };
  particleB: { id: string };
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

export interface HallOfFameEntry {
  label: string;
  strategy: StrategyType;
  totalScore: number;
  avgScore: number;
  bayesianRating: number;
  games: number;
  coopPct: number;
  isLive: boolean;
  isExternal: boolean;
}

export interface HallOfFameResponse {
  entries: HallOfFameEntry[];
  globalMean: number;
  updatedAt: number;
  priorWeight: number;
  totalEntries: number;
  page: number;
  pageSize: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  canvasWidth: 800,
  canvasHeight: 600,
  agentClasses: [
    {
      strategy: "always_cooperate",
      count: 20,
      names: [
        "Gandhi", "Teresa", "Nightingale", "Rogers", "Schweitzer",
        "Tubman", "Mandela", "Tutu", "Schindler", "Francis",
        "Tolstoy", "Thoreau", "Keller", "Curie", "Salk",
        "Addams", "Barton", "Lincoln", "Buddha", "Aesop",
      ],
    },
    {
      strategy: "always_defect",
      count: 20,
      names: [
        "Judas", "Brutus", "Nero", "Machiavelli", "Borgia",
        "Attila", "Vlad", "Commodus", "Rasputin", "Blackbeard",
        "Herod", "Caligula", "Torquemada", "Quisling", "Robespierre",
        "Sulla", "Caracalla", "Domitian", "Crassus", "Sejanus",
      ],
    },
    {
      strategy: "tit_for_tat",
      count: 20,
      names: [
        "Hammurabi", "Aristotle", "Solomon", "Aurelius", "Solon",
        "Socrates", "Cicero", "Pericles", "Franklin", "Locke",
        "Montesquieu", "Justinian", "Ashoka", "Themistocles", "Cincinnatus",
        "Confucius", "Plato", "Seneca", "Epictetus", "Plutarch",
      ],
    },
    {
      strategy: "random",
      count: 20,
      names: [
        "Diogenes", "Byron", "Casanova", "Caravaggio", "Wilde",
        "Tesla", "Dalí", "Poe", "Mozart", "Alcibiades",
        "Houdini", "Paganini", "Joker", "Rimbaud", "Heraclitus",
        "Sappho", "Baudelaire", "Nietzsche", "Pythagoras", "Nostradamus",
      ],
    },
    {
      strategy: "grudger",
      count: 20,
      names: [
        "Hannibal", "Cato", "Spartacus", "Joan", "Leonidas",
        "Boudica", "Saladin", "Geronimo", "Cochise", "Tecumseh",
        "Shaka", "Vercingetorix", "Batman", "Toussaint", "Wallace",
        "Zenobia", "Maccabeus", "Scipio", "Coriolanus", "Ajax",
      ],
    },
  ],
  particleRadius: 5,
  minSpeed: 0.15,
  maxSpeed: 0.3,
  freezeDurationTicks: 45,
};
