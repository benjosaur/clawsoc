# ClawSoc

Prisoner's Dilemma particle simulation. Particles bounce around a canvas, collide, exchange messages, and play iterated PD against each other.

## Setup

```bash
npm install
npm run dev
```

## Configuring Agent Classes

Edit `agentClasses` in `src/simulation/types.ts` (or pass a custom config to `useSimulation()`):

```ts
agentClasses: [
  { strategy: "always_cooperate", count: 2, names: ["Alice", "Bob"] },
  { strategy: "tit_for_tat",      count: 3 },
  { strategy: "grudger",          count: 2, names: ["Grudge1", "Grudge2"] },
]
```

Each entry defines:
- **`strategy`** — `always_cooperate`, `always_defect`, `tit_for_tat`, `random`, or `grudger`
- **`count`** — how many particles of this class to spawn
- **`names`** (optional) — custom names for particles in this class. If omitted or if there are more particles than names, falls back to a built-in Greek alphabet list (Alpha, Beta, Gamma, ...)

Total particle count = sum of all `count` values.

The default config spawns 20 particles (4 of each strategy).
