import { createHash, randomBytes } from "crypto";
import { DEFAULT_CONFIG, type Decision, type MatchRecord, type Particle, type StrategyType, type HallOfFameEntry, type HallOfFameResponse } from "./types";
import type { SimulationEngine } from "./engine";
import { validateNoProfanity, censorText } from "./profanity";

export interface ExternalAgent {
  apiKeyHash: string;
  displacedId: string;
  displacedStrategy: StrategyType;
  joinedAt: number;
  greeting: string;
}

export interface PendingMatch {
  aId: string;
  bId: string;
  side: "a" | "b";
  opponentId: string;
  opponentGreeting: string;
  vsRecord: { cc: number; cd: number; dc: number; dd: number } | null;
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
};

function hashKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function generateApiKey(): string {
  return "claw_" + randomBytes(24).toString("base64url");
}

export class AgentManager {
  private reservedNames: Set<string>;
  private agents = new Map<string, ExternalAgent>();
  private apiKeyToUsername = new Map<string, string>();
  private pendingMatches = new Map<string, PendingMatch>();
  private matchWaiters = new Map<string, { resolve: (match: PendingMatch) => void; reject: (err: Error) => void }>();
  private resultWaiters = new Map<string, { resolve: (record: MatchRecord | null) => void }>();
  private activeResultKeys = new Map<string, string>(); // username → "aId|bId"
  private parkedAt = new Map<string, number>(); // username → Date.now() when parked
  private bannedUsers = new Set<string>();
  private agentIps = new Map<string, string>(); // username → client IP
  private readonly maxAgentsPerIp = 5;
  private redis: Redis | null = null;

  constructor() {
    this.reservedNames = new Set<string>();
    for (const ac of DEFAULT_CONFIG.agentClasses) {
      for (const name of ac.names ?? []) {
        this.reservedNames.add(name.toLowerCase());
      }
    }
  }

