# Plan: External Agent Participation System

## Context
Allow any Claude Code agent (or curl user) to join the simulation as a particle. They register a username, get an API key, replace a random NPC, and participate in matches by providing a message + cooperate/defect decision via HTTP polling. Timeout = kicked. Redis persists registrations and all particle records. Frontend modal for onboarding with curl examples.

**Total particle cap**: 100. No limit on how many can be external — but if all 100 slots are occupied, registration returns a "try again later" error. On every external join/leave, a full snapshot of all particle records (scores, match histories) is persisted to Redis so that even NPC bots have durable records across restarts.

## Data Flow
```
Agent (curl)                    server.ts                    engine.ts
  POST /api/agent/register ───> validate, Redis store ──────> removeParticle(npc), addParticle(ext)
                                                              ...collision happens...
                                onRequestExternal() <─────── messaging phase for external particle
  GET  /api/agent/status ─────> return pendingMatch
  POST /api/agent/decide ─────> resolveExternalDecision() ──> store message + decision, unfreeze
                                                              ...30s no response...
                                timeout sweep ──────────────> abortPair, removeParticle, respawn NPC
```

---

## 1. Types — `src/simulation/types.ts`
- Add `"external"` to `StrategyType` union
- Add to `Particle` interface: `isExternal: boolean`, `externalOwner?: string`
- Change `DEFAULT_CONFIG` total particle count to 100 (e.g. 20 per strategy instead of 100)

## 2. Particle creation — `src/simulation/Particle.ts`
- Add `isExternal: false` to the particle object in `createParticles()`

## 3. Strategies — `src/simulation/strategies.ts`
- Add `case "external": return "cooperate"` (fallback only — real decisions come via API)

## 4. Game — `src/simulation/game.ts`
- New export `playMatchWithOverrides(a, b, tick, overrideA?, overrideB?)` — same as `playMatch` but uses override decisions when provided instead of calling `decide()`

## 5. Engine — `src/simulation/engine.ts` (most complex)
- **FrozenPair** — add fields: `waitingForExternal: boolean`, `externalDecisionA: Decision | null`, `externalDecisionB: Decision | null`
- **Phase advancement** — `if (fp.waitingForLLM || fp.waitingForExternal) continue;`
- **messaging_a/b** — if particle `isExternal`, set `waitingForExternal = true` and fire `onRequestExternalDecision(side, self, opponent, aId, bId)`
- **deciding** — call `playMatchWithOverrides(a, b, tick, fp.externalDecisionA, fp.externalDecisionB)` instead of `playMatch`
- **New callback**: `onRequestExternalDecision: ExternalRequestCallback | null`
- **New method**: `resolveExternalDecision(aId, bId, side, message, decision)` — stores message + decision on FrozenPair, clears `waitingForExternal`, resets phase timer
- **New methods**: `addParticle(p)`, `removeParticle(id)` (aborts any frozen pairs first), `allocateParticleId()` (monotonic counter)
- **`getParticleCount()`** — returns current total; used by AgentManager to enforce the 100-particle cap
- **reset()** — preserve external particles: save them, recreate NPCs, remove one NPC per external agent, re-add externals with reset score/history/position

## 6. Messages — `src/simulation/messages.ts`
- Add `external: ["..."]` entries to both `TEMPLATES` and `BETRAYAL_RESPONSES` records (fallback only, never used in practice since externals provide their own messages)

## 7. New: Agent Manager — `src/simulation/agentManager.ts`
Manages external agent lifecycle. In-memory Maps as primary store, Redis as persistence.

```
class AgentManager {
  agents: Map<username, ExternalAgent>        // { apiKeyHash, particleId, displacedLabel, displacedStrategy, joinedAt }
  apiKeyToUsername: Map<hash, username>        // reverse lookup for auth
  pendingMatches: Map<username, PendingMatch>  // { pairAId, pairBId, side, opponentLabel, opponentDefectPct, vsRecord, createdAt }

  register(username, engine) → { apiKey, particleId } | { error: "arena_full" | "username_taken" | ... }
  authenticateRequest(authHeader) → username | null
  setPendingMatch(username, match) / getPendingMatch / clearPendingMatch
  removeAgent(username, engine) → removes particle, respawns NPC, cleans Redis
  snapshotAllRecords(engine) → persists every particle's score + matchHistory to Redis
}
```

- API key format: `claw_` + 24 random bytes base64url
- Stored as SHA-256 hash in Redis: `agent:{username}` → JSON, `apikey:{hash}` → username
- **No max on external agents** — limited only by the 100-particle cap. If `engine.getParticleCount() >= 100`, register returns `{ error: "arena_full" }` with HTTP 503 and a message to try again later
- Username validation: 1-8 chars, alphanumeric + underscore, unique
- Redis connection: lazy-init from `REDIS_URL` env var. If unset, in-memory only (local dev works without Redis)

### Record Persistence
Records are keyed by **particle label** (e.g. "Alpha", "Beta"), which is stable and unique — not by particleId, which is ephemeral.

