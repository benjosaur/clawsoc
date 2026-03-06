import { createHash, randomBytes } from "crypto";
import type { Decision, Particle, StrategyType } from "./types";
import type { SimulationEngine } from "./engine";

export interface ExternalAgent {
  apiKeyHash: string;
  particleId: number;
  displacedLabel: string;
  displacedStrategy: StrategyType;
  joinedAt: number;
  greeting: string;
}

export interface PendingMatch {
  aId: number;
  bId: number;
  side: "a" | "b";
  opponentLabel: string;
  opponentGreeting: string;
  vsRecord: { cc: number; cd: number; dc: number; dd: number } | null;
  createdAt: number;
}

export type RegisterResult =
  | { apiKey: string; particleId: number }
  | { error: string };

export type LoginResult =
  | { particleId: number; returning: true; score: number; matches: number }
  | { error: string };

type Redis = {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
};

function hashKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function generateApiKey(): string {
  return "claw_" + randomBytes(24).toString("base64url");
}

export class AgentManager {
  private agents = new Map<string, ExternalAgent>();
  private apiKeyToUsername = new Map<string, string>();
  private pendingMatches = new Map<string, PendingMatch>();
  private redis: Redis | null = null;

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.initRedis(redisUrl);
    } else {
      console.warn("[AgentManager] No REDIS_URL — running in-memory only. Records will not persist across restarts.");
    }
  }

  private async initRedis(url: string): Promise<void> {
    try {
      const { default: RedisClient } = await import("ioredis");
      this.redis = new RedisClient(url, { maxRetriesPerRequest: 3, lazyConnect: true }) as unknown as Redis;
      await (this.redis as unknown as { connect(): Promise<void> }).connect();
      console.log("[AgentManager] Redis connected");
    } catch (err) {
      console.error("[AgentManager] Redis connection failed, falling back to in-memory:", (err as Error).message);
      this.redis = null;
    }
  }

  private async displaceAndSpawn(
    username: string,
    greeting: string,
    apiKeyHash: string,
    engine: SimulationEngine,
  ): Promise<{ particle: Particle; agent: ExternalAgent } | { error: string }> {
    const npcs = engine.particles.filter((p) => !p.isExternal);
    if (npcs.length === 0) return { error: "arena_full" };

    const npc = npcs[Math.floor(Math.random() * npcs.length)];
    await this.snapshotRecord(npc);
    engine.removeParticle(npc.id);

    const particleId = engine.allocateId();
    const config = engine.config;
    const margin = config.particleRadius * 3;
    const angle = Math.random() * Math.PI * 2;
    const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);

    const particle: Particle = {
      id: particleId,
      label: username,
      position: {
        x: margin + Math.random() * (config.canvasWidth - margin * 2),
        y: margin + Math.random() * (config.canvasHeight - margin * 2),
      },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      radius: config.particleRadius,
      mass: 1,
      color: `hsl(${Math.round(Math.random() * 360)},70%,42%)`,
      state: "moving",
      score: 0,
      strategy: "external",
      useLLM: false,
      matchHistory: {},
      isExternal: true,
      externalOwner: username,
    };

    engine.addParticle(particle);

    const agent: ExternalAgent = {
      apiKeyHash,
      particleId,
      displacedLabel: npc.label,
      displacedStrategy: npc.strategy,
      joinedAt: Date.now(),
      greeting: greeting.trim().slice(0, 280),
    };

    return { particle, agent };
  }

  private validateUsername(username: string): string | null {
    if (!username || typeof username !== "string") return "Username is required";
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(username)) return "Username must be 1-16 alphanumeric characters or underscores";
    return null;
  }

  async register(username: string, greeting: string, engine: SimulationEngine): Promise<RegisterResult> {
    const invalid = this.validateUsername(username);
    if (invalid) return { error: invalid };
    if (this.agents.has(username)) return { error: "Username already taken" };

    // If username is already claimed, direct to login
    if (this.redis) {
      const ownerHash = await this.redis.get(`owner:${username}`);
      if (ownerHash) {
        return { error: "Username is claimed. Use POST /api/agent/login to rejoin." };
      }
    }

    const apiKey = generateApiKey();
    const apiKeyH = hashKey(apiKey);

    const result = await this.displaceAndSpawn(username, greeting, apiKeyH, engine);
    if ("error" in result) return result;

    const { agent } = result;
    this.agents.set(username, agent);
    this.apiKeyToUsername.set(apiKeyH, username);

    if (this.redis) {
      await this.redis.set(`agent:${username}`, JSON.stringify(agent));
      await this.redis.set(`owner:${username}`, apiKeyH);
    }

    return { apiKey, particleId: agent.particleId };
  }

  async login(username: string, greeting: string, apiKey: string, engine: SimulationEngine): Promise<LoginResult> {
    const invalid = this.validateUsername(username);
    if (invalid) return { error: invalid };
    if (this.agents.has(username)) return { error: "Already in the arena" };
    if (!apiKey) return { error: "apiKey is required" };

    if (!this.redis) {
      return { error: "No persistence layer — cannot verify ownership" };
    }

    const ownerHash = await this.redis.get(`owner:${username}`);
    if (!ownerHash) {
      return { error: "Username not found. Use POST /api/agent/register to create an account." };
    }

    const apiKeyH = hashKey(apiKey);
    if (apiKeyH !== ownerHash) {
      return { error: "Invalid API key for this username" };
    }

    const result = await this.displaceAndSpawn(username, greeting, apiKeyH, engine);
    if ("error" in result) return result;

    const { particle, agent } = result;
    this.agents.set(username, agent);
    this.apiKeyToUsername.set(apiKeyH, username);

    // Restore prior record from Redis
    const raw = await this.redis.get(`record:${username}`);
    if (raw) {
      try {
        const rec = JSON.parse(raw);
        particle.score = rec.score ?? 0;
        particle.matchHistory = rec.matchHistory ?? {};
      } catch (err) { console.error(`[AgentManager] Failed to parse record for ${username}:`, err); }
    }

    await this.redis.set(`agent:${username}`, JSON.stringify(agent));

    const matchCount = Object.values(particle.matchHistory).reduce(
      (sum, h) => sum + h.cc + h.cd + h.dc + h.dd, 0
    );

    return { particleId: agent.particleId, returning: true, score: particle.score, matches: matchCount };
  }

  authenticateRequest(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    const h = hashKey(token);
    return this.apiKeyToUsername.get(h) ?? null;
  }

  setPendingMatch(username: string, match: PendingMatch): void {
    this.pendingMatches.set(username, match);
  }

  getPendingMatch(username: string): PendingMatch | undefined {
    return this.pendingMatches.get(username);
  }

  clearPendingMatch(username: string): void {
    this.pendingMatches.delete(username);
  }

  async removeAgent(username: string, engine: SimulationEngine): Promise<void> {
    const agent = this.agents.get(username);
    if (!agent) return;

    // Snapshot agent record before removal
    const particle = engine.particles.find(p => p.id === agent.particleId);
    if (particle) {
      await this.snapshotRecord(particle);
    }

    // Remove external particle
    engine.removeParticle(agent.particleId);

    // Respawn the displaced NPC
    const config = engine.config;
    const margin = config.particleRadius * 3;
    const angle = Math.random() * Math.PI * 2;
    const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);
    const npcId = engine.allocateId();

    const npc: Particle = {
      id: npcId,
      label: agent.displacedLabel,
      position: {
        x: margin + Math.random() * (config.canvasWidth - margin * 2),
        y: margin + Math.random() * (config.canvasHeight - margin * 2),
      },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      radius: config.particleRadius,
      mass: 1,
      color: `hsl(60,50%,45%)`,
      state: "moving",
      score: 0,
      strategy: agent.displacedStrategy,
      useLLM: false,
      matchHistory: {},
      isExternal: false,
    };

    // Restore NPC record from Redis if available
    if (this.redis) {
      const raw = await this.redis.get(`record:${agent.displacedLabel}`);
      if (raw) {
        try {
          const rec = JSON.parse(raw);
          npc.score = rec.score ?? 0;
          npc.matchHistory = rec.matchHistory ?? {};
        } catch { /* ignore parse errors */ }
      }
    }

    engine.addParticle(npc);

    // Clean up agent records
    this.pendingMatches.delete(username);
    this.apiKeyToUsername.delete(agent.apiKeyHash);
    this.agents.delete(username);

    if (this.redis) {
      await this.redis.del(`agent:${username}`);
    }

  }

  async snapshotRecord(particle: Particle): Promise<void> {
    if (!this.redis) return;
    const rec = {
      strategy: particle.strategy,
      score: particle.score,
      matchHistory: particle.matchHistory,
      isExternal: particle.isExternal,
      externalOwner: particle.externalOwner,
    };
    await this.redis.set(`record:${particle.label}`, JSON.stringify(rec));
  }

  async snapshotAllRecords(engine: SimulationEngine): Promise<void> {
    if (!this.redis) return;
    for (const p of engine.particles) {
      const rec = {
        strategy: p.strategy,
        score: p.score,
        matchHistory: p.matchHistory,
        isExternal: p.isExternal,
        externalOwner: p.externalOwner,
      };
      await this.redis.set(`record:${p.label}`, JSON.stringify(rec));
    }
    await this.redis.set("global:stats", JSON.stringify({
      tick: engine.tick,
      totalCooperations: engine.totalCooperations,
      totalDefections: engine.totalDefections,
    }));
  }

  async restoreRecords(engine: SimulationEngine): Promise<void> {
    if (!this.redis) return;

    // Restore global stats
    const statsRaw = await this.redis.get("global:stats");
    if (statsRaw) {
      try {
        const stats = JSON.parse(statsRaw);
        engine.tick = stats.tick ?? 0;
        engine.totalCooperations = stats.totalCooperations ?? 0;
        engine.totalDefections = stats.totalDefections ?? 0;
        console.log(`[AgentManager] Restored global stats: tick=${engine.tick}, cooperations=${engine.totalCooperations}, defections=${engine.totalDefections}`);
      } catch { /* ignore parse errors */ }
    }

    // Restore particle records
    const keys = await this.redis.keys("record:*");
    for (const key of keys) {
      const label = key.slice("record:".length);
      const particle = engine.particles.find((p) => p.label === label);
      if (!particle) continue;
      const raw = await this.redis.get(key);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw);
        particle.score = rec.score ?? 0;
        particle.matchHistory = rec.matchHistory ?? {};
      } catch { /* ignore parse errors */ }
    }
  }

  getAgentByUsername(username: string): ExternalAgent | undefined {
    return this.agents.get(username);
  }

  getAgentParticleId(username: string): number | undefined {
    return this.agents.get(username)?.particleId;
  }

  getAllPendingMatches(): Map<string, PendingMatch> {
    return this.pendingMatches;
  }

  getActiveAgentCount(): number {
    return this.agents.size;
  }

  async lookupRecord(label: string): Promise<{
    strategy: StrategyType;
    score: number;
    matchHistory: Record<number, { cc: number; cd: number; dc: number; dd: number }>;
    isExternal: boolean;
    externalOwner?: string;
  } | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(`record:${label}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

}
