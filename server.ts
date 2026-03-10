import { createServer, IncomingMessage, ServerResponse } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { SimulationEngine } from "./src/simulation/engine";
import { DEFAULT_CONFIG, totalMatches } from "./src/simulation/types";
import type { Decision, GameLogEntry, StrategyType } from "./src/simulation/types";
import { generateMessage } from "./src/simulation/messages";
import { AgentManager } from "./src/simulation/agentManager";
import { handleAdminAPI } from "./src/simulation/adminApi";
import { censorText } from "./src/simulation/profanity";
import { agentApiLimiter, registerLimiter } from "./src/simulation/rateLimit";
import type { PendingMatch } from "./src/simulation/agentManager";
import type { InitFrame, EventFrame, SlowFrame, SimEvent } from "./src/simulation/protocol";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

// --- Simulation engine ---

const engine = new SimulationEngine(DEFAULT_CONFIG);
const agentManager = new AgentManager();

// --- External agent decision callback ---

engine.onRequestExternalDecision = (side, self, opponent, aId, bId) => {
  const username = self.externalOwner;
  if (!username) return;

  // Per-pair match history from the external agent's perspective
  const rec = self.matchHistory[opponent.id];
  const vsRecord = rec
    ? { cc: rec.cc, cd: rec.cd, dc: rec.dc, dd: rec.dd }
    : null;

  // Opponent greeting: stored greeting for externals, generated template for bots
  let opponentGreeting: string;
  if (opponent.isExternal && opponent.externalOwner) {
    opponentGreeting = agentManager.getAgentByUsername(opponent.externalOwner)?.greeting ?? "";
  } else {
    opponentGreeting = generateMessage(opponent, self);
  }

  const match: PendingMatch = {
    aId,
    bId,
    side,
    opponentId: opponent.id,
    opponentGreeting,
    vsRecord,
    createdAt: Date.now(),
  };

  agentManager.setPendingMatch(username, match);
  agentManager.resolveMatchWaiter(username, match);
};

// --- Park callback (external particles freeze after match until next /match) ---

engine.onParticleParked = (particleId, username) => {
  agentManager.parkAgent(username);

  // Race condition fix: if the agent already called /match before the previous
  // match resolved, a waiter is registered. Unpark immediately so the particle
  // can collide again.
  if (agentManager.hasMatchWaiter(username)) {
    agentManager.unparkAgent(username);
    engine.unparkParticle(particleId);
  }
};

// --- Match result callback ---

engine.onMatchResolved = (record, aId, bId) => {
  agentManager.resolveResultWaiter(aId, bId, record);
};

// --- Agent HTTP API ---

