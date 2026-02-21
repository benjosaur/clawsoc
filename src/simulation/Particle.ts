import { Particle, SimulationConfig, StrategyType } from "./types";

const STRATEGIES: StrategyType[] = [
  "always_cooperate",
  "always_defect",
  "tit_for_tat",
  "random",
  "grudger",
];

const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#fb923c", "#a3e635", "#2dd4bf",
];

const NAMES = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
  "Zeta", "Eta", "Theta", "Iota", "Kappa",
  "Lambda", "Mu", "Nu", "Xi", "Omicron",
  "Pi", "Rho", "Sigma", "Tau", "Upsilon",
];

export function createParticles(config: SimulationConfig): Particle[] {
  const particles: Particle[] = [];

  for (let i = 0; i < config.particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);

    // Place particles with margin from edges
    const margin = config.particleRadius * 3;
    const x = margin + Math.random() * (config.canvasWidth - margin * 2);
    const y = margin + Math.random() * (config.canvasHeight - margin * 2);

    particles.push({
      id: i,
      label: NAMES[i % NAMES.length],
      position: { x, y },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      radius: config.particleRadius,
      mass: 1,
      color: COLORS[i % COLORS.length],
      state: "moving",
      score: 0,
      strategy: STRATEGIES[i % STRATEGIES.length],
      matchHistory: [],
    });
  }

  // Ensure no initial overlaps by nudging particles apart
  for (let iter = 0; iter < 50; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius + 2;
        if (dist < minDist) {
          anyOverlap = true;
          const angle = Math.atan2(dy, dx);
          const push = (minDist - dist) / 2 + 1;
          a.position.x += Math.cos(angle) * push;
          a.position.y += Math.sin(angle) * push;
          b.position.x -= Math.cos(angle) * push;
          b.position.y -= Math.sin(angle) * push;
        }
      }
    }
    if (!anyOverlap) break;
  }

  return particles;
}
