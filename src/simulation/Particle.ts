import { Particle, SimulationConfig } from "./types";

const COLORS = [
  "#dc2626", "#ea580c", "#d97706", "#ca8a04", "#65a30d",
  "#16a34a", "#059669", "#0d9488", "#0891b2", "#0284c7",
  "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3",
  "#db2777", "#e11d48", "#c2410c", "#4d7c0f", "#0f766e",
];

const NAMES = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
  "Zeta", "Eta", "Theta", "Iota", "Kappa",
  "Lambda", "Mu", "Nu", "Xi", "Omicron",
  "Pi", "Rho", "Sigma", "Tau", "Upsilon",
  "Phi", "Chi", "Psi", "Omega",
];

function uniqueName(index: number): string {
  const base = NAMES[index % NAMES.length];
  const gen = Math.floor(index / NAMES.length);
  return gen === 0 ? base : `${base}${gen + 1}`;
}

export function createParticles(config: SimulationConfig): Particle[] {
  const particles: Particle[] = [];
  let i = 0;

  for (const agentClass of config.agentClasses) {
    for (let n = 0; n < agentClass.count; n++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);

      // Place particles with margin from edges
      const margin = config.particleRadius * 3;
      const x = margin + Math.random() * (config.canvasWidth - margin * 2);
      const y = margin + Math.random() * (config.canvasHeight - margin * 2);

      const label = agentClass.names?.[n] ?? uniqueName(i);

      particles.push({
        id: label,
        position: { x, y },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        radius: config.particleRadius,
        mass: 1,
        color: COLORS[i % COLORS.length],
        state: "moving",
        score: 0,
        scoreLog: [],
        strategy: agentClass.strategy,
        matchHistory: {},
        isExternal: false,
      });
      i++;
    }
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
