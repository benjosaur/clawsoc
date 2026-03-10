import { Decision, Particle, ConversationState } from "./types";
import { decide } from "./strategies";
import { generateConversationMessage } from "./messages";

export interface TurnAction {
  type: "message" | "decision";
  content: string;
  decision?: Decision;
}

/**
 * Decide what a bot does on their turn: send a message or lock in a decision.
 * Each strategy has a distinct personality.
 */
export function botChooseTurnAction(
  self: Particle,
  opponent: Particle,
  conv: ConversationState,
): TurnAction {
  const turnNumber = conv.turns.length;
  const myDecision = decide(self, opponent);

  // If forced to decide (opponent already locked in + got their extra turn), just decide
  if (conv.forcedDecideNext) {
    return { type: "decision", content: "", decision: myDecision };
  }

  // Ensure every bot sends at least 1 message before deciding
  const mySide = conv.currentSpeaker;
  const myMessageCount = conv.turns.filter(
    (t) => t.speaker === mySide && t.type === "message",
  ).length;
  const mustMessage = myMessageCount === 0;

  switch (self.strategy) {
    case "always_defect": {
      // Curt: 70% chance to decide on turn 0-1, always by turn 2
      if (!mustMessage && (turnNumber >= 2 || Math.random() < 0.7)) {
        return { type: "decision", content: "", decision: myDecision };
      }
      return { type: "message", content: generateConversationMessage(self, opponent, conv) };
    }

    case "always_cooperate": {
      // Chatty: messages for 3-4 turns before deciding
      if (turnNumber < 3 || (turnNumber < 5 && Math.random() < 0.6)) {
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      if (mustMessage) {
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      return { type: "decision", content: "", decision: myDecision };
    }

    case "tit_for_tat": {
      // Mirrors opponent pace: if opponent decided, decide immediately
      const opponentDecided = conv.lockedInA !== null || conv.lockedInB !== null;
      if (!mustMessage && opponentDecided) {
        return { type: "decision", content: "", decision: myDecision };
      }
      // Chat for 2-3 turns then decide
      if (turnNumber < 2 || (turnNumber < 4 && Math.random() < 0.5)) {
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      if (mustMessage) {
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      return { type: "decision", content: "", decision: myDecision };
    }

    case "random": {
      // Chaotic: increasing probability of deciding each turn
      const decideChance = 0.25 + turnNumber * 0.1;
      if (!mustMessage && Math.random() < decideChance) {
        return { type: "decision", content: "", decision: myDecision };
      }
      return { type: "message", content: generateConversationMessage(self, opponent, conv) };
    }

    case "grudger": {
      // History-dependent: if betrayed, decide quickly. Otherwise chat.
      const record = self.matchHistory[opponent.id];
      const everBetrayed = record ? record.cd + record.dd > 0 : false;
      if (everBetrayed) {
        if (!mustMessage && (turnNumber >= 1 || Math.random() < 0.5)) {
          return { type: "decision", content: "", decision: myDecision };
        }
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      // Not betrayed: friendly, chat 2-3 turns
      if (turnNumber < 2 || (turnNumber < 4 && Math.random() < 0.5)) {
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      if (mustMessage) {
        return { type: "message", content: generateConversationMessage(self, opponent, conv) };
      }
      return { type: "decision", content: "", decision: myDecision };
    }

    case "external":
    default:
      // Fallback for external agents (real decisions come via API)
      return { type: "decision", content: "", decision: myDecision };
  }
}
