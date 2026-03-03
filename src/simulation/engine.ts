import { CollisionPhase, GameLogEntry, MatchRecord, Particle, SimulationConfig, DEFAULT_CONFIG, FloatingPopup } from "./types";
import { areColliding, resolveElasticCollision, separateParticles, bounceOffWalls, vecAdd } from "./physics";
import { createParticles } from "./Particle";
import { playMatch, resetMatchCounter } from "./game";
import { generateMessage } from "./messages";
import type { SimEvent } from "./protocol";

const PHASE_DURATIONS: Record<CollisionPhase, number> = {
  greeting: 15,
  messaging_a: 40,
  messaging_b: 40,
  deciding: 25,
  resolved: 40,
};

const PHASE_ORDER: CollisionPhase[] = [
  "greeting",
  "messaging_a",
  "messaging_b",
  "deciding",
  "resolved",
];

interface FrozenPair {
  aId: number;
  bId: number;
  phase: CollisionPhase;
  phaseStartTick: number;
  unfreezeAtTick: number;
  messageA: string | null;
  messageB: string | null;
  matchRecord: MatchRecord | null;
  waitingForLLM: boolean;
}

export type LLMRequestCallback = (
  side: "a" | "b",
  self: Particle,
  opponent: Particle,
) => void;

export class SimulationEngine {
  particles: Particle[];
  config: SimulationConfig;
  tick: number = 0;
  gameLog: GameLogEntry[] = [];
  frozenPairs: FrozenPair[] = [];
  popups: FloatingPopup[] = [];
  totalCooperations: number = 0;
  totalDefections: number = 0;
  pendingEvents: SimEvent[] = [];
  onRequestLLMMessage: LLMRequestCallback | null = null;

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.particles = createParticles(config);
  }

  private isFrozen(particleId: number): boolean {
    return this.frozenPairs.some((fp) => fp.aId === particleId || fp.bId === particleId);
  }

  private advanceConversations(): void {
    for (const fp of this.frozenPairs) {

      // If waiting for LLM response, freeze phase advancement
      if (fp.waitingForLLM) continue;

      const elapsed = this.tick - fp.phaseStartTick;
      const phaseDuration = PHASE_DURATIONS[fp.phase];

      if (elapsed < phaseDuration) continue;

      // Advance to next phase
      const currentIndex = PHASE_ORDER.indexOf(fp.phase);
      if (currentIndex >= PHASE_ORDER.length - 1) continue; // already resolved, wait for unfreeze

      const nextPhase = PHASE_ORDER[currentIndex + 1];
      fp.phase = nextPhase;
      fp.phaseStartTick = this.tick;

      const a = this.particles.find((p) => p.id === fp.aId);
      const b = this.particles.find((p) => p.id === fp.bId);
      if (!a || !b) continue;

      switch (nextPhase) {
        case "messaging_a": {
          if (this.onRequestLLMMessage && a.useLLM) {
            fp.waitingForLLM = true;
            this.onRequestLLMMessage("a", a, b);
          } else {
            fp.messageA = generateMessage(a, b);
          }
          break;
        }
        case "messaging_b": {
          if (this.onRequestLLMMessage && b.useLLM) {
            fp.waitingForLLM = true;
            this.onRequestLLMMessage("b", b, a);
          } else {
            fp.messageB = generateMessage(b, a);
          }
          break;
        }
        case "deciding": {
          // Play the match now
          const record = playMatch(a, b, this.tick);
          if (fp.messageA) record.messageA = fp.messageA;
          if (fp.messageB) record.messageB = fp.messageB;
          fp.matchRecord = record;
          this.gameLog.push(record);
          if (this.gameLog.length > 200) this.gameLog.splice(0, this.gameLog.length - 200);

          this.totalCooperations += (record.decisionA === "cooperate" ? 1 : 0) + (record.decisionB === "cooperate" ? 1 : 0);
          this.totalDefections += (record.decisionA === "defect" ? 1 : 0) + (record.decisionB === "defect" ? 1 : 0);
          break;
        }
        case "resolved": {
          // Spawn score popups and set unfreeze time
          const record = fp.matchRecord;
          if (!record) break;

          const midX = (a.position.x + b.position.x) / 2;
          const midY = (a.position.y + b.position.y) / 2;
          const offset = 14;
          const dx = a.position.x - b.position.x;
          const sign = dx >= 0 ? 1 : -1;

          this.popups.push({
            x: midX + sign * offset,
            y: midY - 16,
            text: "+" + record.scoreA,
            color: record.decisionA === "cooperate" ? "#16a34a" : "#dc2626",
            spawnTick: this.tick,
            delayTicks: 0,
            durationTicks: PHASE_DURATIONS.resolved,
          });
          this.popups.push({
            x: midX - sign * offset,
            y: midY - 16,
            text: "+" + record.scoreB,
            color: record.decisionB === "cooperate" ? "#16a34a" : "#dc2626",
            spawnTick: this.tick,
            delayTicks: 0,
            durationTicks: PHASE_DURATIONS.resolved,
          });

          fp.unfreezeAtTick = this.tick + PHASE_DURATIONS.resolved;
          break;
        }
      }
    }
  }

  step(): void {
    this.tick++;

    // Remove expired popups
    this.popups = this.popups.filter(
      (p) => this.tick - p.spawnTick < p.delayTicks + p.durationTicks
    );

    // 1. Advance conversation phases
    this.advanceConversations();

    // 2. Resolve finished frozen pairs (only those in "resolved" phase)
    const toUnfreeze: FrozenPair[] = [];
    this.frozenPairs = this.frozenPairs.filter((fp) => {
      if (fp.phase === "resolved" && this.tick >= fp.unfreezeAtTick) {
        toUnfreeze.push(fp);
        return false;
      }
      return true;
    });

    for (const fp of toUnfreeze) {
      const a = this.particles.find((p) => p.id === fp.aId);
      const b = this.particles.find((p) => p.id === fp.bId);
      if (!a || !b) continue;

      const aStillFrozen = this.isFrozen(a.id);
      const bStillFrozen = this.isFrozen(b.id);

      if (!aStillFrozen) a.state = "moving";
      if (!bStillFrozen) b.state = "moving";

      const { va, vb } = resolveElasticCollision(a, b);
      if (!aStillFrozen) a.velocity = va;
      if (!bStillFrozen) b.velocity = vb;

      separateParticles(a, b);

      this.pendingEvents.push({
        e: "unfreeze", a: a.id, b: b.id,
        ax: a.position.x, ay: a.position.y, avx: a.velocity.x, avy: a.velocity.y,
        bx: b.position.x, by: b.position.y, bvx: b.velocity.x, bvy: b.velocity.y,
      });
    }

    // 3. Move "moving" particles
    for (const p of this.particles) {
      if (p.state !== "moving") continue;
      p.position = vecAdd(p.position, p.velocity);
      bounceOffWalls(p, this.config);
    }

    // 4. Detect new collisions among moving particles
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];

        if (a.state !== "moving" || b.state !== "moving") continue;
        if (!areColliding(a, b)) continue;

        a.state = "colliding";
        b.state = "colliding";

        this.pendingEvents.push({ e: "freeze", a: a.id, b: b.id });

        // Create frozen pair in greeting phase — match resolved later
        this.frozenPairs.push({
          aId: a.id,
          bId: b.id,
          phase: "greeting",
          phaseStartTick: this.tick,
          unfreezeAtTick: Infinity,
          messageA: null,
          messageB: null,
          matchRecord: null,
          waitingForLLM: false,
        });
      }
    }
  }

  resolveMessage(aId: number, bId: number, side: "a" | "b", text: string): void {
    const fp = this.frozenPairs.find((f) => f.aId === aId && f.bId === bId);
    if (!fp) return;

    if (side === "a") {
      fp.messageA = text;
    } else {
      fp.messageB = text;
    }

    fp.waitingForLLM = false;
    fp.phaseStartTick = this.tick; // Reset phase timer so full duration plays after resolve
  }

  private timeoutCounter = 0;

  abortPair(aId: number, bId: number): void {
    const idx = this.frozenPairs.findIndex((f) => f.aId === aId && f.bId === bId);
    if (idx === -1) return;

    const fp = this.frozenPairs[idx];
    this.frozenPairs.splice(idx, 1);

    const a = this.particles.find((p) => p.id === fp.aId);
    const b = this.particles.find((p) => p.id === fp.bId);
    if (!a || !b) return;

    // Unfreeze if not in another pair
    if (!this.isFrozen(a.id)) a.state = "moving";
    if (!this.isFrozen(b.id)) b.state = "moving";

    const { va, vb } = resolveElasticCollision(a, b);
    if (!this.isFrozen(a.id)) a.velocity = va;
    if (!this.isFrozen(b.id)) b.velocity = vb;
    separateParticles(a, b);

    this.pendingEvents.push({
      e: "abort", a: a.id, b: b.id,
      ax: a.position.x, ay: a.position.y, avx: a.velocity.x, avy: a.velocity.y,
      bx: b.position.x, by: b.position.y, bvx: b.velocity.x, bvy: b.velocity.y,
    });

    this.timeoutCounter++;
    this.gameLog.push({
      type: "timeout",
      id: `timeout-${this.timeoutCounter}`,
      tick: this.tick,
      particleA: { id: a.id, label: a.label },
      particleB: { id: b.id, label: b.label },
      reason: "LLM response timed out",
      timestamp: Date.now(),
    });
    if (this.gameLog.length > 200) this.gameLog.splice(0, this.gameLog.length - 200);
  }

  drainEvents(): SimEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  reset(): void {
    this.tick = 0;
    this.gameLog = [];
    this.frozenPairs = [];
    this.popups = [];
    this.pendingEvents = [];
    this.totalCooperations = 0;
    this.totalDefections = 0;
    resetMatchCounter();
    this.particles = createParticles(this.config);
  }
}
