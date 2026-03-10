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

  matchCounter++;
  return {
    type: "match",
    id: `match-${matchCounter}`,
    tick,
    particleA: { id: a.id, strategy: a.strategy },
    particleB: { id: b.id, strategy: b.strategy },
    decisionA,
    decisionB,
    scoreA,
    scoreB,
    conversation: [],
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

export function playMatchFromDecisions(
  a: Particle,
  b: Particle,
  tick: number,
  decisionA: Decision,
  decisionB: Decision,
): MatchRecord {
  return executeMatch(a, b, tick, decisionA, decisionB);
}

export function applyMatchResult(a: Particle, b: Particle, record: MatchRecord): void {
  const now = Date.now();
  a.score += record.scoreA;
  a.scoreLog.push({ ts: now, pts: record.scoreA });
  b.score += record.scoreB;
  b.scoreLog.push({ ts: now, pts: record.scoreB });

  const arec = a.matchHistory[b.id] ??= { lastTheirDecision: record.decisionB, cc: 0, cd: 0, dc: 0, dd: 0 };
  const aKey = (record.decisionA === "cooperate" ? "c" : "d") + (record.decisionB === "cooperate" ? "c" : "d") as "cc" | "cd" | "dc" | "dd";
  arec[aKey]++;
  arec.lastTheirDecision = record.decisionB;

  const brec = b.matchHistory[a.id] ??= { lastTheirDecision: record.decisionA, cc: 0, cd: 0, dc: 0, dd: 0 };
  const bKey = (record.decisionB === "cooperate" ? "c" : "d") + (record.decisionA === "cooperate" ? "c" : "d") as "cc" | "cd" | "dc" | "dd";
  brec[bKey]++;
  brec.lastTheirDecision = record.decisionA;
}