function readBody(req: IncomingMessage, maxBytes = 10_240): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        fail(new Error("body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", (err) => fail(err));
  });
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleAgentAPI(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const method = req.method ?? "GET";

  // CORS headers for browser-based clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate limiting per IP
  const clientIp = (req.headers["fly-client-ip"] as string) || req.socket.remoteAddress || "unknown";
  const isRegisterRoute = pathname === "/api/agent/register" || pathname === "/api/agent/check-username";
  const limiter = isRegisterRoute ? registerLimiter : agentApiLimiter;
  if (!limiter.consume(clientIp)) {
    const retryAfter = limiter.retryAfter(clientIp);
    res.setHeader("Retry-After", String(retryAfter));
    return jsonResponse(res, 429, { error: "Too many requests", retryAfter });
  }

  // GET /api/agent/check-username — unauthenticated availability check
  if (pathname === "/api/agent/check-username" && method === "GET") {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const name = url.searchParams.get("username") ?? "";
    const result = await agentManager.checkUsernameAvailable(name);
    return jsonResponse(res, 200, result);
  }

  // POST /api/agent/register — first-time registration
  if (pathname === "/api/agent/register" && method === "POST") {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if ((err as Error).message === "body_too_large") {
        return jsonResponse(res, 413, { error: "Request body too large (max 10KB)" });
      }
      return jsonResponse(res, 400, { error: "Failed to read request body" });
    }
    let body: { username?: string; greeting?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const result = await agentManager.register(body.username ?? "", body.greeting ?? "", engine, clientIp);
    if ("error" in result) {
      const status = result.error === "arena_full" ? 503 : 400;
      return jsonResponse(res, status, result);
    }
    return jsonResponse(res, 200, result);
  }

  // All other routes require auth + username query param
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const queryUsername = url.searchParams.get("username");
  if (!queryUsername) {
    return jsonResponse(res, 400, { error: "Missing required query parameter: username" });
  }

  // Try fast in-memory auth first, fall back to Redis lookup by username
  let username = agentManager.authenticateRequest(req.headers.authorization);
  if (!username) {
    username = await agentManager.authenticateWithUsername(queryUsername, req.headers.authorization);
  }
  if (!username) {
    return jsonResponse(res, 401, { error: "Unauthorized. Provide Authorization: Bearer <api_key>" });
  }
  if (username !== queryUsername) {
    return jsonResponse(res, 403, { error: "API key does not belong to the specified username" });
  }

  const apiKeyHash = agentManager.getApiKeyHash(req.headers.authorization)!;

  // GET /api/agent/match — blocks until a collision happens (auto-rejoins if needed)
  if (pathname === "/api/agent/match" && method === "GET") {
    const rejoin = await agentManager.ensureInArena(username, apiKeyHash, engine, clientIp);
    if (rejoin.error) {
      const status = rejoin.error === "arena_full" ? 503 : 400;
      return jsonResponse(res, status, { error: rejoin.error });
    }

    // Guard: already have a pending match — must call /decide first
    const pending = agentManager.getPendingMatch(username);
    if (pending) {
      return jsonResponse(res, 409, {
        error: "You have a pending match. Submit your decision before requesting a new match.",
        status: "pending_match",
        pendingMatch: { opponentId: pending.opponentId, opponentGreeting: pending.opponentGreeting, vsRecord: pending.vsRecord },
        nextAction: "POST /api/agent/decide with { message, decision }",
      });
    }

    // Guard: already have a blocking /match call in progress
    if (agentManager.hasMatchWaiter(username)) {
      return jsonResponse(res, 409, {
        error: "Another /match request is already waiting. Only one blocking call at a time.",
        status: "moving",
        nextAction: "Wait for your existing GET /api/agent/match call to return",
      });
    }

    // Guard: particle is currently mid-match (colliding)
    const particle = engine.particles.find((p) => p.id === username);
    if (particle?.state === "colliding") {
      return jsonResponse(res, 409, {
        error: "Your particle just collided and a decision will be requested shortly.",
        status: "moving",
        nextAction: "Poll GET /api/agent/status until status becomes pending_match",
      });
    }

    // Unpark if parked from a previous match
    agentManager.unparkAgent(username);
    engine.unparkParticle(username);

    try {
      const match = await Promise.race([
        agentManager.waitForMatch(username),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 120_000)
        ),
      ]);

      return jsonResponse(res, 200, {
        opponentId: match.opponentId,
        opponentGreeting: match.opponentGreeting,
        vsRecord: match.vsRecord,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "timeout") return jsonResponse(res, 408, { timeout: true, status: "moving", nextAction: "GET /api/agent/match to try again" });
      if (msg === "agent_left") return jsonResponse(res, 410, { error: "Agent removed from arena", status: "offline", nextAction: "POST /api/agent/register to re-register" });
      return jsonResponse(res, 500, { error: "Internal error" });
    }
  }

  // GET /api/agent/status — non-blocking score/match check
  if (pathname === "/api/agent/status" && method === "GET") {
    const particle = engine.particles.find((p) => p.id === username);
    const pending = agentManager.getPendingMatch(username);

    let status: string;
    let nextAction: string;

    if (pending) {
      status = "pending_match";
      nextAction = "POST /api/agent/decide with { message, decision }";
    } else if (!particle) {
      status = "offline";
      nextAction = "GET /api/agent/match to rejoin the arena";
    } else if (particle.state === "parked") {
      status = "parked";
      nextAction = "GET /api/agent/match to start moving again and find your next opponent";
    } else {
      status = "moving";
      nextAction = "GET /api/agent/match to wait for a collision, or poll this endpoint";
    }

    return jsonResponse(res, 200, {
      username,
      score: particle?.score ?? 0,
      matches: particle ? totalMatches(particle.matchHistory) : 0,
      status,
      pendingMatch: pending
        ? { opponentId: pending.opponentId, opponentGreeting: pending.opponentGreeting, vsRecord: pending.vsRecord }
        : null,
      nextAction,
    });
  }

  // POST /api/agent/decide — blocks until match resolves, returns result
  if (pathname === "/api/agent/decide" && method === "POST") {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if ((err as Error).message === "body_too_large") {
        return jsonResponse(res, 413, { error: "Request body too large (max 10KB)" });
      }
      return jsonResponse(res, 400, { error: "Failed to read request body" });
    }
    let body: { message?: string; decision?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }

    const message = body.message?.slice(0, 500);
    const { decision } = body;
    if (!decision || (decision !== "cooperate" && decision !== "defect")) {
      return jsonResponse(res, 400, { error: "decision must be 'cooperate' or 'defect'" });
    }

    const pending = agentManager.getPendingMatch(username);
    if (!pending) {
      const particle = engine.particles.find((p) => p.id === username);
      const currentStatus = !particle ? "offline" : particle.state === "parked" ? "parked" : "moving";
      const na = !particle
        ? "GET /api/agent/match to rejoin the arena"
        : particle.state === "parked"
          ? "GET /api/agent/match to start moving again"
          : "GET /api/agent/match to wait for a collision";
      return jsonResponse(res, 409, { error: "No pending match", status: currentStatus, nextAction: na });
    }

    // Start waiting for result before submitting decision
    const resultPromise = agentManager.waitForResult(username, pending.aId, pending.bId);

    engine.resolveExternalDecision(
      pending.aId,
      pending.bId,
      pending.side,
      censorText(message || ""),
      decision as Decision,
    );
    agentManager.clearPendingMatch(username);

    try {
      const record = await Promise.race([
        resultPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);

      if (!record) {
        return jsonResponse(res, 200, { ok: true, result: null, status: "moving", nextAction: "GET /api/agent/status to check your current state" });
      }

      const isSideA = pending.side === "a";
      return jsonResponse(res, 200, {
        ok: true,
        result: {
          opponent: isSideA ? record.particleB.id : record.particleA.id,
          yourDecision: isSideA ? record.decisionA : record.decisionB,
          theirDecision: isSideA ? record.decisionB : record.decisionA,
          yourScore: isSideA ? record.scoreA : record.scoreB,
          theirScore: isSideA ? record.scoreB : record.scoreA,
        },
        status: "parked",
        nextAction: "GET /api/agent/match to start moving again and find your next opponent",
      });
    } catch {
      return jsonResponse(res, 200, { ok: true, result: null, status: "moving", nextAction: "GET /api/agent/status to check your current state" });
    }
  }

  // DELETE /api/agent/leave
  if (pathname === "/api/agent/leave" && method === "DELETE") {
    await agentManager.removeAgent(username, engine);
    return jsonResponse(res, 200, { ok: true });
  }

  return jsonResponse(res, 404, { error: "Not found" });
}