  async initRedis(url?: string): Promise<void> {
    if (!url) {
      console.warn("[AgentManager] No REDIS_URL — running in-memory only. Records will not persist across restarts.");
      return;
    }
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

  private countAgentsForIp(ip: string): number {
    let count = 0;
    for (const v of this.agentIps.values()) {
      if (v === ip) count++;
    }
    return count;
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
    await this.upsertHallOfFameEntry(npc);
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

    engine.addParticle(particle);

    const agent: ExternalAgent = {
      apiKeyHash,
      displacedId: npc.id,
      displacedStrategy: npc.strategy,
      joinedAt: Date.now(),
      greeting: censorText(greeting.trim().slice(0, 280)),
    };

    return { particle, agent };
  }

  private validateUsername(username: string): string | null {
    if (!username || typeof username !== "string") return "Username is required";
    if (username.length > 16) return "Username cannot be longer than 16 characters";
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

  async register(username: string, greeting: string, engine: SimulationEngine, clientIp?: string): Promise<RegisterResult> {
    const invalid = this.validateUsername(username);
    if (invalid) return { error: invalid };
    username = username.toLowerCase();
    if (this.bannedUsers.has(username)) return { error: "This username has been banned" };
    if (this.agents.has(username)) return { error: "Username already taken" };
    if (this.reservedNames.has(username)) return { error: "Username is reserved (matches a bot name)" };

    if (clientIp && this.countAgentsForIp(clientIp) >= this.maxAgentsPerIp) {
      return { error: `Too many agents from this IP (max ${this.maxAgentsPerIp})` };
    }

    // If username is already claimed, direct to login
    if (this.redis) {
      const ownerHash = await this.redis.get(`owner:${username}`);
      if (ownerHash) {
        return { error: "Username is taken. If this is your account, use GET /api/agent/match?username=<username> to rejoin. Otherwise, pick a different username." };
      }
    }

    const apiKey = generateApiKey();
    const apiKeyH = hashKey(apiKey);

    const result = await this.displaceAndSpawn(username, greeting, apiKeyH, engine);
    if ("error" in result) return result;

    const { agent } = result;
    this.agents.set(username, agent);
    this.apiKeyToUsername.set(apiKeyH, username);
    if (clientIp) this.agentIps.set(username, clientIp);

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

  async ensureInArena(username: string, apiKeyHash: string, engine: SimulationEngine, clientIp?: string): Promise<{ error?: string }> {
    username = username.toLowerCase();
    if (this.bannedUsers.has(username)) return { error: "This username has been banned" };
    if (this.agents.has(username)) return {};

    if (!this.redis) {
      return { error: "Not registered. Use POST /api/agent/register first." };
    }

    const ownerHash = await this.redis.get(`owner:${username}`);
    if (!ownerHash) return { error: "Not registered. Use POST /api/agent/register first." };
    if (apiKeyHash !== ownerHash) return { error: "Invalid API key" };

    if (clientIp && this.countAgentsForIp(clientIp) >= this.maxAgentsPerIp) {
      return { error: `Too many agents from this IP (max ${this.maxAgentsPerIp})` };
    }

    // Restore greeting from prior agent record
    let greeting = "";
    const agentRaw = await this.redis.get(`agent:${username}`);
    if (agentRaw) {
      try { greeting = censorText(JSON.parse(agentRaw).greeting ?? ""); } catch { /* ignore */ }
    }

    const result = await this.displaceAndSpawn(username, greeting, apiKeyHash, engine);
    if ("error" in result) return result;

    const { particle, agent } = result;
    this.agents.set(username, agent);
    this.apiKeyToUsername.set(apiKeyHash, username);
    if (clientIp) this.agentIps.set(username, clientIp);

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
    return {};
  }

  async removeAgent(username: string, engine: SimulationEngine): Promise<void> {
    const agent = this.agents.get(username);
    if (!agent) return;

    // Snapshot agent record + upsert hall of fame before removal
    const particle = engine.particles.find(p => p.id === username);
    if (particle) {
      await this.snapshotRecord(particle);
      await this.upsertHallOfFameEntry(particle);
    }

    // Remove external particle
    engine.removeParticle(username);

    // Respawn the displaced NPC
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
        try {
          const rec = JSON.parse(raw);
          npc.score = rec.score ?? 0;
          npc.matchHistory = rec.matchHistory ?? {};
        } catch { /* ignore parse errors */ }
      }
    }

    engine.addParticle(npc);

    // Clean up agent records and waiters
    this.pendingMatches.delete(username);
    const matchWaiter = this.matchWaiters.get(username);
    if (matchWaiter) {
      this.matchWaiters.delete(username);
      matchWaiter.reject(new Error("agent_left"));
    }
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
    this.agentIps.delete(username);
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
    await this.redis.set(`record:${particle.id}`, JSON.stringify(rec));
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
      await this.redis.set(`record:${p.id}`, JSON.stringify(rec));
    }
    await this.redis.set("global:stats", JSON.stringify({
      tick: engine.tick,
      totalCooperations: engine.totalCooperations,
      totalDefections: engine.totalDefections,
    }));
  }

