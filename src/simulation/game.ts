import { Decision, MatchRecord, Particle } from "./types";
import { decide } from "./strategies";

// Payoff matrix: [myDecision][theirDecision] => myScore
const PAYOFF: Record<Decision, Record<Decision, number>> = {
  cooperate: { cooperate: 3, defect: 0 },
  defect: { cooperate: 5, defect: 1 },
};

let matchCounter = 0;

export function playMatch(a: Particle, b: Particle, tick: number): MatchRecord {
  const decisionA = decide(a, b);
  const decisionB = decide(b, a);

  const scoreA = PAYOFF[decisionA][decisionB];
  const scoreB = PAYOFF[decisionB][decisionA];

  a.score += scoreA;
  b.score += scoreB;

  a.matchHistory.push({ opponentId: b.id, myDecision: decisionA, theirDecision: decisionB });
  b.matchHistory.push({ opponentId: a.id, myDecision: decisionB, theirDecision: decisionA });

  matchCounter++;
  return {
    id: `match-${matchCounter}`,
    tick,
    particleA: { id: a.id, label: a.label, strategy: a.strategy },
    particleB: { id: b.id, label: b.label, strategy: b.strategy },
    decisionA,
    decisionB,
    scoreA,
    scoreB,
    timestamp: Date.now(),
  };
}