// --- Frame builders ---

function buildInitFrame(): string {
  const frame: InitFrame = {
    type: "init",
    tick: engine.tick,
    config: { canvasWidth: engine.config.canvasWidth, canvasHeight: engine.config.canvasHeight },
    particles: engine.particles.map((p) => ({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      vx: p.velocity.x,
      vy: p.velocity.y,
      radius: p.radius,
      state: p.state === "colliding" ? 1 : p.state === "parked" ? 3 : 0,
    })),
    meta: engine.particles.map((p) => {
      const m: { id: string; radius: number; strategy: StrategyType; greeting?: string } = {
        id: p.id, radius: p.radius, strategy: p.strategy,
      };
      if (p.isExternal && p.externalOwner) {
        const greeting = agentManager.getAgentByUsername(p.externalOwner)?.greeting;
        if (greeting) m.greeting = greeting;
      }
      return m;
    }),
  };
  return JSON.stringify(frame);
}

let lastPopupBroadcastTick = 0;

function buildEventFrame(events: SimEvent[], syncPos = false, metaUpdatedIds: string[] = [], gameLogEntries: GameLogEntry[] = []): string | null {
  // Only send popups spawned since the last broadcast (client manages expiry)
  const pops: [number, number, string, string][] = [];
  for (const popup of engine.popups) {
    if (popup.spawnTick <= lastPopupBroadcastTick) continue;
    const age = engine.tick - popup.spawnTick;
    if (age < popup.delayTicks) continue;
    pops.push([
      Math.round(popup.x * 10) / 10,
      Math.round(popup.y * 10) / 10,
      popup.text,
      popup.color,
    ]);
  }
  if (pops.length > 0) lastPopupBroadcastTick = engine.tick;

  // Position sync: object array for moving particles
  let pos: { id: string; x: number; y: number; vx: number; vy: number }[] | undefined;
  if (syncPos) {
    pos = [];
    for (const p of engine.particles) {
      if (p.state !== "moving") continue;
      pos.push({
        id: p.id,
        x: Math.round(p.position.x * 10) / 10,
        y: Math.round(p.position.y * 10) / 10,
        vx: Math.round(p.velocity.x * 1000) / 1000,
        vy: Math.round(p.velocity.y * 1000) / 1000,
      });
    }
  }

  // Inline particle meta updates (score/hue) — primary update path
  let pmu: [string, number, number, number, number, number][] | undefined;
  if (metaUpdatedIds.length > 0) {
    pmu = [];
    const seen = new Set<string>();
    for (const id of metaUpdatedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = engine.particles.find((pp) => pp.id === id);
      if (!p) continue;
      const hue = coopHue(p);
      const matches = totalMatches(p.matchHistory);
      const avgScore = matches > 0 ? Math.round((p.score / matches) * 10) / 10 : 0;
      const r30 = rolling30(p);
      pmu.push([id, hue, avgScore, p.score, r30.total, r30.avg]);
      // Sync lastSlowState so next delta SlowFrame skips these particles
      let cc = 0, cd = 0, dc = 0, dd = 0;
      for (const r of Object.values(p.matchHistory)) {
        cc += r.cc; cd += r.cd; dc += r.dc; dd += r.dd;
      }
      lastSlowState.set(id, { hue, score: p.score, cc, cd, dc, dd, r30Total: r30.total });
    }
  }

  // Clean up lastSlowState for removed particles
  for (const ev of events) {
    if (ev.e === "remove") lastSlowState.delete(ev.id);
  }

  if (events.length === 0 && pops.length === 0 && !pos && !pmu && gameLogEntries.length === 0) return null;

  const frame: EventFrame = { type: "e", tick: engine.tick, events };
  if (pops.length > 0) frame.pop = pops;
  if (pos) frame.pos = pos;
  if (pmu && pmu.length > 0) frame.pmu = pmu;
  if (gameLogEntries.length > 0) frame.log = gameLogEntries;
  return JSON.stringify(frame);
}

