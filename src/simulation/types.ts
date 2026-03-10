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
  conversation: ConversationTurn[];
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
  | "conversation"
  | "deciding"
  | "resolved";

export interface ConversationTurn {
  speaker: "a" | "b";
  type: "message" | "decision";
  content: string;
  decision?: Decision;
}

export interface ConversationState {
  turns: ConversationTurn[];
  currentSpeaker: "a" | "b";
  lockedInA: Decision | null;
  lockedInB: Decision | null;
  forcedDecideNext: boolean;
  waitingForExternal: boolean;
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

  /** Engine ticks per collision phase */
  phaseDurations?: Record<CollisionPhase, number>;

  /** Main simulation loop interval in ms (default 100) */
  simulationIntervalMs?: number;
  /** Broadcast position sync every N intervals (default 120) */
  positionSyncInterval?: number;
  /** Broadcast slow frame every N intervals (default 300) */
  slowFrameInterval?: number;
  /** Hall of Fame snapshot interval in ms (default 3_600_000) */
  hofSnapshotIntervalMs?: number;

  /** /match long-poll timeout in ms (default 120_000) */
  matchResponseTimeoutMs?: number;
  /** /decide result wait timeout in ms (default 15_000) */
  decideResponseTimeoutMs?: number;
  /** Abort stale pending matches after ms (default 60_000) */
  pendingMatchTimeoutMs?: number;
  /** Kick idle parked agents after ms (default 30_000) */
  parkedAgentTimeoutMs?: number;

  /** Bayesian prior weight for Hall of Fame (default 20) */
  hofPriorWeight?: number;
  /** Bayesian global mean for Hall of Fame (default 2.2215) */
  hofGlobalMean?: number;
  /** Minimum games to qualify for Hall of Fame (default 20) */
  hofMinGames?: number;
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

  phaseDurations: {
    greeting: 15,
    conversation: 0,
    deciding: 20,
    resolved: 40,
  },

  simulationIntervalMs: 100,
  positionSyncInterval: 120,
  slowFrameInterval: 300,
  hofSnapshotIntervalMs: 3_600_000,

  matchResponseTimeoutMs: 120_000,
  decideResponseTimeoutMs: 15_000,
  pendingMatchTimeoutMs: 15_000,
  parkedAgentTimeoutMs: 15_000,

  hofPriorWeight: 20,
  hofGlobalMean: 2.2215,
  hofMinGames: 20,
};
