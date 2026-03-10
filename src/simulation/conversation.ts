import { Decision, Particle, ConversationState } from "./types";
import { decide } from "./strategies";
import { generateConversationMessage } from "./messages";

export interface TurnAction {
  type: "message" | "decision";
  content: string;
  decision?: Decision;
}

/**
 * Decide what a bot does on their turn: send 1 message, then decide.
 */
export function botChooseTurnAction(
  self: Particle,
  opponent: Particle,
  conv: ConversationState,
): TurnAction {
  const myDecision = decide(self, opponent);
  const mySide = conv.currentSpeaker;
  const hasSentMessage = conv.turns.some(
    (t) => t.speaker === mySide && t.type === "message",
  );

  if (!hasSentMessage) {
    return { type: "message", content: generateConversationMessage(self, opponent, conv) };
  }

  // Only decide once opponent has also sent a message (or decided early)
  const oppSide = mySide === "a" ? "b" : "a";
  const oppHasActed = conv.turns.some((t) => t.speaker === oppSide);
  if (!oppHasActed) {
    // Shouldn't happen in normal flow (turns alternate), but guard against it
    return { type: "message", content: generateConversationMessage(self, opponent, conv) };
  }

  return { type: "decision", content: "", decision: myDecision };
}