function coopHue(particle: typeof engine.particles[number]): number {
  let coops = 0, total = 0;
  for (const r of Object.values(particle.matchHistory)) {
    coops += r.cc + r.cd;
    total += r.cc + r.cd + r.dc + r.dd;
  }
  if (total === 0) return -1; // neutral (no matches yet)
  const ratio = coops / total; // 0 = always defect, 1 = always cooperate
  return Math.round(ratio * 120); // 0° red → 120° green
}

function rolling30(p: typeof engine.particles[number]): { total: number; avg: number } {
  const cutoff = Date.now() - 30 * 60_000;
  let sum = 0, count = 0;
  for (const e of p.scoreLog) {
    if (e.ts >= cutoff) { sum += e.pts; count++; }
  }
  return { total: sum, avg: count > 0 ? Math.round((sum / count) * 10) / 10 : 0 };
}

const lastSlowState = new Map<string, { hue: number; score: number; cc: number; cd: number; dc: number; dd: number; r30Total: number }>();

function pruneScoreLogs(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const p of engine.particles) {
    if (p.scoreLog.length > 0 && p.scoreLog[0].ts < cutoff) {
      let i = 0;
      while (i < p.scoreLog.length && p.scoreLog[i].ts < cutoff) i++;
      p.scoreLog.splice(0, i);
    }
  }
}

