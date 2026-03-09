# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is ClawSoc?

A Prisoner's Dilemma particle simulation — an interactive physics-based game where 500 agents (particles) bounce around a canvas, collide, play iterated Prisoner's Dilemma matches, and exchange template messages. Features real-time WebSocket communication, client-side canvas rendering with frame interpolation, and server-side simulation logic.

## Commands

```bash
npm run dev      # Development server (tsx server.ts)
npm run build    # Production build (next build)
npm start        # Production server (node server.js)
npm run lint     # ESLint
bun tsc --noEmit # Type-check (use bun, not npx)
```

No test framework is configured. The Dockerfile also bundles `server.ts` with esbuild for production.

## Architecture

### Server (`server.ts`)

Custom HTTP server integrating Next.js + WebSocket (`ws` library). Runs the simulation loop:
- Every 100ms: runs 6 engine steps, broadcasts a **FastFrame** (positions/state) to all WebSocket clients
- Every 10th interval (~1s): broadcasts a **SlowFrame** (particle metadata, game log, total scores)

Client messages: `pause`, `resume`, `reset`.

### Simulation Engine (`src/simulation/`)

| File | Role |
|------|------|
| `engine.ts` | `SimulationEngine` class — main loop: popup expiry → advance conversations → unfreeze pairs → move particles → detect collisions |
| `types.ts` | All interfaces (`Particle`, `StrategyType`, `SimulationConfig`, `OpponentRecord`) + `DEFAULT_CONFIG` |
| `physics.ts` | Vector math, collision detection, elastic collision resolution, wall bouncing |
| `game.ts` | Payoff matrix (CC=3, CD=0, DC=5, DD=1), match execution |
| `strategies.ts` | Decision logic per strategy type |
| `messages.ts` | Template message generation |
| `protocol.ts` | `FastFrame`, `SlowFrame`, `CanvasView`, `ClientMessage` type definitions |
| `Particle.ts` | Particle factory/initialization |

**5 strategies**: `always_cooperate`, `always_defect`, `tit_for_tat`, `random`, `grudger`

**Collision/match flow** (~180 ticks): `greeting` → `messaging_a` → `messaging_b` → `deciding` → `resolved` → unfreeze

### Frontend (`src/`)

Next.js App Router with `"use client"` components. Path alias: `@/*` → `./src/*`.

- **`app/page.tsx`** — Main page, assembles all panels
- **`hooks/useServerSimulation.ts`** — WebSocket connection, frame buffering, state management. Stores `interpRef` (prev/curr frames + timestamp) for smooth interpolation
- **`components/SimulationCanvas.tsx`** — HTML5 Canvas 2D rendering at 60fps via `requestAnimationFrame`. Interpolates between server frames (10fps). 2x zoom on selected particle
- **`components/PlayerStats.tsx`** — Selected particle stats, outcome matrix, rank
- **`components/ScoreBoard.tsx`** / **`TotalScoreBoard.tsx`** — Strategy leaderboards
- **`components/MatchHistoryPanel.tsx`** — Game log display
- **`components/PlayerSearch.tsx`** — Particle selector dropdown
- **`components/PanelTabs.tsx`** — Mobile tab switcher

## Key Patterns

- **Server owns all simulation state** — clients are pure renderers receiving frames over WebSocket
- **FastFrame** is compact arrays (`[id, x, y, state]`) for bandwidth efficiency; **SlowFrame** carries full metadata
- **Canvas rendering uses refs** (`interpRef`, `viewRef`, `metaRef`) to avoid React re-renders — the canvas draws outside the React lifecycle
- **Particle color** is dynamic, calculated from cooperation ratio (green = cooperative, red = defective)
- **Frozen pairs** — colliding particles freeze in place while the match phases play out

## Deployment

Deployed to Fly.io (London region). Multi-stage Docker build: deps → Next.js build + esbuild bundle → Alpine runner.
