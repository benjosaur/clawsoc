import { Decision, Particle } from "./types";

export function decide(self: Particle, opponent: Particle): Decision {
  switch (self.strategy) {
    case "always_cooperate":
      return "cooperate";

    case "always_defect":
      return "defect";

    case "tit_for_tat": {
      // First encounter: cooperate. Then mirror opponent's last move against us.
      const lastEncounter = [...self.matchHistory]
        .reverse()
        .find((h) => h.opponentId === opponent.id);
      return lastEncounter ? lastEncounter.theirDecision : "cooperate";
    }

    case "random":
      return Math.random() < 0.5 ? "cooperate" : "defect";

    case "grudger": {
      // Cooperate until the opponent has ever defected against us.
      const everBetrayed = self.matchHistory.some(
        (h) => h.opponentId === opponent.id && h.theirDecision === "defect"
      );
      return everBetrayed ? "defect" : "cooperate";
    }

    default:
      return "cooperate";
  }
}
