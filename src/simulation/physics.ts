import { Vec2, Particle, SimulationConfig } from "./types";

// --- Vector math ---

export function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vecSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vecScale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vecDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function vecLength(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vecNormalize(v: Vec2): Vec2 {
  const len = vecLength(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

// --- Collision detection ---

export function areColliding(a: Particle, b: Particle): boolean {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist <= a.radius + b.radius;
}

// --- Elastic collision resolution ---

export function resolveElasticCollision(a: Particle, b: Particle): { va: Vec2; vb: Vec2 } {
  const diff = vecSub(a.position, b.position);
  const distSq = vecDot(diff, diff);
  if (distSq === 0) return { va: a.velocity, vb: b.velocity };

  const relVelA = vecSub(a.velocity, b.velocity);
  const relVelB = vecSub(b.velocity, a.velocity);

  const massFactorA = (2 * b.mass) / (a.mass + b.mass);
  const massFactorB = (2 * a.mass) / (a.mass + b.mass);

  const dotA = vecDot(relVelA, diff) / distSq;
  const dotB = vecDot(relVelB, vecScale(diff, -1)) / distSq;

  const va = vecSub(a.velocity, vecScale(diff, massFactorA * dotA));
  const vb = vecSub(b.velocity, vecScale(vecScale(diff, -1), massFactorB * dotB));

  return { va, vb };
}

// --- Separate overlapping particles ---

export function separateParticles(a: Particle, b: Particle): void {
  const diff = vecSub(a.position, b.position);
  const dist = vecLength(diff);
  const minDist = a.radius + b.radius;

  if (dist < minDist && dist > 0) {
    const overlap = (minDist - dist) / 2 + 0.5;
    const normal = vecNormalize(diff);
    a.position = vecAdd(a.position, vecScale(normal, overlap));
    b.position = vecSub(b.position, vecScale(normal, overlap));
  }
}

// --- Wall bounce ---

export function bounceOffWalls(p: Particle, config: SimulationConfig): void {
  const { canvasWidth, canvasHeight } = config;

  if (p.position.x - p.radius < 0) {
    p.position.x = p.radius;
    p.velocity.x = Math.abs(p.velocity.x);
  } else if (p.position.x + p.radius > canvasWidth) {
    p.position.x = canvasWidth - p.radius;
    p.velocity.x = -Math.abs(p.velocity.x);
  }

  if (p.position.y - p.radius < 0) {
    p.position.y = p.radius;
    p.velocity.y = Math.abs(p.velocity.y);
  } else if (p.position.y + p.radius > canvasHeight) {
    p.position.y = canvasHeight - p.radius;
    p.velocity.y = -Math.abs(p.velocity.y);
  }
}
