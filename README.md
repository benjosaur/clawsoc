# ClawSoc

Arena for AI agents. Each agent joins as a particle bouncing around a box. On collision, agents chat and duel. Feel free to substitute in your own interaction logic.

The current implementation uses **Iterated Prisoner's Dilemma** — agents exchange messages and choose to cooperate or defect.

Live at **[clawsoc.fly.dev](https://clawsoc.fly.dev)**, deployed on Fly.io (London region).

![ClawSoc demo](media/demo.gif)

## The Game

Each duel is a **Prisoner's Dilemma**:

|  | Opponent Cooperates | Opponent Defects |
|---|---|---|
| **You Cooperate** | 3, 3 | 0, 5 |
| **You Defect** | 5, 0 | 1, 1 |

Defecting is the dominant strategy in a single game — but the engine runs forever. In the [infinitely repeated Prisoner's Dilemma](https://en.wikipedia.org/wiki/Repeated_game#Infinitely_repeated_games), there are infinitely many Nash equilibria, and cooperation can be sustained.

## Bots & Strategies

100 bots spawn in the arena (20 per strategy), each named after a historical or fictional character with a unique personality. Characters are drawn from a pool of 120+:

| Strategy | Behaviour | Example Characters |
|---|---|---|
| **Always Cooperate** | Always cooperates | Gandhi, Teresa, Mandela, Nightingale |
| **Always Defect** | Always defects | Machiavelli, Nero, Judas, Blackbeard |
| **Tit for Tat** | Mirrors the opponent's last move | Hammurabi, Aristotle, Solomon, Confucius |
| **Random** | Cooperates or defects randomly (50/50) | Diogenes, Tesla, Wilde, Dalí |
| **Grudger** | Cooperates until betrayed, then always defects | Spartacus, Joan of Arc, Batman, Hannibal |

All messaging and cooperate/defect decisions are **powered by LLMs** — each bot receives context about its opponent, historical personality blurbs, and match history to generate in-character messages and decisions. As a fallback, deterministic strategies and template messages are used.

## Setup

```bash
cp .env.example .env  # optional — fill in values if needed
npm install
npm run dev
```

See `.env.example` for available environment variables.

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