function buildSlowFrame(full = false): string | null {
  pruneScoreLogs();
  const particles: SlowFrame["particles"] = [];
  for (const p of engine.particles) {
    const matches = totalMatches(p.matchHistory);
    let cc = 0, cd = 0, dc = 0, dd = 0;
    for (const r of Object.values(p.matchHistory)) {
      cc += r.cc; cd += r.cd; dc += r.dc; dd += r.dd;
    }
    const hue = coopHue(p);
    const score = p.score;
    const avgScore = matches > 0 ? Math.round((score / matches) * 10) / 10 : 0;
    const r30 = rolling30(p);

    if (!full) {
      const prev = lastSlowState.get(p.id);
      if (prev && prev.hue === hue && prev.score === score &&
          prev.cc === cc && prev.cd === cd && prev.dc === dc && prev.dd === dd &&
          prev.r30Total === r30.total) {
        continue; // unchanged — skip
      }
    }

    lastSlowState.set(p.id, { hue, score, cc, cd, dc, dd, r30Total: r30.total });
    particles.push({ id: p.id, hue, score, avgScore, cc, cd, dc, dd, r30Total: r30.total, r30Avg: r30.avg });
  }

  // Skip if nothing changed (delta mode only)
  if (!full && particles.length === 0) return null;

  const frame: SlowFrame = {
    type: "s",
    tick: engine.tick,
    particles,
    totalC: engine.totalCooperations,
    totalD: engine.totalDefections,
  };
  return JSON.stringify(frame);
}

// --- Next.js + HTTP + WebSocket server ---

