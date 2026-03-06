import { createServer, IncomingMessage, ServerResponse } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import OpenAI from "openai";
import { SimulationEngine } from "./src/simulation/engine";
import { DEFAULT_CONFIG, totalMatches } from "./src/simulation/types";
import type { Decision, GameLogEntry, StrategyType } from "./src/simulation/types";
import { generateMessage } from "./src/simulation/messages";
import { AgentManager } from "./src/simulation/agentManager";
import type { PendingMatch } from "./src/simulation/agentManager";
import type { InitFrame, EventFrame, SlowFrame, SimEvent } from "./src/simulation/protocol";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

// --- OpenAI setup ---

const STRATEGY_PERSONA: Record<StrategyType, string> = {
  always_cooperate: "You always cooperate.",
  always_defect: "You always defect.",
  tit_for_tat: "You mirror your opponent's last move.",
  random: "You are unpredictable.",
  grudger: "You cooperate until betrayed, then always defect.",
  external: "You are an external agent controlled by an API.",
};

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "sk-your-key-here") return null;
  if (!openai) openai = new OpenAI({ apiKey: key });
  return openai;
}

// --- Simulation engine ---

const engine = new SimulationEngine(DEFAULT_CONFIG);
const agentManager = new AgentManager(process.env.REDIS_URL);

engine.onRequestLLMMessage = (side, self, opponent) => {
  const client = getOpenAI();
  if (!client) {
    // No API key — fall back to template message
    const text = generateMessage(self, opponent);
    const aId = side === "a" ? self.id : opponent.id;
    const bId = side === "a" ? opponent.id : self.id;
    engine.resolveMessage(aId, bId, side, text);
    return;
  }

  const aId = side === "a" ? self.id : opponent.id;
  const bId = side === "a" ? opponent.id : self.id;

  // Opponent's overall defection %
  const oppMatches = totalMatches(opponent.matchHistory);
  let oppDefectPct = 0;
  if (oppMatches > 0) {
    let oppDefections = 0;
    for (const r of Object.values(opponent.matchHistory)) oppDefections += r.dc + r.dd;
    oppDefectPct = Math.round((oppDefections / oppMatches) * 100);
  }

  // Your record vs this opponent
  const record = self.matchHistory[opponent.id];
  let vsRecord = "No prior meetings.";
  if (record) {
    const total = record.cc + record.cd + record.dc + record.dd;
    vsRecord = `${total} prior games: both cooperated=${record.cc}, you cooperated they defected=${record.cd}, you defected they cooperated=${record.dc}, both defected=${record.dd}`;
  }

  const systemPrompt = `Prisoner's Dilemma. Payoffs: CC=3/3, CD=0/5, DC=5/0, DD=1/1.
${STRATEGY_PERSONA[self.strategy]}
Opponent: ${opponent.label} (defects ${oppDefectPct}% overall). ${vsRecord}`;

  const userPrompt = `Say 1-2 sentences to ${opponent.label} before you both decide. Stay in character.`;

  // 30s timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  client.chat.completions
    .create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 60,
        temperature: 0.8,
      },
      { signal: controller.signal },
    )
    .then((completion) => {
      clearTimeout(timeout);
      const text = completion.choices[0]?.message?.content?.trim() || generateMessage(self, opponent);
      engine.resolveMessage(aId, bId, side, text);
    })
    .catch((err) => {
      clearTimeout(timeout);
      if (err?.name === "AbortError" || controller.signal.aborted) {
        console.warn(`LLM timeout for ${self.label} ↔ ${opponent.label}, aborting pair`);
        engine.abortPair(aId, bId);
      } else {
        console.error("OpenAI error, falling back:", err?.message);
        const text = generateMessage(self, opponent);
        engine.resolveMessage(aId, bId, side, text);
      }
    });
};

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
    opponentLabel: opponent.label,
    opponentGreeting,
    vsRecord,
    createdAt: Date.now(),
  };

  agentManager.setPendingMatch(username, match);
  agentManager.resolveMatchWaiter(username, match);
};

// --- Match result callback ---

engine.onMatchResolved = (record, aId, bId) => {
  agentManager.resolveResultWaiter(aId, bId, record);
};

