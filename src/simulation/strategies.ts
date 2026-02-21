import { Decision, Particle } from "./types";

export function decide(self: Particle, opponent: Particle): Decision {
  switch (self.strategy) {
    case "always_cooperate":
      return "cooperate";

    case "always_defect":
      return "defect";

    case "tit_for_tat": {
      // First encounter: cooperate. Then mirror opponent's last move against us.
      const record = self.matchHistory[opponent.id];
      return record ? record.lastTheirDecision : "cooperate";
    }

    case "random":
      return Math.random() < 0.5 ? "cooperate" : "defect";

    case "grudger": {
      // Cooperate until the opponent has ever defected against us.
      const record = self.matchHistory[opponent.id];
      const everBetrayed = record ? record.cd + record.dd > 0 : false;
      return everBetrayed ? "defect" : "cooperate";
    }

    default:
      return "cooperate";
  }
}
