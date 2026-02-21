import { MatchRecord, Particle, SimulationConfig, DEFAULT_CONFIG } from "./types";
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

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.particles = createParticles(config);
  }

  private isFrozen(particleId: number): boolean {
    return this.frozenPairs.some((fp) => fp.aId === particleId || fp.bId === particleId);
  }

  step(): void {
    this.tick++;

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

      // Only unfreeze if not involved in another active pair
      const aStillFrozen = this.isFrozen(a.id);
      const bStillFrozen = this.isFrozen(b.id);

      if (!aStillFrozen) {
        a.state = "moving";
      }
      if (!bStillFrozen) {
        b.state = "moving";
      }

      // Apply elastic collision
      const { va, vb } = resolveElasticCollision(a, b);
      if (!aStillFrozen) a.velocity = va;
      if (!bStillFrozen) b.velocity = vb;

      // Separate to prevent re-collision
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

        // Freeze both and play match
        a.state = "colliding";
        b.state = "colliding";

        const record = playMatch(a, b, this.tick);
        this.matchHistory.push(record);

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
    this.particles = createParticles(this.config);
  }
}