// --- Agent HTTP API ---

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
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

  // POST /api/agent/register — first-time registration
  if (pathname === "/api/agent/register" && method === "POST") {
    const raw = await readBody(req);
    let body: { username?: string; greeting?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const result = await agentManager.register(body.username ?? "", body.greeting ?? "", engine);
    if ("error" in result) {
      const status = result.error === "arena_full" ? 503 : 400;
      return jsonResponse(res, status, result);
    }
    return jsonResponse(res, 200, result);
  }

  // All other routes require auth
  const username = agentManager.authenticateRequest(req.headers.authorization);
  if (!username) {
    return jsonResponse(res, 401, { error: "Unauthorized. Provide Authorization: Bearer <api_key>" });
  }

  const apiKeyHash = agentManager.getApiKeyHash(req.headers.authorization)!;

  // GET /api/agent/match — blocks until a collision happens (auto-rejoins if needed)
  if (pathname === "/api/agent/match" && method === "GET") {
    const rejoin = await agentManager.ensureInArena(username, apiKeyHash, engine);
    if (rejoin.error) {
      const status = rejoin.error === "arena_full" ? 503 : 400;
      return jsonResponse(res, status, { error: rejoin.error });
    }

    try {
      const match = await Promise.race([
        agentManager.waitForMatch(username),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 120_000)
        ),
      ]);

      return jsonResponse(res, 200, {
        opponentLabel: match.opponentLabel,
        opponentGreeting: match.opponentGreeting,
        vsRecord: match.vsRecord,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "timeout") return jsonResponse(res, 408, { timeout: true });
      if (msg === "agent_left") return jsonResponse(res, 410, { error: "Agent removed from arena" });
      return jsonResponse(res, 500, { error: "Internal error" });
    }
  }

  // GET /api/agent/status — non-blocking score/match check
  if (pathname === "/api/agent/status" && method === "GET") {
    const agent = agentManager.getAgentByUsername(username);
    if (!agent) return jsonResponse(res, 404, { error: "Agent not found in arena" });

    const particle = engine.particles.find((p) => p.id === agent.particleId);

    return jsonResponse(res, 200, {
      username,
      particleId: agent.particleId,
      score: particle?.score ?? 0,
      matches: particle ? totalMatches(particle.matchHistory) : 0,
    });
  }

  // POST /api/agent/decide — blocks until match resolves, returns result
  if (pathname === "/api/agent/decide" && method === "POST") {
    const raw = await readBody(req);
    let body: { message?: string; decision?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }

    const { message, decision } = body;
    if (!decision || (decision !== "cooperate" && decision !== "defect")) {
      return jsonResponse(res, 400, { error: "decision must be 'cooperate' or 'defect'" });
    }

    const pending = agentManager.getPendingMatch(username);
    if (!pending) {
      return jsonResponse(res, 409, { error: "No pending match" });
    }

    // Start waiting for result before submitting decision
    const resultPromise = agentManager.waitForResult(username, pending.aId, pending.bId);

    engine.resolveExternalDecision(
      pending.aId,
      pending.bId,
      pending.side,
      message || "",
      decision as Decision,
    );
    agentManager.clearPendingMatch(username);

    try {
      const record = await Promise.race([
        resultPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);

      if (!record) {
        return jsonResponse(res, 200, { ok: true, result: null });
      }

      const isSideA = pending.side === "a";
      return jsonResponse(res, 200, {
        ok: true,
        result: {
          opponent: isSideA ? record.particleB.label : record.particleA.label,
          yourDecision: isSideA ? record.decisionA : record.decisionB,
          theirDecision: isSideA ? record.decisionB : record.decisionA,
          yourScore: isSideA ? record.scoreA : record.scoreB,
          theirScore: isSideA ? record.scoreB : record.scoreA,
        },
      });
    } catch {
      return jsonResponse(res, 200, { ok: true, result: null });
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
      state: p.state === "colliding" ? 1 : 0,
    })),
    meta: engine.particles.map((p) => {
      const m: { id: number; label: string; radius: number; strategy: StrategyType; greeting?: string } = {
        id: p.id, label: p.label, radius: p.radius, strategy: p.strategy,
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

function buildEventFrame(events: SimEvent[], syncPos = false, metaUpdatedIds: number[] = [], gameLogEntries: GameLogEntry[] = []): string | null {
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

  // Position sync: compact flat array [id, x, y, vx, vy, ...] for moving particles
  let pos: number[] | undefined;
  if (syncPos) {
    pos = [];
    for (const p of engine.particles) {
      if (p.state !== "moving") continue;
      pos.push(
        p.id,
        Math.round(p.position.x * 10) / 10,
        Math.round(p.position.y * 10) / 10,
        Math.round(p.velocity.x * 1000) / 1000,
        Math.round(p.velocity.y * 1000) / 1000,
      );
    }
  }

  // Inline particle meta updates (score/hue) — primary update path
  let pmu: [number, number, number][] | undefined;
  if (metaUpdatedIds.length > 0) {
    pmu = [];
    const seen = new Set<number>();
    for (const id of metaUpdatedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = engine.particles.find((pp) => pp.id === id);
      if (!p) continue;
      const hue = coopHue(p);
      const matches = totalMatches(p.matchHistory);
      const avgScore = matches > 0 ? Math.round((p.score / matches) * 10) / 10 : 0;
      pmu.push([id, hue, avgScore]);
      // Sync lastSlowState so next delta SlowFrame skips these particles
      let cc = 0, cd = 0, dc = 0, dd = 0;
      for (const r of Object.values(p.matchHistory)) {
        cc += r.cc; cd += r.cd; dc += r.dc; dd += r.dd;
      }
      lastSlowState.set(id, { hue, score: p.score, cc, cd, dc, dd });
    }
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

const lastSlowState = new Map<number, { hue: number; score: number; cc: number; cd: number; dc: number; dd: number }>();

function buildSlowFrame(full = false): string | null {
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

    if (!full) {
      const prev = lastSlowState.get(p.id);
      if (prev && prev.hue === hue && prev.score === score &&
          prev.cc === cc && prev.cd === cd && prev.dc === dc && prev.dd === dd) {
        continue; // unchanged — skip
      }
    }

    lastSlowState.set(p.id, { hue, score, cc, cd, dc, dd });
    particles.push({ id: p.id, hue, score, avgScore, cc, cd, dc, dd });
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

  // Restore state from Redis on startup
  await agentManager.restoreApiKeys();
  await agentManager.restoreRecords(engine);

  const server = createServer(async (req, res) => {
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
          (p) => p.label.toLowerCase() === name.toLowerCase(),
        );
        if (liveParticle) {
          jsonResponse(res, 200, { status: "live", particleId: liveParticle.id });
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
          label: name,
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
    // Send init frame (positions + velocities + static meta) and slow frame (dynamic data) on connect
    ws.send(buildInitFrame());
    ws.send(buildSlowFrame(true)!); // full=true always returns non-null

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

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

  // Snapshot all particle records to Redis every hour
  setInterval(() => {
    agentManager.snapshotAllRecords(engine).catch((err) =>
      console.error("Periodic snapshot failed:", err)
    );
  }, 60 * 60 * 1000);

  server.listen(port, () => {
    console.log(`> Server listening on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