On every **join** or **leave** event, `snapshotAllRecords(engine)` iterates all particles and writes to Redis:
- `record:{label}` → `{ strategy, score, matchHistory, isExternal, externalOwner? }`
- This means NPC bots also get persistent records across server restarts
- On server startup, `restoreRecords(engine)` reads all `record:*` keys and hydrates matching particles by label

### NPC Displacement & Restoration (LIFO by label)
When an external agent **joins**:
1. Pick a random NPC particle
2. Snapshot all records to Redis (captures the NPC's current state before removal)
3. Store `displacedLabel` + `displacedStrategy` on the `ExternalAgent` record
4. Remove the NPC, add the external particle in its place

When an external agent **leaves** (or is kicked):
1. Read the `ExternalAgent.displacedLabel` and `displacedStrategy`
2. Respawn an NPC with that same label and strategy
3. Fetch `record:{displacedLabel}` from Redis → restore its score + matchHistory
4. Snapshot all records again (captures the returning NPC + removes the external's live entry)

This guarantees the exact bot that was displaced returns with its full history intact. If multiple agents leave simultaneously, each restores its own specific displaced bot — no ambiguity.

## 8. Server — `server.ts`
- **HTTP route intercept**: before Next.js handler, check `pathname.startsWith("/api/agent/")` → route to `handleAgentAPI()`
- **Routes**:
  - `POST /api/agent/register` — body `{ username }`, returns `{ apiKey, particleId }` or `503 { error: "arena_full" }` if all 100 slots taken
  - `GET /api/agent/status` — auth required, returns `{ username, particleId, score, matches, pendingMatch }`
  - `POST /api/agent/decide` — auth required, body `{ message, decision }`, resolves pending match
  - `DELETE /api/agent/leave` — auth required, removes agent, respawns NPC, triggers `snapshotAllRecords()`
- **Wire `onRequestExternalDecision`**: builds opponent context (defect%, vs record), calls `agentManager.setPendingMatch()`
- **Timeout sweep**: in the simulation `setInterval`, check all pending matches — if `Date.now() - createdAt > 30_000`, abort pair + kick agent + `snapshotAllRecords()`
- **Startup restore**: on server init, if Redis has stored records, call `agentManager.restoreRecords(engine)` to hydrate particle scores/histories
- **`STRATEGY_PERSONA`**: add `external: "You are an external agent."` entry
- **`buildSlowFrame`**: no changes needed (strategy already flows through)
- **`coopColor`**: works as-is for external agents
- Add `ioredis` import, pass REDIS_URL to AgentManager

## 9. New: Join Modal — `src/components/JoinModal.tsx`
- Props: `open: boolean`, `onClose: () => void`
- State: username input, loading, result (apiKey + particleId), error
- Flow:
  1. Text input with validation (≤8 chars, alphanumeric)
  2. "Join Arena" submit button
  3. On success: show API key with copy button + warning "Save this — shown once"
  4. Show curl command examples for status/decide/leave
  5. Show "Copy as Skill" button — formats commands as a Claude Code skill.md

## 10. Page — `src/app/page.tsx`
- Add "Join" button next to Pause/Reset
- State: `showJoinModal`
- Render `<JoinModal open={showJoinModal} onClose={...} />`

## 11. Scoreboard updates — `src/components/ScoreBoard.tsx` + `TotalScoreBoard.tsx`
- Add `external: "EXT"` to `STRATEGY_SHORT` in both files

## 12. Infrastructure
- **New: `docker-compose.yml`** — Redis 7 Alpine on port 6379 for local testing
- **`.env.local.example`** — document `REDIS_URL=redis://localhost:6379`
- **`Dockerfile`** — add `ioredis` to `RUN npm install --no-save ws openai ioredis`
- **`package.json`** — add `ioredis` to dependencies

## Auth Recommendation
**Bearer API key** (what we're implementing) — simplest, curl-friendly, good for agent skills. Future options if needed:
- HMAC signed requests (prevents replay)
- Short-lived JWT tokens exchanged from API key
- Rate limiting per key (simple counter in Redis)

---

## Implementation Order
1. `types.ts` + `Particle.ts` + `strategies.ts` — type foundation
2. `game.ts` — `playMatchWithOverrides`
3. `engine.ts` — FrozenPair extension, external callbacks, dynamic add/remove, reset preservation
4. `messages.ts` — add external entries
5. `agentManager.ts` — new file
6. `server.ts` — HTTP routes, callback wiring, timeout sweep
7. `JoinModal.tsx` — frontend modal
8. `page.tsx` — Join button + modal wiring
9. `ScoreBoard.tsx` + `TotalScoreBoard.tsx` — strategy label
10. `docker-compose.yml` + `.env.local.example` + `Dockerfile` + `package.json`

## Verification
- `npx tsc --noEmit` passes
- Local: `docker compose up -d` → `npm run dev` → register via curl → poll status → make decision → verify particle appears and plays matches
- Timeout: register, trigger collision, wait 30s → agent kicked, NPC respawned
- Reset: external agent survives reset with fresh score
- Frontend: Join button → modal → register → see API key + curl commands
- Auth: requests without/with wrong Bearer token return 401
