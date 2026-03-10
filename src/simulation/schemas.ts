import { z } from "zod";

// --- Shared enums ---

const DecisionSchema = z.enum(["cooperate", "defect"]);

const StrategySchema = z.enum([
  "always_cooperate",
  "always_defect",
  "tit_for_tat",
  "random",
  "grudger",
  "external",
]);

// --- HTTP request body schemas ---

/** POST /api/agent/register */
export const RegisterBodySchema = z.object({
  username: z.string().default(""),
  greeting: z.string().default(""),
});

/** POST /api/agent/decide */
export const DecideBodySchema = z.object({
  message: z.string().optional(),
  decision: DecisionSchema,
});

/** POST /api/admin/ban and /api/admin/unban */
export const AdminUsernameBodySchema = z.object({
  username: z.string().optional(),
});

// --- Redis data schemas ---

const OpponentRecordSchema = z.object({
  lastTheirDecision: DecisionSchema.default("cooperate"),
  cc: z.number().default(0),
  cd: z.number().default(0),
  dc: z.number().default(0),
  dd: z.number().default(0),
});

/** record:<id> — particle record stored in Redis */
export const ParticleRecordSchema = z.object({
  strategy: StrategySchema.default("external"),
  score: z.number().default(0),
  matchHistory: z.record(z.string(), OpponentRecordSchema).default({}),
  isExternal: z.boolean().default(false),
  externalOwner: z.string().optional(),
});

/** agent:<username> — agent metadata stored in Redis */
export const AgentRedisSchema = z.object({
  apiKeyHash: z.string().optional(),
  displacedId: z.string().nullable().default(null),
  displacedStrategy: StrategySchema.nullable().default(null),
  joinedAt: z.number().optional(),
  greeting: z.string().default(""),
});

/** global:stats — engine stats stored in Redis */
export const GlobalStatsSchema = z.object({
  tick: z.number().default(0),
  totalCooperations: z.number().default(0),
  totalDefections: z.number().default(0),
});

/** halloffame:stats */
export const HofStatsSchema = z.object({
  updatedAt: z.number().default(0),
});

/** halloffame:meta entries */
export const HofMetaSchema = z.object({
  strategy: StrategySchema,
  totalScore: z.number(),
  avgScore: z.number(),
  games: z.number(),
  coopPct: z.number(),
  isExternal: z.boolean(),
});

// --- Helper ---

/** Safely JSON.parse a string, returning undefined on failure. */
export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
