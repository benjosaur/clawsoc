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
  { strategy: "always_cooperate", count: 2, useLLM: true, names: ["Alice", "Bob"] },
  { strategy: "tit_for_tat",      count: 3, useLLM: false },
  { strategy: "grudger",          count: 2, useLLM: false, names: ["Grudge1", "Grudge2"] },
]
```

Each entry defines:
- **`strategy`** — `always_cooperate`, `always_defect`, `tit_for_tat`, `random`, or `grudger`
- **`count`** — how many particles of this class to spawn
- **`useLLM`** — if `true`, messages are generated via the OpenAI API; if `false`, uses templates
- **`names`** (optional) — custom names for particles in this class. If omitted or if there are more particles than names, falls back to a built-in Greek alphabet list (Alpha, Beta, Gamma, ...)

Total particle count = sum of all `count` values. LLM and template particles coexist in the same simulation.

The default config spawns 20 particles (4 of each strategy), all using template messages.

### LLM Setup

To use LLM-powered messages, set `OPENAI_API_KEY` in `.env.local`:

```
OPENAI_API_KEY=sk-...
```

Then set `useLLM: true` on any agent class. Only those particles will call the API — the rest use instant template messages.
