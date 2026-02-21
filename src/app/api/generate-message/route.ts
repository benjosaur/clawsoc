import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { StrategyType } from "@/simulation/types";

let openaiClient: OpenAI | null = null;

function getClient(apiKey: string): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

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

interface PriorInteraction {
  myDecision: "cooperate" | "defect";
  theirDecision: "cooperate" | "defect";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "sk-your-key-here") {
    return NextResponse.json({ message: "" }, { status: 503 });
  }

  const body = await request.json();
  const { strategy, selfLabel, opponentLabel, priorInteractions } = body as {
    strategy: StrategyType;
    selfLabel: string;
    opponentLabel: string;
    priorInteractions: PriorInteraction[];
  };

  if (!strategy || !selfLabel || !opponentLabel || !Array.isArray(priorInteractions)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const systemPrompt = SYSTEM_PROMPTS[strategy];
  if (!systemPrompt) {
    return NextResponse.json({ error: "Unknown strategy" }, { status: 400 });
  }

  let historyContext = "";
  if (priorInteractions.length > 0) {
    const summary = priorInteractions
      .map(
        (i) =>
          `You ${i.myDecision}d, they ${i.theirDecision}d`
      )
      .join(". ");
    historyContext = ` Your past interactions with ${opponentLabel}: ${summary}.`;
  }

  const userPrompt = `You are ${selfLabel}, meeting ${opponentLabel} in a Prisoner's Dilemma game.${historyContext} Generate a short message (1-2 sentences) to say to them before you both make your decision. Stay in character. Do not mention the game mechanics directly.`;

  try {
    const openai = getClient(apiKey);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 60,
      temperature: 0.8,
    });

    const message = completion.choices[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ message });
  } catch (err) {
    console.error("OpenAI API error:", err);
    return NextResponse.json({ message: "" }, { status: 500 });
  }
}
