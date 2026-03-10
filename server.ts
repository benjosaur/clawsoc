import { readFileSync } from "fs";
import { createServer, IncomingMessage, ServerResponse } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";

// Load .env before anything reads process.env
try {
  const envFile = readFileSync(".env", "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // no .env file, that's fine
}
import { SimulationEngine } from "./src/simulation/engine";
import { DEFAULT_CONFIG, totalMatches } from "./src/simulation/types";
import type { ConversationTurn, Decision, GameLogEntry } from "./src/simulation/types";
import { AgentManager } from "./src/simulation/agentManager";
import { handleAdminAPI } from "./src/simulation/adminApi";
import { censorText } from "./src/simulation/profanity";
import { agentApiLimiter, registerLimiter, adminLimiter, publicApiLimiter } from "./src/simulation/rateLimit";
import type { PendingMatch } from "./src/simulation/agentManager";
import type { InitFrame, EventFrame, SlowFrame, SimEvent } from "./src/simulation/protocol";
import { initLlm, requestLlmMessage } from "./src/simulation/llm";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

// --- Simulation engine ---

const config = DEFAULT_CONFIG;
const engine = new SimulationEngine(config);
const agentManager = new AgentManager(config);

// --- External agent turn callback ---

engine.onRequestExternalTurn = (aId, bId, side, self, opponent, conversationSoFar, forcedDecide) => {
  const username = self.externalOwner;
  if (!username) return;

  const rec = self.matchHistory[opponent.id];
  const vsRecord = rec
    ? { cc: rec.cc, cd: rec.cd, dc: rec.dc, dd: rec.dd }
    : null;

  // Filter conversation: hide actual decision values (blind lock-in)
  const sanitizedConversation: ConversationTurn[] = conversationSoFar.map((t) => {
    if (t.type === "decision") {
      return { speaker: t.speaker, type: "decision" as const, content: "" };
    }
    return t;
  });

  const match: PendingMatch = {
    aId,
    bId,
    side,
    opponentId: opponent.id,
    vsRecord,
    conversation: sanitizedConversation,
    forcedDecide,
    createdAt: Date.now(),
  };

  agentManager.setPendingMatch(username, match);
  // Resolve whichever waiter is active: GET /match or POST /turn
  agentManager.resolveMatchWaiter(username, match);
  agentManager.resolveTurnWaiter(username, match);
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

// --- LLM bot message callback ---

const llmEnabled = initLlm();
if (llmEnabled) {
  console.log("[server] LLM enabled — bot messages will use gpt-4o-mini");
  engine.onRequestBotLlmMessage = (aId, bId, side, self, opponent, conversationSoFar) => {
    requestLlmMessage(self, opponent, side, conversationSoFar)
      .then((content) => {
        engine.resolveExternalTurn(aId, bId, side, "message", content);
      })
      .catch((err) => {
        console.error(`[llm] Failed for ${self.id}:`, err);
        engine.resolveExternalTurn(aId, bId, side, "message", "...");
      });
  };
} else {
  console.log("[server] LLM disabled — no OPENAI_API_KEY, using template messages");
}

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

/** Extract latest opponent message and state from a PendingMatch for AI-agent-friendly responses. */
function formatTurnResponse(match: PendingMatch): Record<string, unknown> {
  const opponentSide = match.side === "a" ? "b" : "a";
  let message: string | null = null;
  let opponentLockedIn = false;

  for (const turn of match.conversation) {
    if (turn.speaker === opponentSide) {
      if (turn.type === "decision") opponentLockedIn = true;
      else if (turn.type === "message") message = turn.content;
    }
  }

  return {
    opponent: match.opponentId,
    ...(message !== null && { message }),
    vsRecord: match.vsRecord,
    ...(opponentLockedIn && { opponentLockedIn: true }),
    mustDecide: match.forcedDecide,
    nextAction: match.forcedDecide
      ? "POST /api/agent/turn — you must send {type:'decision', decision:'cooperate'|'defect'}"
      : "POST /api/agent/turn — send {type:'message', content:'...'} or {type:'decision', decision:'cooperate'|'defect'}",
  };
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

  // POST /api/agent/register — first-time registration (does not enter arena)
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
    const result = await agentManager.register(body.username ?? "", clientIp);
    if ("error" in result) {
      return jsonResponse(res, 400, result);
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

    // Guard: already have a pending match — must call /turn or /decide first
    const pending = agentManager.getPendingMatch(username);
    if (pending) {
      return jsonResponse(res, 409, {
        error: "You have a pending match. Submit your action before requesting a new match.",
        status: "pending_match",
        ...formatTurnResponse(pending),
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
    const particle = engine.getParticle(username);
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
          setTimeout(() => reject(new Error("timeout")), config.matchResponseTimeoutMs ?? 120_000)
        ),
      ]);

      return jsonResponse(res, 200, formatTurnResponse(match));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "timeout") return jsonResponse(res, 408, { timeout: true, status: "moving", nextAction: "GET /api/agent/match to try again" });
      if (msg === "agent_left") return jsonResponse(res, 410, { error: "Agent removed from arena", status: "offline", nextAction: "POST /api/agent/register to re-register" });
      return jsonResponse(res, 500, { error: "Internal error" });
    }
  }

  // GET /api/agent/status — non-blocking score/match check
  if (pathname === "/api/agent/status" && method === "GET") {
    const particle = engine.getParticle(username);
    const pending = agentManager.getPendingMatch(username);
    const agent = agentManager.getAgentByUsername(username);

    let status: string;
    let nextAction: string;

    if (pending) {
      status = "pending_match";
      nextAction = "POST /api/agent/turn with { type, content?, decision? }";
    } else if (!particle && agent && agent.displacedId === null) {
      status = "registered";
      nextAction = "GET /api/agent/match to enter the arena";
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
      pendingMatch: pending ? formatTurnResponse(pending) : null,
      nextAction,
    });
  }

  // POST /api/agent/turn — submit a message or decision, blocks for opponent's response
  if (pathname === "/api/agent/turn" && method === "POST") {
    const raw = await readBody(req);
    let body: { type?: string; content?: string; decision?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }

    const turnType = body.type;
    if (turnType !== "message" && turnType !== "decision") {
      return jsonResponse(res, 400, { error: "type must be 'message' or 'decision'" });
    }
    if (turnType === "decision" && body.decision !== "cooperate" && body.decision !== "defect") {
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
      return jsonResponse(res, 409, { error: "No pending match — it's not your turn", status: currentStatus, nextAction: na });
    }

    // Set up result waiter before submitting action
    const resultPromise = agentManager.waitForResult(username, pending.aId, pending.bId);
    agentManager.clearPendingMatch(username);

    // Submit the turn to the engine
    const content = turnType === "message" ? censorText(body.content || "") : "";
    const decision = turnType === "decision" ? (body.decision as Decision) : undefined;
    engine.resolveExternalTurn(pending.aId, pending.bId, pending.side, turnType, content, decision);

    // Wait for either: next turn (opponent responded) or match result (both decided)
    try {
      const turnOrResult = await Promise.race([
        agentManager.waitForTurn(username).then((turn) => ({ kind: "turn" as const, turn })),
        resultPromise.then((record) => ({ kind: "result" as const, record })),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15_000)),
      ]);

      if (turnOrResult.kind === "turn") {
        const nextTurn = turnOrResult.turn;
        return jsonResponse(res, 200, {
          ok: true,
          ...formatTurnResponse(nextTurn),
        });
      } else {
        const record = turnOrResult.record;
        if (!record) {
          return jsonResponse(res, 200, { ok: true, result: null, status: "moving", nextAction: "GET /api/agent/status" });
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
          nextAction: "GET /api/agent/match",
        });
      }
    } catch {
      return jsonResponse(res, 200, { ok: true, result: null, status: "moving", nextAction: "GET /api/agent/status" });
    }
  }

  // POST /api/agent/decide — backwards-compatible shim (immediately locks in decision)
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
      const particle = engine.getParticle(username);
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
      censorText((message || "").trim()),
      decision as Decision,
    );
    agentManager.clearPendingMatch(username);

    try {
      const record = await Promise.race([
        resultPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), config.decideResponseTimeoutMs ?? 15_000)),
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
      return { id: p.id, radius: p.radius, strategy: p.strategy };
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
      const p = engine.getParticle(id);
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

