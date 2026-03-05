import { Decision, MatchRecord, Particle } from "./types";
import { decide } from "./strategies";

// Payoff matrix: [myDecision][theirDecision] => myScore
const PAYOFF: Record<Decision, Record<Decision, number>> = {
  cooperate: { cooperate: 3, defect: 0 },
  defect: { cooperate: 5, defect: 1 },
};

let matchCounter = 0;


function executeMatch(
  a: Particle,
  b: Particle,
  tick: number,
  decisionA: Decision,
  decisionB: Decision,
): MatchRecord {
  const scoreA = PAYOFF[decisionA][decisionB];
  const scoreB = PAYOFF[decisionB][decisionA];

  a.score += scoreA;
  b.score += scoreB;

  const arec = a.matchHistory[b.id] ??= { lastTheirDecision: decisionB, cc: 0, cd: 0, dc: 0, dd: 0 };
  const aKey = (decisionA === "cooperate" ? "c" : "d") + (decisionB === "cooperate" ? "c" : "d") as "cc" | "cd" | "dc" | "dd";
  arec[aKey]++;
  arec.lastTheirDecision = decisionB;

  const brec = b.matchHistory[a.id] ??= { lastTheirDecision: decisionA, cc: 0, cd: 0, dc: 0, dd: 0 };
  const bKey = (decisionB === "cooperate" ? "c" : "d") + (decisionA === "cooperate" ? "c" : "d") as "cc" | "cd" | "dc" | "dd";
  brec[bKey]++;
  brec.lastTheirDecision = decisionA;

  matchCounter++;
  return {
    type: "match",
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

export function playMatch(a: Particle, b: Particle, tick: number): MatchRecord {
  return executeMatch(a, b, tick, decide(a, b), decide(b, a));
}

export function playMatchWithOverrides(
  a: Particle,
  b: Particle,
  tick: number,
  overrideA?: Decision | null,
  overrideB?: Decision | null,
): MatchRecord {
  const decisionA = overrideA ?? decide(a, b);
  const decisionB = overrideB ?? decide(b, a);
  return executeMatch(a, b, tick, decisionA, decisionB);
}