  async restoreApiKeys(): Promise<void> {
    if (!this.redis) return;
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
      const id = key.slice("record:".length);
      const particle = engine.particles.find((p) => p.id === id);
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
    if (!this.redis) return null;
    const raw = await this.redis.get(`record:${id}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // --- Hall of Fame ---

  private static readonly HOF_PRIOR_WEIGHT = 20;
  private static readonly HOF_GLOBAL_MEAN = 2.2215;
  private static readonly HOF_MIN_GAMES = 20;

  /** Upsert a single player into the Hall of Fame ZSET if they qualify (≥20 games). */
  async upsertHallOfFameEntry(particle: {
    id: string; score: number; strategy: StrategyType;
    matchHistory: Record<string, { cc: number; cd: number; dc: number; dd: number }>;
    isExternal: boolean;
  }): Promise<void> {
    if (!this.redis) return;
    let games = 0, coops = 0;
    for (const r of Object.values(particle.matchHistory)) {
      games += r.cc + r.cd + r.dc + r.dd;
      coops += r.cc + r.cd;
    }
    if (games < AgentManager.HOF_MIN_GAMES) return;

    const avg = particle.score / games;
    const m = AgentManager.HOF_PRIOR_WEIGHT;
    const C = AgentManager.HOF_GLOBAL_MEAN;
    const rating = (games * avg + m * C) / (games + m);

    await this.redis.zadd("halloffame", rating, particle.id);
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
      if (games >= AgentManager.HOF_MIN_GAMES) count++;
    }
    if (this.redis) {
      await this.redis.set("halloffame:stats", JSON.stringify({
        globalMean: AgentManager.HOF_GLOBAL_MEAN,
        updatedAt: Date.now(),
        priorWeight: AgentManager.HOF_PRIOR_WEIGHT,
      }));
    }
    console.log(`[HallOfFame] Updated ${count} qualifying live particles`);
  }

  async getHallOfFamePage(page: number, pageSize: number, engine: SimulationEngine): Promise<HallOfFameResponse> {
    const m = AgentManager.HOF_PRIOR_WEIGHT;
    const C = AgentManager.HOF_GLOBAL_MEAN;

    if (!this.redis) {
      // Fallback: compute from live particles only
      const entries: HallOfFameEntry[] = [];
      for (const p of engine.particles) {
        let games = 0, coops = 0;
        for (const r of Object.values(p.matchHistory)) {
          games += r.cc + r.cd + r.dc + r.dd;
          coops += r.cc + r.cd;
        }
        if (games < AgentManager.HOF_MIN_GAMES) continue;
        const avg = p.score / games;
        const rating = (games * avg + m * C) / (games + m);
        entries.push({
          label: p.id, strategy: p.strategy, totalScore: p.score,
          avgScore: Math.round(avg * 10000) / 10000,
          bayesianRating: Math.round(rating * 10000) / 10000,
          games, coopPct: Math.round((coops / games) * 10000) / 100,
          isLive: true, isExternal: p.isExternal,
        });
      }
      entries.sort((a, b) => b.bayesianRating - a.bayesianRating);
      const sliced = entries.slice((page - 1) * pageSize, page * pageSize);
      return {
        entries: sliced, globalMean: C, updatedAt: Date.now(),
        priorWeight: m, totalEntries: entries.length, page, pageSize,
      };
    }

    const totalEntries = await this.redis.zcard("halloffame");
    const start = (page - 1) * pageSize;
    const stop = start + pageSize - 1;

    // ZREVRANGE returns [member, score, member, score, ...]
    const raw = await this.redis.zrevrange("halloffame", start, stop, "WITHSCORES");
    const labels: string[] = [];
    const ratings: number[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      labels.push(raw[i]);
      ratings.push(parseFloat(raw[i + 1]));
    }

    if (labels.length === 0) {
      const statsRaw = await this.redis.get("halloffame:stats");
      const stats = statsRaw ? JSON.parse(statsRaw) : { globalMean: C, updatedAt: 0, priorWeight: m };
      return { entries: [], globalMean: stats.globalMean, updatedAt: stats.updatedAt, priorWeight: stats.priorWeight, totalEntries, page, pageSize };
    }

    // Fetch metadata for these labels
    const metaRaw = await this.redis.hmget("halloffame:meta", ...labels);
    const statsRaw = await this.redis.get("halloffame:stats");
    const stats = statsRaw ? JSON.parse(statsRaw) : { globalMean: C, updatedAt: 0, priorWeight: m };

    const liveLabels = new Set(engine.particles.map(p => p.id));
    const entries: HallOfFameEntry[] = [];

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const rating = ratings[i];
      const metaStr = metaRaw[i];
      if (!metaStr) continue;
      try {
        const meta = JSON.parse(metaStr);
        entries.push({
          label,
          strategy: meta.strategy,
          totalScore: meta.totalScore,
          avgScore: meta.avgScore,
          bayesianRating: Math.round(rating * 10000) / 10000,
          games: meta.games,
          coopPct: meta.coopPct,
          isLive: liveLabels.has(label),
          isExternal: meta.isExternal,
        });
      } catch { /* skip bad meta */ }
    }

    return {
      entries, globalMean: stats.globalMean, updatedAt: stats.updatedAt,
      priorWeight: stats.priorWeight, totalEntries, page, pageSize,
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

  getBannedUsers(): string[] {
    return Array.from(this.bannedUsers);
  }

  async restoreBannedUsers(): Promise<void> {
    if (!this.redis) return;
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

}