let requestCounter = 0;

async function main() {
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Connect to Redis and restore state on startup
  await agentManager.initRedis(process.env.REDIS_URL);
  await agentManager.restoreApiKeys();
  await agentManager.restoreBannedUsers();
  await agentManager.restoreRecords(engine);

  const clients = new Set<WebSocket>();
  let consecutiveErrors = 0;
  let lastTickTime = Date.now();

  const server = createServer(async (req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");

    const parsed = parse(req.url || "/", true);
    const pathname = parsed.pathname ?? "/";

    // Health check endpoint
    if (pathname === "/health") {
      const now = Date.now();
      const redis = agentManager.getHealthInfo();
      const loopStale = now - lastTickTime > 5000;
      const tooManyErrors = consecutiveErrors >= 10;
      const redisDown = redis.redisExpected && !redis.redisConnected;
      const healthy = !loopStale && !tooManyErrors && !redisDown;
      const status = healthy ? 200 : 503;
      const body: Record<string, unknown> = {
        status: healthy ? "ok" : "unhealthy",
        tick: engine.tick,
        consecutiveErrors,
        redis,
        clients: clients.size,
        uptime: process.uptime(),
      };
      if (loopStale) body.reason = "simulation_loop_stale";
      else if (tooManyErrors) body.reason = "too_many_errors";
      else if (redisDown) body.reason = "redis_disconnected";
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    // Request logging for API routes
    if (pathname.startsWith("/api/")) {
      const start = Date.now();
      const reqId = ++requestCounter;
      const originalEnd = res.end;
      res.end = function (...args: Parameters<typeof originalEnd>) {
        console.log(`[req #${reqId}] ${req.method} ${pathname} → ${res.statusCode} (${Date.now() - start}ms)`);
        return originalEnd.apply(res, args);
      } as typeof res.end;
    }

    if (pathname === "/health") {
      const redis = agentManager.getHealthInfo();
      const healthy = consecutiveErrors < 10 && (!redis.redisExpected || redis.redisConnected);
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: healthy ? "ok" : "degraded",
        simulation: { consecutiveErrors },
        redis,
        clients: clients.size,
        uptime: process.uptime(),
      }));
      return;
    }

    if (pathname.startsWith("/api/agent/")) {
      try {
        await handleAgentAPI(req, res, pathname);
      } catch (err) {
        console.error("Agent API error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    if (pathname.startsWith("/api/admin/")) {
      const clientIp = (req.headers["fly-client-ip"] as string) || req.socket.remoteAddress || "unknown";
      if (!adminLimiter.consume(clientIp)) {
        const retryAfter = adminLimiter.retryAfter(clientIp);
        res.setHeader("Retry-After", String(retryAfter));
        jsonResponse(res, 429, { error: "Too many requests", retryAfter });
        return;
      }
      try {
        await handleAdminAPI(req, res, pathname, agentManager, engine);
      } catch (err) {
        console.error("Admin API error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }

    // Rate limit public read endpoints
    if (pathname === "/api/player/lookup" || pathname === "/api/halloffame") {
      const clientIp = (req.headers["fly-client-ip"] as string) || req.socket.remoteAddress || "unknown";
      if (!publicApiLimiter.consume(clientIp)) {
        const retryAfter = publicApiLimiter.retryAfter(clientIp);
        res.setHeader("Retry-After", String(retryAfter));
        jsonResponse(res, 429, { error: "Too many requests", retryAfter });
        return;
      }
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
        const liveParticle = engine.getParticle(name.toLowerCase());
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
  const pingInterval = setInterval(() => {
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

  const WS_BUFFER_THRESHOLD = 1024 * 1024; // 1MB — skip frames for slow clients

  function broadcastToAll(msg: string) {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < WS_BUFFER_THRESHOLD) {
        ws.send(msg);
      }
    }
  }

  // Simulation loop: 100ms interval, 6 engine steps per interval
  let intervalCount = 0;
  const simInterval = setInterval(() => {
    try {
      for (let i = 0; i < 6; i++) engine.step();
      consecutiveErrors = 0;
      lastTickTime = Date.now();

      // Per-turn timeout: kick offending agent (aborts match with no outcome, writes stats)
      const now = Date.now();
      for (const [username, match] of agentManager.getAllPendingMatches()) {
        if (now - match.createdAt > (config.pendingMatchTimeoutMs ?? 15_000)) {
          agentManager.clearPendingMatch(username);
          agentManager.removeAgent(username, engine).catch((err) =>
            console.error(`[server] timeout kick failed for ${username}:`, err)
          );
        }
      }

      // Parked timeout: kick agents idle after match
      for (const [username, parkedTime] of agentManager.getParkedAgents()) {
        if (now - parkedTime > (config.parkedAgentTimeoutMs ?? 30_000)) {
          agentManager.removeAgent(username, engine).catch((err) =>
            console.error(`[server] parked timeout removeAgent failed for ${username}:`, err)
          );
        }
      }

      // Drain events accumulated during this interval's steps
      const events = engine.drainEvents();
      const metaUpdatedIds = engine.drainMetaUpdates();
      const gameLogEntries = engine.drainGameLog();
      intervalCount++;
      const syncPos = intervalCount % (config.positionSyncInterval ?? 120) === 0;
      const eventMsg = buildEventFrame(events, syncPos, metaUpdatedIds, gameLogEntries);

      // Periodic slow frame broadcast as safety net / catch-up
      const slow = intervalCount % (config.slowFrameInterval ?? 300) === 0 ? buildSlowFrame() : null;

      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < WS_BUFFER_THRESHOLD) {
          if (eventMsg) ws.send(eventMsg);
          if (slow) ws.send(slow);
        }
      }
    } catch (err) {
      consecutiveErrors++;
      console.error(`[server] simulation loop error (${consecutiveErrors} consecutive):`, err);
      if (consecutiveErrors >= 50) {
        console.error("[server] 50 consecutive simulation errors — exiting for restart");
        process.exit(1);
      }
    }
  }, config.simulationIntervalMs ?? 100);

  // Snapshot all particle records to Redis periodically, then upsert qualifying live particles into hall of fame
  const snapshotInterval = setInterval(() => {
    agentManager.snapshotAllRecords(engine)
      .then(() => agentManager.updateHallOfFameForLiveParticles(engine))
      .catch((err) => console.error("Periodic snapshot/hall of fame failed:", err));
  }, config.hofSnapshotIntervalMs ?? 3_600_000);

  // Upsert qualifying live particles into hall of fame on startup
  agentManager.updateHallOfFameForLiveParticles(engine).catch((err) =>
    console.error("Initial hall of fame update failed:", err)
  );

  server.listen(port, () => {
    console.log(`> Server listening on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });

  // --- Graceful shutdown ---
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — shutting down gracefully...`);

    // 1. Stop simulation and periodic tasks
    clearInterval(simInterval);
    clearInterval(pingInterval);
    clearInterval(snapshotInterval);

    // 2. Flush state to Redis
    try {
      await agentManager.snapshotAllRecords(engine);
      await agentManager.updateHallOfFameForLiveParticles(engine);
      console.log("[server] Redis snapshot complete");
    } catch (err) {
      console.error("[server] Redis snapshot failed during shutdown:", err);
    }

    // 3. Close WebSocket clients with close frame
    for (const ws of clients) {
      ws.close(1001, "Server shutting down");
    }
    wss.close();

    // 4. Close Redis connection
    try {
      await agentManager.closeRedis();
    } catch (err) {
      console.error("[server] Redis close failed:", err);
    }

    // 5. Drain HTTP server
    server.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10s if drain stalls
    setTimeout(() => {
      console.error("[server] Forced exit after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