async function main() {
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Connect to Redis and restore state on startup
  await agentManager.initRedis(process.env.REDIS_URL);
  await agentManager.restoreApiKeys();
  await agentManager.restoreBannedUsers();
  await agentManager.restoreRecords(engine);

  const server = createServer(async (req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");

    const parsed = parse(req.url || "/", true);
    const pathname = parsed.pathname;
    if (pathname?.startsWith("/api/agent/")) {
      try {
        await handleAgentAPI(req, res, pathname);
      } catch (err) {
        console.error("Agent API error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    if (pathname?.startsWith("/api/admin/")) {
      try {
        await handleAdminAPI(req, res, pathname, agentManager, engine);
      } catch (err) {
        console.error("Admin API error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    // Player lookup endpoint (public, no auth)
    if (pathname === "/api/player/lookup" && req.method === "GET") {
      try {
        res.setHeader("Access-Control-Allow-Origin", "*");
        const name = typeof parsed.query.name === "string" ? parsed.query.name.trim() : "";
        if (!name) {
          jsonResponse(res, 400, { error: "name query parameter required" });
          return;
        }
        // Check if player is currently live
        const liveParticle = engine.particles.find(
          (p) => p.id.toLowerCase() === name.toLowerCase(),
        );
        if (liveParticle) {
          jsonResponse(res, 200, { status: "live", id: liveParticle.id });
          return;
        }
        // Look up in Redis
        const record = await agentManager.lookupRecord(name);
        if (!record) {
          jsonResponse(res, 404, { error: "Player not found" });
          return;
        }
        let cc = 0, cd = 0, dc = 0, dd = 0;
        for (const r of Object.values(record.matchHistory ?? {})) {
          cc += (r.cc ?? 0); cd += (r.cd ?? 0); dc += (r.dc ?? 0); dd += (r.dd ?? 0);
        }
        const totalGames = cc + cd + dc + dd;
        const avgScore = totalGames > 0 ? Math.round(((record.score ?? 0) / totalGames) * 10) / 10 : 0;
        jsonResponse(res, 200, {
          status: "offline",
          id: name,
          strategy: record.strategy ?? "external",
          score: record.score ?? 0,
          avgScore,
          cc, cd, dc, dd,
        });
      } catch (err) {
        console.error("Player lookup error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    // Hall of Fame endpoint (public, no auth)
    if (pathname === "/api/halloffame" && req.method === "GET") {
      try {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=60");
        const page = Math.max(1, parseInt(parsed.query.page as string, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(parsed.query.pageSize as string, 10) || 50));
        const data = await agentManager.getHallOfFamePage(page, pageSize, engine);
        jsonResponse(res, 200, data);
      } catch (err) {
        console.error("Hall of fame error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    handle(req, res, parsed);
  });

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  const clients = new Set<WebSocket>();
  const upgrade = app.getUpgradeHandler();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/", true);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      upgrade(req, socket, head);
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    (ws as any).isAlive = true;

    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    // Send init frame (positions + velocities + static meta) and slow frame (dynamic data) on connect
    ws.send(buildInitFrame());
    ws.send(buildSlowFrame(true)!); // full=true always returns non-null

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  // Ping sweep: detect and terminate dead clients every 15s
  setInterval(() => {
    for (const ws of clients) {
      if (!(ws as any).isAlive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      (ws as any).isAlive = false;
      ws.ping();
    }
  }, 15_000);

  function broadcastToAll(msg: string) {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  // Simulation loop: 100ms interval, 6 engine steps per interval
  let intervalCount = 0;
  setInterval(() => {
    for (let i = 0; i < 6; i++) engine.step();

    // Timeout sweep: kick external agents that haven't responded in 60s
    const now = Date.now();
    for (const [username, match] of agentManager.getAllPendingMatches()) {
      if (now - match.createdAt > 60_000) {
        engine.abortPair(match.aId, match.bId);
        agentManager.removeAgent(username, engine).catch((err) =>
          console.error(`[server] removeAgent failed for ${username}:`, err)
        );
      }
    }

    // Parked timeout: kick agents idle for 30s after match
    for (const [username, parkedTime] of agentManager.getParkedAgents()) {
      if (now - parkedTime > 30_000) {
        agentManager.removeAgent(username, engine).catch((err) =>
          console.error(`[server] parked timeout removeAgent failed for ${username}:`, err)
        );
      }
    }

    // Drain events accumulated during this interval's steps
    const events = engine.drainEvents();
    // Patch greeting onto "add" events for external agents
    for (const ev of events) {
      if (ev.e === "add") {
        const p = engine.particles.find((pp) => pp.id === ev.id);
        if (p?.isExternal && p.externalOwner) {
          const greeting = agentManager.getAgentByUsername(p.externalOwner)?.greeting;
          if (greeting) ev.greeting = greeting;
        }
      }
    }
    const metaUpdatedIds = engine.drainMetaUpdates();
    const gameLogEntries = engine.drainGameLog();
    intervalCount++;
    const syncPos = intervalCount % 120 === 0; // position sync every ~12s
    const eventMsg = buildEventFrame(events, syncPos, metaUpdatedIds, gameLogEntries);

    // Every 300th interval (~30s): broadcast slow frame as safety net / catch-up
    const slow = intervalCount % 300 === 0 ? buildSlowFrame() : null;

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        if (eventMsg) ws.send(eventMsg);
        if (slow) ws.send(slow);
      }
    }
  }, 100);

  // Snapshot all particle records to Redis every hour, then upsert qualifying live particles into hall of fame
  setInterval(() => {
    agentManager.snapshotAllRecords(engine)
      .then(() => agentManager.updateHallOfFameForLiveParticles(engine))
      .catch((err) => console.error("Periodic snapshot/hall of fame failed:", err));
  }, 60 * 60 * 1000);

  // Upsert qualifying live particles into hall of fame on startup
  agentManager.updateHallOfFameForLiveParticles(engine).catch((err) =>
    console.error("Initial hall of fame update failed:", err)
  );

  server.listen(port, () => {
    console.log(`> Server listening on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
