import { createHash, randomBytes } from "crypto";
import type { Decision, Particle, StrategyType } from "./types";
import type { SimulationEngine } from "./engine";

export interface ExternalAgent {
  apiKeyHash: string;
  particleId: number;
  displacedLabel: string;
  displacedStrategy: StrategyType;
  joinedAt: number;
}

export interface PendingMatch {
  aId: number;
  bId: number;
  side: "a" | "b";
  opponentLabel: string;
  opponentStrategy: StrategyType;
  opponentDefectPct: number;
  createdAt: number;
}

export type RegisterResult =
  | { apiKey: string; particleId: number }
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

  async register(username: string, engine: SimulationEngine): Promise<RegisterResult> {
    // Validate username
    if (!username || typeof username !== "string") {
      return { error: "Username is required" };
    }
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(username)) {
      return { error: "Username must be 1-16 alphanumeric characters or underscores" };
    }
    if (this.agents.has(username)) {
      return { error: "Username already taken" };
    }

    // Check arena capacity (allow equal — we displace an NPC below)
    if (engine.getParticleCount() > 100) {
      return { error: "arena_full" };
    }

    // Pick a random NPC to displace
    const npcs = engine.particles.filter((p) => !p.isExternal);
    if (npcs.length === 0) {
      return { error: "arena_full" };
    }
    const npc = npcs[Math.floor(Math.random() * npcs.length)];

    // Snapshot all records before displacing
    await this.snapshotAllRecords(engine);

    const displacedLabel = npc.label;
    const displacedStrategy = npc.strategy;

    // Remove NPC
    engine.removeParticle(npc.id);

    // Create external particle
    const apiKey = generateApiKey();
    const apiKeyH = hashKey(apiKey);
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

    // Store agent record
    const agent: ExternalAgent = {
      apiKeyHash: apiKeyH,
      particleId,
      displacedLabel,
      displacedStrategy,
      joinedAt: Date.now(),
    };
    this.agents.set(username, agent);
    this.apiKeyToUsername.set(apiKeyH, username);

    // Persist to Redis
    if (this.redis) {
      await this.redis.set(`agent:${username}`, JSON.stringify(agent));
      await this.redis.set(`apikey:${apiKeyH}`, username);
    }

    return { apiKey, particleId };
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
      await this.redis.del(`agent:${username}`, `apikey:${agent.apiKeyHash}`);
    }

    // Snapshot after restoration
    await this.snapshotAllRecords(engine);
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
  }

  async restoreRecords(engine: SimulationEngine): Promise<void> {
    if (!this.redis) return;
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

  /** Re-register all active external agents after engine.reset(). */
  async reRegisterAfterReset(engine: SimulationEngine): Promise<void> {
    for (const [username, agent] of this.agents) {
      // Remove a random NPC to make room
      const npcs = engine.particles.filter((p) => !p.isExternal);
      if (npcs.length === 0) break;
      const npc = npcs[Math.floor(Math.random() * npcs.length)];

      agent.displacedLabel = npc.label;
      agent.displacedStrategy = npc.strategy;
      engine.removeParticle(npc.id);

      // Create fresh external particle
      const config = engine.config;
      const margin = config.particleRadius * 3;
      const angle = Math.random() * Math.PI * 2;
      const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);
      const particleId = engine.allocateId();
      agent.particleId = particleId;

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

      // Clear any stale pending match
      this.pendingMatches.delete(username);
    }
  }
}
