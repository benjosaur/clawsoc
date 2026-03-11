import { createHash, randomBytes } from "crypto";
import { DEFAULT_CONFIG, type ConversationTurn, type Decision, type MatchRecord, type Particle, type SimulationConfig, type StrategyType, type HallOfFameEntry, type HallOfFameResponse } from "./types";
import type { SimulationEngine } from "./engine";
import { validateNoProfanity } from "./profanity";
import { ParticleRecordSchema, AgentRedisSchema, GlobalStatsSchema, HofStatsSchema, HofMetaSchema, safeJsonParse } from "./schemas";

export interface ExternalAgent {
  apiKeyHash: string;
  displacedId: string | null;
  displacedStrategy: StrategyType | null;
  joinedAt: number;
}

export interface PendingMatch {
  aId: string;
  bId: string;
  side: "a" | "b";
  opponentId: string;
  opponentContext?: string;
  vsRecord: { cc: number; cd: number; dc: number; dd: number } | null;
  conversation: ConversationTurn[];
  forcedDecide: boolean;
  createdAt: number;
}

export type RegisterResult =
  | { apiKey: string }
  | { error: string };

type Redis = {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrevrange(key: string, start: number, stop: number, scoring?: string): Promise<string[]>;
  zcard(key: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
};


function hashKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function generateApiKey(): string {
  return "claw_" + randomBytes(24).toString("base64url");
}

export interface RegisteredUser {
  username: string;
  score: number;
  totalGames: number;
  coopPct: number;
  isLive: boolean;
  isSessionActive: boolean;
  isBanned: boolean;
  joinedAt: number | null;
}

export class AgentManager {
  private reservedNames: Set<string>;
  private agents = new Map<string, ExternalAgent>();
  private apiKeyToUsername = new Map<string, string>();
  private pendingMatches = new Map<string, PendingMatch>();
  private matchWaiters = new Map<string, { resolve: (match: PendingMatch) => void; reject: (err: Error) => void }>();
  private resultWaiters = new Map<string, { resolve: (record: MatchRecord | null) => void }>();
  private activeResultKeys = new Map<string, string>(); // username → "aId|bId"
  private turnWaiters = new Map<string, { resolve: (match: PendingMatch) => void }>();
  private parkedAt = new Map<string, number>(); // username → Date.now() when parked
  private bannedUsers = new Set<string>();
  private spawningUsers = new Set<string>();
  private scoreLogCache = new Map<string, { ts: number; pts: number }[]>();
  private redis: Redis | null = null;
  private config: SimulationConfig;
  private redisExpected: boolean;
  private _redisConnected = false;

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.redisExpected = false;
    this.reservedNames = new Set<string>();
    for (const ac of config.agentClasses) {
      for (const name of ac.names ?? []) {
        this.reservedNames.add(name.toLowerCase());
      }
    }
  }

  getHealthInfo(): { redisExpected: boolean; redisConnected: boolean } {
    return { redisExpected: this.redisExpected, redisConnected: this._redisConnected };
  }

  async initRedis(url?: string): Promise<void> {
    if (!url) {
      console.warn("[AgentManager] No REDIS_URL — running in-memory only. Records will not persist across restarts.");
      return;
    }
    this.redisExpected = true;
    const { default: RedisClient } = await import("ioredis");
    const client = new RedisClient(url, { maxRetriesPerRequest: 3, lazyConnect: true });

    client.on("connect", () => { this._redisConnected = true; console.log("[AgentManager] Redis connected"); });
    client.on("close", () => { this._redisConnected = false; console.warn("[AgentManager] Redis connection closed"); });
    client.on("error", (err: Error) => { console.error("[AgentManager] Redis error:", err.message); });
    client.on("reconnecting", () => { console.log("[AgentManager] Redis reconnecting..."); });

    this.redis = client as unknown as Redis;
    await client.connect();
  }

  async closeRedis(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }


  private warnIfNoRedis(operation: string): void {
    if (!this.redis) {
      console.warn(`[AgentManager] Redis unavailable — skipping ${operation}`);
    }
  }

  private get hofMinGames(): number { return this.config.hofMinGames ?? 100; }

  private async displaceAndSpawn(
    username: string,
    engine: SimulationEngine,
  ): Promise<{ particle: Particle; displacedId: string | null; displacedStrategy: StrategyType | null } | { error: string }> {
    const npcs = engine.particles.filter((p) => !p.isExternal);

    // No NPCs left — evict the longest-staying external agent
    if (npcs.length === 0) {
      let oldestName: string | null = null;
      let oldestJoinedAt = Infinity;
      for (const [name, agent] of this.agents) {
        if (name === username) continue;
        if (this.spawningUsers.has(name)) continue;
        if (!engine.getParticle(name)) continue;
        if (agent.joinedAt < oldestJoinedAt) {
          oldestJoinedAt = agent.joinedAt;
          oldestName = name;
        }
      }
      if (!oldestName) return { error: "arena_full" };

      const evicted = this.agents.get(oldestName)!;
      const evictedParticle = engine.getParticle(oldestName);
      if (evictedParticle) {
        await this.snapshotRecord(evictedParticle);
        await this.upsertHallOfFameEntry(evictedParticle);
        this.scoreLogCache.set(oldestName, evictedParticle.scoreLog);
      }
      engine.removeParticle(oldestName);
      this.cleanupAgentState(oldestName, "evicted");

      // New agent inherits the evicted agent's displaced NPC — skip NPC respawn
      const config = engine.config;
      const margin = config.particleRadius * 3;
      const angle = Math.random() * Math.PI * 2;
      const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);

      const particle: Particle = {
        id: username,
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
        scoreLog: [],
        strategy: "external",
        matchHistory: {},
        isExternal: true,
        externalOwner: username,
      };

      return {
        particle,
        displacedId: evicted.displacedId,
        displacedStrategy: evicted.displacedStrategy,
      };
    }

    const npc = npcs[Math.floor(Math.random() * npcs.length)];
    await this.snapshotRecord(npc);
    await this.upsertHallOfFameEntry(npc);
    this.scoreLogCache.set(npc.id, npc.scoreLog);
    engine.removeParticle(npc.id);

    const config = engine.config;
    const margin = config.particleRadius * 3;
    const angle = Math.random() * Math.PI * 2;
    const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);

    const particle: Particle = {
      id: username,
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
      scoreLog: [],
      strategy: "external",
      matchHistory: {},
      isExternal: true,
      externalOwner: username,
    };

    // NOTE: caller is responsible for calling engine.addParticle(particle)
    // after restoring any persisted state (score, matchHistory, scoreLog).
    return { particle, displacedId: npc.id, displacedStrategy: npc.strategy };
  }

  private validateUsername(username: string): string | null {
    if (!username || typeof username !== "string") return "Username is required";
    if (username.length > 12) return "Username cannot be longer than 12 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return "Username cannot contain special characters";
    const profanityError = validateNoProfanity(username);
    if (profanityError) return profanityError;
    return null;
  }

  async checkUsernameAvailable(username: string): Promise<{ available: boolean; reason?: string }> {
    const invalid = this.validateUsername(username);
    if (invalid) return { available: false, reason: invalid };
    username = username.toLowerCase();
    if (this.bannedUsers.has(username)) return { available: false, reason: "This username has been banned" };
    if (this.reservedNames.has(username)) return { available: false, reason: "Username is reserved" };
    if (this.agents.has(username)) return { available: false, reason: "Username already taken" };
    if (this.redis) {
      const ownerHash = await this.redis.get(`owner:${username}`);
      if (ownerHash) return { available: false, reason: "Username already taken" };
    }
    return { available: true };
  }

  async register(username: string): Promise<RegisterResult> {
    const invalid = this.validateUsername(username);
    if (invalid) return { error: invalid };
    username = username.toLowerCase();
    if (this.bannedUsers.has(username)) return { error: "This username has been banned" };
    if (this.agents.has(username)) return { error: "Username already taken" };
    if (this.reservedNames.has(username)) return { error: "Username is reserved (matches a bot name)" };

    // If username is already claimed, direct to login
    if (this.redis) {
      const ownerHash = await this.redis.get(`owner:${username}`);
      if (ownerHash) {
        return { error: "Username is taken. If this is your account, use GET /api/agent/match?username=<username> to rejoin. Otherwise, pick a different username." };
      }
    }

    const apiKey = generateApiKey();
    const apiKeyH = hashKey(apiKey);

    const agent: ExternalAgent = {
      apiKeyHash: apiKeyH,
      displacedId: null,
      displacedStrategy: null,
      joinedAt: Date.now(),
    };

    this.agents.set(username, agent);
    this.apiKeyToUsername.set(apiKeyH, username);

    if (this.redis) {
      await this.redis.set(`agent:${username}`, JSON.stringify(agent));
      await this.redis.set(`owner:${username}`, apiKeyH);
    }

    return { apiKey };
  }

  authenticateRequest(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    const h = hashKey(token);
    return this.apiKeyToUsername.get(h) ?? null;
  }

  async authenticateWithUsername(username: string, authHeader: string | undefined): Promise<string | null> {
    if (!authHeader?.startsWith("Bearer ") || !this.redis) return null;
    username = username.toLowerCase();
    const h = hashKey(authHeader.slice(7));
    const ownerHash = await this.redis.get(`owner:${username}`);
    if (ownerHash && ownerHash === h) return username;
    return null;
  }

  getApiKeyHash(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return hashKey(authHeader.slice(7));
  }

  parkAgent(username: string): void {
    this.parkedAt.set(username, Date.now());
  }

  unparkAgent(username: string): void {
    this.parkedAt.delete(username);
  }

  getParkedAgents(): Map<string, number> {
    return this.parkedAt;
  }

  hasMatchWaiter(username: string): boolean {
    return this.matchWaiters.has(username);
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

  waitForMatch(username: string): Promise<PendingMatch> {
    // If there's already a pending match (collision happened before agent started waiting), return immediately
    const existing = this.pendingMatches.get(username);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      this.matchWaiters.set(username, { resolve, reject });
    });
  }

  resolveMatchWaiter(username: string, match: PendingMatch): void {
    const waiter = this.matchWaiters.get(username);
    if (waiter) {
      this.matchWaiters.delete(username);
      waiter.resolve(match);
    }
  }

  waitForTurn(username: string): Promise<PendingMatch> {
    const existing = this.pendingMatches.get(username);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      this.turnWaiters.set(username, { resolve });
    });
  }

  resolveTurnWaiter(username: string, match: PendingMatch): void {
    const waiter = this.turnWaiters.get(username);
    if (waiter) {
      this.turnWaiters.delete(username);
      waiter.resolve(match);
    }
  }

  hasTurnWaiter(username: string): boolean {
    return this.turnWaiters.has(username);
  }

  waitForResult(username: string, aId: string, bId: string): Promise<MatchRecord | null> {
    const key = `${aId}|${bId}`;
    this.activeResultKeys.set(username, key);
    return new Promise((resolve) => {
      this.resultWaiters.set(key, { resolve });
    });
  }

  resolveResultWaiter(aId: string, bId: string, record: MatchRecord | null): void {
    const key = `${aId}|${bId}`;
    const waiter = this.resultWaiters.get(key);
    if (waiter) {
      this.resultWaiters.delete(key);
      waiter.resolve(record);
    }
  }

  async ensureInArena(username: string, apiKeyHash: string, engine: SimulationEngine): Promise<{ error?: string }> {
    username = username.toLowerCase();
    if (this.bannedUsers.has(username)) return { error: "This username has been banned" };
    if (this.spawningUsers.has(username)) return { error: "Spawn already in progress, please retry" };

    // Case 1: Agent in memory — check if particle actually exists in arena
    const existingAgent = this.agents.get(username);
    if (existingAgent) {
      const particleExists = !!engine.getParticle(username);
      if (particleExists) return {}; // Already in arena

      // Registered but no particle — spawn into arena
      this.spawningUsers.add(username);
      try {
        const result = await this.displaceAndSpawn(username, engine);
        if ("error" in result) return result;

        existingAgent.displacedId = result.displacedId;
        existingAgent.displacedStrategy = result.displacedStrategy;
        existingAgent.joinedAt = Date.now();

        // Restore prior record from Redis BEFORE adding to engine
        if (this.redis) {
          const raw = await this.redis.get(`record:${username}`);
          if (raw) {
            const parsed = ParticleRecordSchema.safeParse(safeJsonParse(raw));
            if (parsed.success) {
              result.particle.score = parsed.data.score;
              result.particle.matchHistory = parsed.data.matchHistory;
            } else {
              console.error(`[AgentManager] Failed to parse record for ${username}:`, parsed.error.message);
            }
          }
          await this.redis.set(`agent:${username}`, JSON.stringify(existingAgent));
        }

        // Restore cached scoreLog (ephemeral, not in Redis)
        const cached = this.scoreLogCache.get(username);
        if (cached) {
          result.particle.scoreLog = cached;
          this.scoreLogCache.delete(username);
        }

        // Now add to engine — "add" event carries correct metadata
        engine.addParticle(result.particle);

        return {};
      } finally {
        this.spawningUsers.delete(username);
      }
    }

    // Case 2: Not in memory — try Redis (server restart recovery)
    if (!this.redis) {
      return { error: "Not registered. Use POST /api/agent/register first." };
    }

    this.spawningUsers.add(username);
    try {
      const ownerHash = await this.redis.get(`owner:${username}`);
      if (!ownerHash) return { error: "Not registered. Use POST /api/agent/register first." };
      if (apiKeyHash !== ownerHash) return { error: "Invalid API key" };

      const result = await this.displaceAndSpawn(username, engine);
      if ("error" in result) return result;

      const agent: ExternalAgent = {
        apiKeyHash,
        displacedId: result.displacedId,
        displacedStrategy: result.displacedStrategy,
        joinedAt: Date.now(),
      };

      this.agents.set(username, agent);
      this.apiKeyToUsername.set(apiKeyHash, username);

      // Restore prior record from Redis BEFORE adding to engine
      const raw = await this.redis.get(`record:${username}`);
      if (raw) {
        const parsed = ParticleRecordSchema.safeParse(safeJsonParse(raw));
        if (parsed.success) {
          result.particle.score = parsed.data.score;
          result.particle.matchHistory = parsed.data.matchHistory;
        } else {
          console.error(`[AgentManager] Failed to parse record for ${username}:`, parsed.error.message);
        }
      }

      // Restore cached scoreLog (ephemeral, not in Redis)
      const cached = this.scoreLogCache.get(username);
      if (cached) {
        result.particle.scoreLog = cached;
        this.scoreLogCache.delete(username);
      }

      // Now add to engine — "add" event carries correct metadata
      engine.addParticle(result.particle);

      await this.redis.set(`agent:${username}`, JSON.stringify(agent));
      return {};
    } finally {
      this.spawningUsers.delete(username);
    }
  }

  async removeAgent(username: string, engine: SimulationEngine): Promise<void> {
    const agent = this.agents.get(username);
    if (!agent) return;

    // Snapshot agent record + upsert hall of fame before removal
    const particle = engine.getParticle(username);
    if (particle) {
      await this.snapshotRecord(particle);
      await this.upsertHallOfFameEntry(particle);
      // Cache scoreLog in memory so 30m scores survive rejoin
      this.scoreLogCache.set(username, particle.scoreLog);
    }

    // Remove external particle
    engine.removeParticle(username);

    // Respawn the displaced NPC (only if one was displaced)
    if (agent.displacedId && agent.displacedStrategy) {
      const config = engine.config;
      const margin = config.particleRadius * 3;
      const angle = Math.random() * Math.PI * 2;
      const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);

      const npc: Particle = {
        id: agent.displacedId,
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
        scoreLog: [],
        strategy: agent.displacedStrategy,
        matchHistory: {},
        isExternal: false,
      };

      // Restore NPC record from Redis if available
      if (this.redis) {
        const raw = await this.redis.get(`record:${agent.displacedId}`);
        if (raw) {
          const parsed = ParticleRecordSchema.safeParse(safeJsonParse(raw));
          if (parsed.success) {
            npc.score = parsed.data.score;
            npc.matchHistory = parsed.data.matchHistory;
          }
        }
      }

      // Restore cached scoreLog (ephemeral, not in Redis)
      const cachedLog = this.scoreLogCache.get(agent.displacedId);
      if (cachedLog) {
        npc.scoreLog = cachedLog;
        this.scoreLogCache.delete(agent.displacedId);
      }

      engine.addParticle(npc);
    }

    this.cleanupAgentState(username);

  }

  private cleanupAgentState(username: string, reason: "agent_left" | "evicted" = "agent_left"): void {
    const agent = this.agents.get(username);
    this.pendingMatches.delete(username);
    const matchWaiter = this.matchWaiters.get(username);
    if (matchWaiter) {
      this.matchWaiters.delete(username);
      matchWaiter.reject(new Error(reason));
    }
    this.turnWaiters.delete(username);
    const resultKey = this.activeResultKeys.get(username);
    if (resultKey) {
      this.activeResultKeys.delete(username);
      const rw = this.resultWaiters.get(resultKey);
      if (rw) {
        this.resultWaiters.delete(resultKey);
        rw.resolve(null);
      }
    }
    this.parkedAt.delete(username);
    if (agent) this.apiKeyToUsername.delete(agent.apiKeyHash);
    this.agents.delete(username);
  }

  async snapshotRecord(particle: Particle): Promise<void> {
    if (!this.redis) { this.warnIfNoRedis("snapshotRecord"); return; }
    const rec = {
      strategy: particle.strategy,
      score: particle.score,
      matchHistory: particle.matchHistory,
      isExternal: particle.isExternal,
      externalOwner: particle.externalOwner,
    };
    await this.redis.set(`record:${particle.id}`, JSON.stringify(rec));
  }

  async snapshotAllRecords(engine: SimulationEngine): Promise<void> {
    if (!this.redis) { this.warnIfNoRedis("snapshotAllRecords"); return; }
    for (const p of engine.particles) {
      const rec = {
        strategy: p.strategy,
        score: p.score,
        matchHistory: p.matchHistory,
        isExternal: p.isExternal,
        externalOwner: p.externalOwner,
      };
      await this.redis.set(`record:${p.id}`, JSON.stringify(rec));
    }
    await this.redis.set("global:stats", JSON.stringify({
      tick: engine.tick,
      totalCooperations: engine.totalCooperations,
      totalDefections: engine.totalDefections,
    }));
  }

  async restoreApiKeys(): Promise<void> {
    if (!this.redis) { this.warnIfNoRedis("restoreApiKeys"); return; }
    const keys = await this.redis.keys("owner:*");
    for (const key of keys) {
      const apiKeyHash = await this.redis.get(key);
      if (apiKeyHash) {
        const username = key.slice("owner:".length);
        this.apiKeyToUsername.set(apiKeyHash, username);
      }
    }
    if (keys.length > 0) console.log(`[AgentManager] Restored ${keys.length} API key mappings`);
  }

  async restoreRecords(engine: SimulationEngine): Promise<void> {
    if (!this.redis) { this.warnIfNoRedis("restoreRecords"); return; }

    // Restore global stats
    const statsRaw = await this.redis.get("global:stats");
    if (statsRaw) {
      const parsed = GlobalStatsSchema.safeParse(safeJsonParse(statsRaw));
      if (parsed.success) {
        engine.tick = parsed.data.tick;
        engine.totalCooperations = parsed.data.totalCooperations;
        engine.totalDefections = parsed.data.totalDefections;
        console.log(`[AgentManager] Restored global stats: tick=${engine.tick}, cooperations=${engine.totalCooperations}, defections=${engine.totalDefections}`);
      }
    }

    // Restore particle records
    const keys = await this.redis.keys("record:*");
    for (const key of keys) {
      const id = key.slice("record:".length);
      const particle = engine.getParticle(id);
      if (!particle) continue;
      const raw = await this.redis.get(key);
      if (!raw) continue;
      const parsed = ParticleRecordSchema.safeParse(safeJsonParse(raw));
      if (parsed.success) {
        particle.score = parsed.data.score;
        particle.matchHistory = parsed.data.matchHistory;
      }
    }
  }

  getAgentByUsername(username: string): ExternalAgent | undefined {
    return this.agents.get(username);
  }

  getAllPendingMatches(): Map<string, PendingMatch> {
    return this.pendingMatches;
  }

  getActiveAgentCount(): number {
    return this.agents.size;
  }

  async lookupRecord(id: string): Promise<{
    strategy: StrategyType;
    score: number;
    matchHistory: Record<string, { cc: number; cd: number; dc: number; dd: number }>;
    isExternal: boolean;
    externalOwner?: string;
  } | null> {
    if (!this.redis) { this.warnIfNoRedis("lookupRecord"); return null; }
    const raw = await this.redis.get(`record:${id}`);
    if (!raw) return null;
    const parsed = ParticleRecordSchema.safeParse(safeJsonParse(raw));
    return parsed.success ? parsed.data : null;
  }

  // --- Hall of Fame ---

  /** Upsert a single player into the Hall of Fame ZSET if they qualify. */
  async upsertHallOfFameEntry(particle: {
    id: string; score: number; strategy: StrategyType;
    matchHistory: Record<string, { cc: number; cd: number; dc: number; dd: number }>;
    isExternal: boolean;
  }): Promise<void> {
    if (!this.redis) { this.warnIfNoRedis("upsertHallOfFameEntry"); return; }
    let games = 0, coops = 0;
    for (const r of Object.values(particle.matchHistory)) {
      games += r.cc + r.cd + r.dc + r.dd;
      coops += r.cc + r.cd;
    }
    if (games < this.hofMinGames) return;

    const avg = particle.score / games;

    await this.redis.zadd("halloffame", avg, particle.id);
    await this.redis.hset("halloffame:meta", particle.id, JSON.stringify({
      strategy: particle.strategy,
      totalScore: particle.score,
      avgScore: Math.round(avg * 10000) / 10000,
      games,
      coopPct: Math.round((coops / games) * 10000) / 100,
      isExternal: particle.isExternal,
    }));
  }

  /** Upsert all current live particles that qualify into the Hall of Fame. No Redis record scanning. */
  async updateHallOfFameForLiveParticles(engine: SimulationEngine): Promise<void> {
    let count = 0;
    for (const p of engine.particles) {
      await this.upsertHallOfFameEntry(p);
      let games = 0;
      for (const r of Object.values(p.matchHistory)) games += r.cc + r.cd + r.dc + r.dd;
      if (games >= this.hofMinGames) count++;
    }
    if (this.redis) {
      await this.redis.set("halloffame:stats", JSON.stringify({
        updatedAt: Date.now(),
      }));
    }
    console.log(`[HallOfFame] Updated ${count} qualifying live particles`);
  }

  async getHallOfFamePage(page: number, pageSize: number, engine: SimulationEngine): Promise<HallOfFameResponse> {
    if (!this.redis) {
      this.warnIfNoRedis("getHallOfFamePage");
      // Fallback: compute from live particles only
      const entries: HallOfFameEntry[] = [];
      for (const p of engine.particles) {
        let games = 0, coops = 0;
        for (const r of Object.values(p.matchHistory)) {
          games += r.cc + r.cd + r.dc + r.dd;
          coops += r.cc + r.cd;
        }
        if (games < this.hofMinGames) continue;
        const avg = p.score / games;
        entries.push({
          label: p.id, strategy: p.strategy, totalScore: p.score,
          avgScore: Math.round(avg * 10000) / 10000,
          games, coopPct: Math.round((coops / games) * 10000) / 100,
          isLive: true, isExternal: p.isExternal,
        });
      }
      entries.sort((a, b) => b.avgScore - a.avgScore);
      const sliced = entries.slice((page - 1) * pageSize, page * pageSize);
      return {
        entries: sliced, minGames: this.hofMinGames, updatedAt: Date.now(),
        totalEntries: entries.length, page, pageSize,
      };
    }

    const totalEntries = await this.redis.zcard("halloffame");
    const start = (page - 1) * pageSize;
    const stop = start + pageSize - 1;

    // ZREVRANGE returns [member, score, member, score, ...]
    const raw = await this.redis.zrevrange("halloffame", start, stop, "WITHSCORES");
    const labels: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      labels.push(raw[i]);
    }

    const defaultStats = { updatedAt: 0 };

    if (labels.length === 0) {
      const statsRaw = await this.redis.get("halloffame:stats");
      const stats = statsRaw ? (HofStatsSchema.safeParse(safeJsonParse(statsRaw)).data ?? defaultStats) : defaultStats;
      return { entries: [], minGames: this.hofMinGames, updatedAt: stats.updatedAt, totalEntries, page, pageSize };
    }

    // Fetch metadata for these labels
    const metaRaw = await this.redis.hmget("halloffame:meta", ...labels);
    const statsRaw = await this.redis.get("halloffame:stats");
    const stats = statsRaw ? (HofStatsSchema.safeParse(safeJsonParse(statsRaw)).data ?? defaultStats) : defaultStats;

    const liveLabels = new Set(engine.particles.map(p => p.id));
    const entries: HallOfFameEntry[] = [];

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const metaStr = metaRaw[i];
      if (!metaStr) continue;
      const parsed = HofMetaSchema.safeParse(safeJsonParse(metaStr));
      if (!parsed.success) continue;
      const meta = parsed.data;
      entries.push({
        label,
        strategy: meta.strategy,
        totalScore: meta.totalScore,
        avgScore: meta.avgScore,
        games: meta.games,
        coopPct: meta.coopPct,
        isLive: liveLabels.has(label),
        isExternal: meta.isExternal,
      });
    }

    return {
      entries, minGames: this.hofMinGames, updatedAt: stats.updatedAt,
      totalEntries, page, pageSize,
    };
  }

  // --- Ban management ---

  isBanned(username: string): boolean {
    return this.bannedUsers.has(username.toLowerCase());
  }

  async banUser(username: string, engine: SimulationEngine): Promise<void> {
    const lower = username.toLowerCase();
    this.bannedUsers.add(lower);

    // Remove from arena if currently live
    for (const [agentUsername] of this.agents) {
      if (agentUsername.toLowerCase() === lower) {
        await this.removeAgent(agentUsername, engine);
        break;
      }
    }

    if (this.redis) {
      await this.redis.sadd("banned", lower);
    }
  }

  async unbanUser(username: string): Promise<void> {
    const lower = username.toLowerCase();
    this.bannedUsers.delete(lower);
    if (this.redis) {
      await this.redis.srem("banned", lower);
    }
  }

  async deleteUser(username: string, engine: SimulationEngine): Promise<void> {
    const lower = username.toLowerCase();

    // Remove from arena if live (respawns displaced NPC)
    if (this.agents.has(lower)) {
      await this.removeAgent(lower, engine);
    } else {
      // Clean up apiKeyToUsername mapping restored from Redis at startup
      for (const [hash, name] of this.apiKeyToUsername) {
        if (name === lower) { this.apiKeyToUsername.delete(hash); break; }
      }
    }

    // Remove from banned set
    this.bannedUsers.delete(lower);

    // Clean up in-memory caches
    this.scoreLogCache.delete(lower);

    // Purge all Redis keys
    if (this.redis) {
      await this.redis.del(`owner:${lower}`, `agent:${lower}`, `record:${lower}`);
      await this.redis.srem("banned", lower);
      await this.redis.zrem("halloffame", lower);
      await this.redis.hdel("halloffame:meta", lower);
    }
  }

  getBannedUsers(): string[] {
    return Array.from(this.bannedUsers);
  }

  async restoreBannedUsers(): Promise<void> {
    if (!this.redis) { this.warnIfNoRedis("restoreBannedUsers"); return; }
    const members = await this.redis.smembers("banned");
    for (const m of members) {
      this.bannedUsers.add(m);
    }
    if (members.length > 0) {
      console.log(`[AgentManager] Restored ${members.length} banned users`);
    }
  }

  getAllAgents(): Map<string, ExternalAgent> {
    return this.agents;
  }

  private computeStats(matchHistory: Record<string, { cc: number; cd: number; dc: number; dd: number }>): { totalGames: number; coopPct: number } {
    let totalGames = 0, coops = 0;
    for (const r of Object.values(matchHistory)) {
      totalGames += r.cc + r.cd + r.dc + r.dd;
      coops += r.cc + r.cd;
    }
    return {
      totalGames,
      coopPct: totalGames > 0 ? Math.round((coops / totalGames) * 10000) / 100 : 0,
    };
  }

  async getAllRegisteredUsers(engine: SimulationEngine): Promise<RegisteredUser[]> {
    const liveIds = new Set(engine.particles.map(p => p.id));

    if (!this.redis) {
      // Fallback: in-memory agents only
      const results: RegisteredUser[] = [];
      for (const [username, agent] of this.agents) {
        const particle = engine.getParticle(username);
        let score = 0, totalGames = 0, coopPct = 0;
        if (particle) {
          score = particle.score;
          ({ totalGames, coopPct } = this.computeStats(particle.matchHistory));
        }
        results.push({
          username, score, totalGames, coopPct,
          isLive: liveIds.has(username),
          isSessionActive: true,
          isBanned: this.bannedUsers.has(username),
          joinedAt: agent.joinedAt,
        });
      }
      return results;
    }

    const ownerKeys = await this.redis.keys("owner:*");
    const results: RegisteredUser[] = [];

    for (const key of ownerKeys) {
      const username = key.slice("owner:".length);
      let score = 0, totalGames = 0, coopPct = 0;

      // Prefer live particle data
      const particle = engine.getParticle(username);
      if (particle) {
        score = particle.score;
        ({ totalGames, coopPct } = this.computeStats(particle.matchHistory));
      } else {
        const raw = await this.redis!.get(`record:${username}`);
        if (raw) {
          const parsed = ParticleRecordSchema.safeParse(safeJsonParse(raw));
          if (parsed.success) {
            score = parsed.data.score;
            ({ totalGames, coopPct } = this.computeStats(parsed.data.matchHistory));
          }
        }
      }

      // Get joinedAt
      let joinedAt: number | null = null;
      const inMemory = this.agents.get(username);
      if (inMemory) {
        joinedAt = inMemory.joinedAt;
      } else {
        const agentRaw = await this.redis!.get(`agent:${username}`);
        if (agentRaw) {
          const parsed = AgentRedisSchema.safeParse(safeJsonParse(agentRaw));
          if (parsed.success && parsed.data.joinedAt) {
            joinedAt = parsed.data.joinedAt;
          }
        }
      }

      results.push({
        username, score, totalGames, coopPct,
        isLive: liveIds.has(username),
        isSessionActive: this.agents.has(username),
        isBanned: this.bannedUsers.has(username),
        joinedAt,
      });
    }

    return results;
  }

}
