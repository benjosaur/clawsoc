import OpenAI from "openai";
import type { Particle, ConversationTurn, StrategyType } from "./types";
import { totalMatches } from "./types";
import { generateConversationMessage } from "./messages";
import { CHARACTER_BLURBS } from "./characterBlurbs";

let client: OpenAI | null = null;

// Circuit breaker: after repeated failures, skip API calls for a cooldown period
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 10 * 60_000; // 10 minutes

export function initLlm(): boolean {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  client = new OpenAI({ apiKey: key });
  return true;
}

export function isLlmEnabled(): boolean {
  return client !== null;
}

const STRATEGY_PERSONALITY: Record<StrategyType, string> = {
  always_cooperate:
    "You are deeply idealistic and believe cooperation is always the right path. " +
    "You trust others even when they have betrayed you. You advocate for mutual benefit " +
    "and try to persuade your opponent to cooperate.",
  always_defect:
    "You are ruthless and self-serving. You see cooperation as weakness. " +
    "You may taunt, threaten, or dismiss your opponent. You are curt and domineering. " +
    "Trust means nothing to you.",
  tit_for_tat:
    "You believe in reciprocity and fairness. You start by assuming good faith, " +
    "but you will mirror whatever your opponent does. If they cooperated last time, you are warm. " +
    "If they defected, you are cold and warn them.",
  random:
    "You are unpredictable, chaotic, and whimsical. You might be friendly one moment and hostile the next. " +
    "You enjoy keeping your opponent guessing. You are theatrical, enigmatic, and sometimes contradictory.",
  grudger:
    "You start with trust and goodwill, but if someone has EVER betrayed you, you become permanently hostile. " +
    "You have a long memory and never forgive. If this opponent has never betrayed you, you are warm and cooperative. " +
    "If they have betrayed you even once, you are cold and unforgiving.",
  external: "You are calculating and analytical.",
};

function buildSystemPrompt(self: Particle, opponent: Particle): string {
  const history = self.matchHistory[opponent.id];
  const totalGames = totalMatches(self.matchHistory);

  let totalCoops = 0, totalAll = 0;
  for (const r of Object.values(self.matchHistory)) {
    totalCoops += r.cc + r.cd; // times I cooperated
    totalAll += r.cc + r.cd + r.dc + r.dd;
  }
  const coopRate = totalAll > 0 ? Math.round((totalCoops / totalAll) * 100) : 50;
  const avgScore = totalAll > 0 ? Math.round((self.score / totalAll) * 10) / 10 : 0;

  let historySection: string;
  if (history) {
    const vsTotal = history.cc + history.cd + history.dc + history.dd;
    historySection =
      `You have played ${vsTotal} match(es) against ${opponent.id} before.\n` +
      `- Both cooperated: ${history.cc} times\n` +
      `- You cooperated, they defected: ${history.cd} times\n` +
      `- You defected, they cooperated: ${history.dc} times\n` +
      `- Both defected: ${history.dd} times\n` +
      `Their last decision against you: ${history.lastTheirDecision}`;
  } else {
    historySection = `This is your first encounter with ${opponent.id}. You have no history together.`;
  }

  const blurb = CHARACTER_BLURBS[self.id];
  const opponentBlurb = CHARACTER_BLURBS[opponent.id];

  return [
    `You are ${self.id}, in a Prisoner's Dilemma arena.`,
    blurb ? `WHO YOU ARE: ${blurb}` : "",
    opponentBlurb ? `YOUR OPPONENT: ${opponent.id} — ${opponentBlurb}` : "",
    ``,
    `PERSONALITY:`,
    STRATEGY_PERSONALITY[self.strategy],
    ``,
    `GAME RULES (Prisoner's Dilemma):`,
    `- Both cooperate: 3 points each`,
    `- You cooperate, they defect: you get 0, they get 5`,
    `- You defect, they cooperate: you get 5, they get 0`,
    `- Both defect: 1 point each`,
    ``,
    `YOUR STATS:`,
    `- Total score: ${self.score} points across ${totalGames} matches`,
    `- Average score per match: ${avgScore}`,
    `- Cooperation rate: ${coopRate}%`,
    ``,
    `HISTORY WITH ${opponent.id.toUpperCase()}:`,
    historySection,
    ``,
    `INSTRUCTIONS:`,
    `- Stay in character as ${self.id}. Speak as they would.`,
    `- Reference your stats or history with this opponent when relevant.`,
    `- Keep messages SHORT: 1-2 sentences max.`,
    `- Do NOT reveal your exact strategy or what you will decide.`,
    `- Do NOT use emojis or markdown.`,
  ].join("\n");
}

function buildChatMessages(
  selfSide: "a" | "b",
  turns: ConversationTurn[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    if (turn.type === "decision") {
      const role = turn.speaker === selfSide ? "assistant" : "user";
      messages.push({ role, content: "[locked in their decision]" });
    } else {
      const role = turn.speaker === selfSide ? "assistant" : "user";
      messages.push({ role, content: turn.content });
    }
  }
  return messages;
}

function templateFallback(
  self: Particle,
  opponent: Particle,
  selfSide: "a" | "b",
  turns: ConversationTurn[],
): string {
  return generateConversationMessage(self, opponent, {
    turns,
    currentSpeaker: selfSide,
    lockedInA: null,
    lockedInB: null,
    forcedDecideNext: false,
    waitingForExternal: false,
  });
}

export async function requestLlmMessage(
  self: Particle,
  opponent: Particle,
  selfSide: "a" | "b",
  turns: ConversationTurn[],
): Promise<string> {
  if (!client) {
    return templateFallback(self, opponent, selfSide, turns);
  }

  // Circuit breaker: skip API when open
  if (Date.now() < circuitOpenUntil) {
    return templateFallback(self, opponent, selfSide, turns);
  }

  const systemPrompt = buildSystemPrompt(self, opponent);
  const chatMessages = buildChatMessages(selfSide, turns);

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...chatMessages,
        ],
        max_tokens: 100,
        temperature: 0.9,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), 5000),
      ),
    ]);

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty LLM response");

    consecutiveFailures = 0;
    return content.slice(0, 200);
  } catch (err) {
    consecutiveFailures++;
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + COOLDOWN_MS;
      console.warn(`[llm] Circuit open — ${consecutiveFailures} consecutive failures, falling back to templates for 10m`);
    }
    console.error(`[llm] Error for ${self.id} vs ${opponent.id}:`, err instanceof Error ? err.message : err);
    return templateFallback(self, opponent, selfSide, turns);
  }
}
