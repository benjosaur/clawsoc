import { createServer, IncomingMessage, ServerResponse } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import OpenAI from "openai";
import { SimulationEngine } from "./src/simulation/engine";
import { DEFAULT_CONFIG, totalMatches } from "./src/simulation/types";
import type { Decision, StrategyType } from "./src/simulation/types";
import { generateMessage } from "./src/simulation/messages";
import { AgentManager } from "./src/simulation/agentManager";
import type { InitFrame, EventFrame, SlowFrame, SimEvent, ClientMessage } from "./src/simulation/protocol";

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
let paused = false;

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

  // Compute opponent defect %
  const oppMatches = totalMatches(opponent.matchHistory);
  let oppDefectPct = 0;
  if (oppMatches > 0) {
    let oppDefections = 0;
    for (const r of Object.values(opponent.matchHistory)) oppDefections += r.dc + r.dd;
    oppDefectPct = Math.round((oppDefections / oppMatches) * 100);
  }

  agentManager.setPendingMatch(username, {
    aId,
    bId,
    side,
    opponentLabel: opponent.label,
    opponentStrategy: opponent.strategy,
    opponentDefectPct: oppDefectPct,
    createdAt: Date.now(),
  });
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

  // POST /api/agent/register
  if (pathname === "/api/agent/register" && method === "POST") {
    const raw = await readBody(req);
    let body: { username?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const result = await agentManager.register(body.username ?? "", engine);
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

  // GET /api/agent/status
  if (pathname === "/api/agent/status" && method === "GET") {
    const agent = agentManager.getAgentByUsername(username);
    if (!agent) return jsonResponse(res, 404, { error: "Agent not found" });

    const particle = engine.particles.find((p) => p.id === agent.particleId);
    const pending = agentManager.getPendingMatch(username);

    return jsonResponse(res, 200, {
      username,
      particleId: agent.particleId,
      score: particle?.score ?? 0,
      matches: particle ? totalMatches(particle.matchHistory) : 0,
      pendingMatch: pending
        ? {
            opponentLabel: pending.opponentLabel,
            opponentStrategy: pending.opponentStrategy,
            opponentDefectPct: pending.opponentDefectPct,
          }
        : null,
    });
  }

  // POST /api/agent/decide
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

    engine.resolveExternalDecision(
      pending.aId,
      pending.bId,
      pending.side,
      message || "",
      decision as Decision,
    );
    agentManager.clearPendingMatch(username);

    return jsonResponse(res, 200, { ok: true });
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
    meta: engine.particles.map((p) => ({
      id: p.id, label: p.label, radius: p.radius, strategy: p.strategy,
    })),
  };
  return JSON.stringify(frame);
}

let lastPopupBroadcastTick = 0;

function buildEventFrame(events: SimEvent[]): string | null {
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

  if (events.length === 0 && pops.length === 0) return null;

  const frame: EventFrame = { type: "e", tick: engine.tick, events };
  if (pops.length > 0) frame.pop = pops;
  return JSON.stringify(frame);
}

function coopColor(particle: typeof engine.particles[number]): string {
  let coops = 0, total = 0;
  for (const r of Object.values(particle.matchHistory)) {
    coops += r.cc + r.cd;
    total += r.cc + r.cd + r.dc + r.dd;
  }
  if (total === 0) return "hsl(60,50%,45%)"; // neutral amber before any matches
  const ratio = coops / total; // 0 = always defect, 1 = always cooperate
  const hue = ratio * 120;     // 0° red → 120° green
  return `hsl(${Math.round(hue)},70%,42%)`;
}

let lastSlowLogIndex = 0;

function buildSlowFrame(full = false): string {
  const particles = engine.particles.map((p) => {
    const matches = totalMatches(p.matchHistory);
    let cc = 0, cd = 0, dc = 0, dd = 0;
    for (const r of Object.values(p.matchHistory)) {
      cc += r.cc; cd += r.cd; dc += r.dc; dd += r.dd;
    }
    return {
      id: p.id,
      color: coopColor(p),
      score: p.score,
      avgScore: matches > 0 ? Math.round((p.score / matches) * 10) / 10 : 0,
      cc, cd, dc, dd,
    };
  });

  // On connect: send recent log. On broadcast: send only new entries.
  const logEntries = full
    ? engine.gameLog.slice(-50)
    : engine.gameLog.slice(lastSlowLogIndex);
  if (!full) lastSlowLogIndex = engine.gameLog.length;

  const frame: SlowFrame = {
    type: "s",
    tick: engine.tick,
    particles,
    gameLog: logEntries,
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

  // Restore particle records from Redis on startup
  await agentManager.restoreRecords(engine);

  const server = createServer(async (req, res) => {
    const { pathname } = parse(req.url || "/", true);
    if (pathname?.startsWith("/api/agent/")) {
      try {
        await handleAgentAPI(req, res, pathname);
      } catch (err) {
        console.error("Agent API error:", err);
        jsonResponse(res, 500, { error: "Internal server error" });
      }
      return;
    }
    handle(req, res, parse(req.url || "/", true));
  });

  const wss = new WebSocketServer({ noServer: true });
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
    ws.send(buildSlowFrame(true));

    ws.on("message", (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        switch (msg.type) {
          case "pause":
            paused = true;
            break;
          case "resume":
            paused = false;
            break;
          case "reset":
            engine.reset();
            agentManager.reRegisterAfterReset(engine);
            paused = false;
            lastSlowLogIndex = 0;
            // Broadcast new init frame to all clients
            broadcastToAll(buildInitFrame());
            break;
        }
      } catch {
        // ignore malformed messages
      }
    });

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
    if (!paused) {
      for (let i = 0; i < 6; i++) engine.step();
    }

    // Timeout sweep: kick external agents that haven't responded in 60s
    const now = Date.now();
    for (const [username, match] of agentManager.getAllPendingMatches()) {
      if (now - match.createdAt > 60_000) {
        engine.abortPair(match.aId, match.bId);
        agentManager.removeAgent(username, engine);
      }
    }

    // Drain events accumulated during this interval's steps
    const events = engine.drainEvents();
    const eventMsg = buildEventFrame(events);

    // Every 30th interval (~3s): broadcast slow frame + persist scores
    intervalCount++;
    const slow = intervalCount % 30 === 0 ? buildSlowFrame() : null;
    if (intervalCount % 30 === 0) agentManager.snapshotAllRecords(engine);

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        if (eventMsg) ws.send(eventMsg);
        if (slow) ws.send(slow);
      }
    }
  }, 100);

  server.listen(port, () => {
    console.log(`> Server listening on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
