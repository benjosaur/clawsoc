import { MatchRecord, Particle, SimulationConfig, DEFAULT_CONFIG, FloatingPopup } from "./types";
import { areColliding, resolveElasticCollision, separateParticles, bounceOffWalls, vecAdd } from "./physics";
import { createParticles } from "./Particle";
import { playMatch } from "./game";

interface FrozenPair {
  aId: number;
  bId: number;
  unfreezeAtTick: number;
}

export class SimulationEngine {
  particles: Particle[];
  config: SimulationConfig;
  tick: number = 0;
  matchHistory: MatchRecord[] = [];
  frozenPairs: FrozenPair[] = [];
  popups: FloatingPopup[] = [];
  totalCooperations: number = 0;
  totalDefections: number = 0;

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.particles = createParticles(config);
  }

  private isFrozen(particleId: number): boolean {
    return this.frozenPairs.some((fp) => fp.aId === particleId || fp.bId === particleId);
  }

  step(): void {
    this.tick++;

    // Remove expired popups
    this.popups = this.popups.filter(
      (p) => this.tick - p.spawnTick < p.delayTicks + p.durationTicks
    );

    // 1. Resolve finished frozen pairs
    const toUnfreeze: FrozenPair[] = [];
    this.frozenPairs = this.frozenPairs.filter((fp) => {
      if (this.tick >= fp.unfreezeAtTick) {
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
    }

    // 2. Move "moving" particles
    for (const p of this.particles) {
      if (p.state !== "moving") continue;
      p.position = vecAdd(p.position, p.velocity);
      bounceOffWalls(p, this.config);
    }

    // 3. Detect new collisions among moving particles
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];

        if (a.state !== "moving" || b.state !== "moving") continue;
        if (!areColliding(a, b)) continue;

        a.state = "colliding";
        b.state = "colliding";

        const record = playMatch(a, b, this.tick);
        this.matchHistory.push(record);

        // Track global counters
        this.totalCooperations += (record.decisionA === "cooperate" ? 1 : 0) + (record.decisionB === "cooperate" ? 1 : 0);
        this.totalDefections += (record.decisionA === "defect" ? 1 : 0) + (record.decisionB === "defect" ? 1 : 0);

        // Spawn popups for each particle
        const midX = (a.position.x + b.position.x) / 2;
        const midY = (a.position.y + b.position.y) / 2;
        const offset = 14;

        this.popups.push({
          x: a.position.x < midX ? midX - offset : midX + offset,
          y: midY - 16,
          text: "+" + record.scoreA,
          color: record.decisionA === "cooperate" ? "#16a34a" : "#dc2626",
          spawnTick: this.tick,
          delayTicks: 15,
          durationTicks: 40,
        });
        this.popups.push({
          x: b.position.x < midX ? midX - offset : midX + offset,
          y: midY - 16,
          text: "+" + record.scoreB,
          color: record.decisionB === "cooperate" ? "#16a34a" : "#dc2626",
          spawnTick: this.tick,
          delayTicks: 15,
          durationTicks: 40,
        });

        this.frozenPairs.push({
          aId: a.id,
          bId: b.id,
          unfreezeAtTick: this.tick + this.config.freezeDurationTicks,
        });
      }
    }
  }

  reset(): void {
    this.tick = 0;
    this.matchHistory = [];
    this.frozenPairs = [];
    this.popups = [];
    this.totalCooperations = 0;
    this.totalDefections = 0;
    this.particles = createParticles(this.config);
  }
}
