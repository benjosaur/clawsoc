import { CollisionPhase, Decision, GameLogEntry, MatchRecord, Particle, SimulationConfig, DEFAULT_CONFIG, FloatingPopup } from "./types";
import { areColliding, resolveElasticCollision, separateParticles, bounceOffWalls, vecAdd } from "./physics";
import { createParticles } from "./Particle";
import { playMatchWithOverrides, applyMatchResult } from "./game";
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
  aId: string;
  bId: string;
  phase: CollisionPhase;
  phaseStartTick: number;
  unfreezeAtTick: number;
  messageA: string | null;
  messageB: string | null;
  matchRecord: MatchRecord | null;
  waitingForExternal: boolean;
  externalDecisionA: Decision | null;
  externalDecisionB: Decision | null;
}

export type ExternalRequestCallback = (
  side: "a" | "b",
  self: Particle,
  opponent: Particle,
  aId: string,
  bId: string,
) => void;

export type MatchResolvedCallback = (
  record: MatchRecord,
  aId: string,
  bId: string,
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
  pendingMetaUpdates: string[] = [];
  pendingGameLog: GameLogEntry[] = [];
  onRequestExternalDecision: ExternalRequestCallback | null = null;
  onMatchResolved: MatchResolvedCallback | null = null;
  onParticleParked: ((particleId: string, username: string) => void) | null = null;

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.particles = createParticles(config);
  }

  private isFrozen(particleId: string): boolean {
    return this.frozenPairs.some((fp) => fp.aId === particleId || fp.bId === particleId);
  }

  private advanceConversations(): void {
    for (const fp of this.frozenPairs) {

      // If waiting for external response, freeze phase advancement
      if (fp.waitingForExternal) continue;

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
          if (this.onRequestExternalDecision && a.isExternal) {
            fp.waitingForExternal = true;
            this.onRequestExternalDecision("a", a, b, fp.aId, fp.bId);
          } else {
            fp.messageA = generateMessage(a, b);
          }
          break;
        }
        case "messaging_b": {
          if (this.onRequestExternalDecision && b.isExternal) {
            fp.waitingForExternal = true;
            this.onRequestExternalDecision("b", b, a, fp.aId, fp.bId);
          } else {
            fp.messageB = generateMessage(b, a);
          }
          break;
        }
        case "deciding": {
          // Play the match now, using any external overrides
          const record = playMatchWithOverrides(a, b, this.tick, fp.externalDecisionA, fp.externalDecisionB);
          if (fp.messageA) record.messageA = fp.messageA;
          if (fp.messageB) record.messageB = fp.messageB;
          fp.matchRecord = record;
          break;
        }
        case "resolved": {
          // Apply all deferred mutations at popup time
          const record = fp.matchRecord;
          if (!record) break;
          applyMatchResult(a, b, record);
          this.pendingMetaUpdates.push(a.id, b.id);

          this.gameLog.push(record);
          if (this.gameLog.length > 200) this.gameLog.splice(0, this.gameLog.length - 200);
          this.pendingGameLog.push(record);

          this.totalCooperations += (record.decisionA === "cooperate" ? 1 : 0) + (record.decisionB === "cooperate" ? 1 : 0);
          this.totalDefections += (record.decisionA === "defect" ? 1 : 0) + (record.decisionB === "defect" ? 1 : 0);

          // Spawn score popups and set unfreeze time
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

          this.onMatchResolved?.(record, fp.aId, fp.bId);
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

      const { va, vb } = resolveElasticCollision(a, b);
      separateParticles(a, b);

      if (!aStillFrozen) {
        if (a.isExternal) {
          a.state = "parked";
          a.velocity = { x: 0, y: 0 };
          this.pendingEvents.push({ e: "park", id: a.id });
          this.onParticleParked?.(a.id, a.externalOwner!);
        } else {
          a.state = "moving";
          a.velocity = va;
        }
      }
      if (!bStillFrozen) {
        if (b.isExternal) {
          b.state = "parked";
          b.velocity = { x: 0, y: 0 };
          this.pendingEvents.push({ e: "park", id: b.id });
          this.onParticleParked?.(b.id, b.externalOwner!);
        } else {
          b.state = "moving";
          b.velocity = vb;
        }
      }

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

        separateParticles(a, b);
        // Capture entry velocities before freezing
        const avx = a.velocity.x, avy = a.velocity.y;
        const bvx = b.velocity.x, bvy = b.velocity.y;

        a.state = "colliding";
        b.state = "colliding";

        this.pendingEvents.push({
          e: "freeze", a: a.id, b: b.id,
          ax: a.position.x, ay: a.position.y, avx, avy,
          bx: b.position.x, by: b.position.y, bvx, bvy,
        });

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
          waitingForExternal: false,
          externalDecisionA: null,
          externalDecisionB: null,
        });
      }
    }
  }

  private timeoutCounter = 0;

  abortPair(aId: string, bId: string): void {
    const idx = this.frozenPairs.findIndex((f) => f.aId === aId && f.bId === bId);
    if (idx === -1) return;

    const fp = this.frozenPairs[idx];
    this.frozenPairs.splice(idx, 1);

    const a = this.particles.find((p) => p.id === fp.aId);
    const b = this.particles.find((p) => p.id === fp.bId);
    if (!a || !b) return;

    const { va, vb } = resolveElasticCollision(a, b);
    separateParticles(a, b);

    if (!this.isFrozen(a.id)) {
      if (a.isExternal) {
        a.state = "parked";
        a.velocity = { x: 0, y: 0 };
        this.pendingEvents.push({ e: "park", id: a.id });
        this.onParticleParked?.(a.id, a.externalOwner!);
      } else {
        a.state = "moving";
        a.velocity = va;
      }
    }
    if (!this.isFrozen(b.id)) {
      if (b.isExternal) {
        b.state = "parked";
        b.velocity = { x: 0, y: 0 };
        this.pendingEvents.push({ e: "park", id: b.id });
        this.onParticleParked?.(b.id, b.externalOwner!);
      } else {
        b.state = "moving";
        b.velocity = vb;
      }
    }

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
      particleA: { id: a.id },
      particleB: { id: b.id },
      reason: "Response timed out",
      timestamp: Date.now(),
    });
    if (this.gameLog.length > 200) this.gameLog.splice(0, this.gameLog.length - 200);
  }

  drainEvents(): SimEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  drainMetaUpdates(): string[] {
    const ids = this.pendingMetaUpdates;
    this.pendingMetaUpdates = [];
    return ids;
  }

  drainGameLog(): GameLogEntry[] {
    const entries = this.pendingGameLog;
    this.pendingGameLog = [];
    return entries;
  }

  resolveExternalDecision(
    aId: string,
    bId: string,
    side: "a" | "b",
    message: string,
    decision: Decision,
  ): void {
    const fp = this.frozenPairs.find((f) => f.aId === aId && f.bId === bId);
    if (!fp) return;

    if (side === "a") {
      fp.messageA = message;
      fp.externalDecisionA = decision;
    } else {
      fp.messageB = message;
      fp.externalDecisionB = decision;
    }

    fp.waitingForExternal = false;
    fp.phaseStartTick = this.tick;
  }

  addParticle(p: Particle): void {
    this.particles.push(p);
    this.pendingEvents.push({
      e: "add", id: p.id,
      x: p.position.x, y: p.position.y,
      vx: p.velocity.x, vy: p.velocity.y,
      radius: p.radius, strategy: p.strategy,
    });
    this.pendingMetaUpdates.push(p.id);
  }

  removeParticle(id: string): void {
    // Abort any frozen pairs involving this particle
    const pairsToAbort = this.frozenPairs.filter(
      (fp) => fp.aId === id || fp.bId === id,
    );
    for (const fp of pairsToAbort) {
      this.abortPair(fp.aId, fp.bId);
    }
    const idx = this.particles.findIndex((p) => p.id === id);
    if (idx !== -1) this.particles.splice(idx, 1);
    this.pendingEvents.push({ e: "remove", id });
  }

  unparkParticle(id: string): void {
    const p = this.particles.find((pp) => pp.id === id);
    if (!p || p.state !== "parked") return;
    const angle = Math.random() * Math.PI * 2;
    const speed = this.config.minSpeed + Math.random() * (this.config.maxSpeed - this.config.minSpeed);
    p.velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
    p.state = "moving";
    this.pendingEvents.push({
      e: "unpark", id: p.id,
      x: p.position.x, y: p.position.y,
      vx: p.velocity.x, vy: p.velocity.y,
    });
  }

  getParticleCount(): number {
    return this.particles.length;
  }

}
