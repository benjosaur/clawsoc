import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import OpenAI from "openai";
import { SimulationEngine } from "./src/simulation/engine";
import { DEFAULT_CONFIG, totalMatches } from "./src/simulation/types";
import type { StrategyType } from "./src/simulation/types";
import { generateMessage } from "./src/simulation/messages";
import type { FastFrame, SlowFrame, ClientMessage } from "./src/simulation/protocol";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

// --- OpenAI setup ---

const SYSTEM_PROMPTS: Record<StrategyType, string> = {
  always_cooperate:
    "You are a deeply trusting, cooperative agent who always seeks mutual benefit.",
  always_defect:
    "You are a ruthless, self-interested agent who always prioritizes your own gain.",
  tit_for_tat:
    "You are a fair, reciprocal agent. You mirror how others treat you.",
  random:
    "You are unpredictable and chaotic. Your mood changes constantly.",
  grudger:
    "You start trusting but never forgive betrayal. You hold grudges forever.",
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

  const record = self.matchHistory[opponent.id];
  let historyContext = "";
  if (record) {
    const parts: string[] = [];
    if (record.cc > 0) parts.push(`${record.cc}x both cooperated`);
    if (record.cd > 0) parts.push(`${record.cd}x you cooperated, they defected`);
    if (record.dc > 0) parts.push(`${record.dc}x you defected, they cooperated`);
    if (record.dd > 0) parts.push(`${record.dd}x both defected`);
    if (parts.length > 0) {
      historyContext = ` Your past interactions with ${opponent.label}: ${parts.join(". ")}.`;
    }
  }

  const userPrompt = `You are ${self.label}, meeting ${opponent.label} in a Prisoner's Dilemma game.${historyContext} Generate a short message (1-2 sentences) to say to them before you both make your decision. Stay in character. Do not mention the game mechanics directly.`;

  // 30s timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  client.chat.completions
    .create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[self.strategy] },
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

// --- Frame builders ---

function buildFastFrame(): string {
  const positions: FastFrame["p"] = engine.particles.map((p) => [
    p.id,
    Math.round(p.position.x * 10) / 10,
    Math.round(p.position.y * 10) / 10,
    p.state === "colliding" ? 1 : 0,
  ]);

  // Send all active popups — client deduplicates by position
  const pops: [number, number, string, string][] = [];
  for (const popup of engine.popups) {
    const age = engine.tick - popup.spawnTick;
    if (age < popup.delayTicks) continue;
    pops.push([
      Math.round(popup.x * 10) / 10,
      Math.round(popup.y * 10) / 10,
      popup.text,
      popup.color,
    ]);
  }

  const frame: FastFrame = { type: "f", t: engine.tick, p: positions };
  if (pops.length > 0) frame.pop = pops;
  return JSON.stringify(frame);
}

function buildSlowFrame(): string {
  const particles = engine.particles.map((p) => {
    const matches = totalMatches(p.matchHistory);
    return {
      id: p.id,
      label: p.label,
      color: p.color,
      radius: p.radius,
      score: p.score,
      avgScore: matches > 0 ? Math.round((p.score / matches) * 10) / 10 : 0,
      strategy: p.strategy,
    };
  });

  const frame: SlowFrame = {
    type: "s",
    particles,
    gameLog: engine.gameLog.slice(-50),
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

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || "/", true));
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/", true);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    // Send immediate slow frame so client gets metadata right away
    ws.send(buildSlowFrame());
    ws.send(buildFastFrame());

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
            paused = false;
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

  // Simulation loop: 100ms interval (10fps broadcast), 6 engine steps per interval
  let intervalCount = 0;
  setInterval(() => {
    if (!paused) {
      for (let i = 0; i < 6; i++) engine.step();
    }

    const fast = buildFastFrame();

    // Every 10th interval (~1/sec): also broadcast slow frame
    intervalCount++;
    const slow = intervalCount % 10 === 0 ? buildSlowFrame() : null;

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(fast);
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
