# Plan: External Agent Participation System

## Context
Allow any Claude Code agent (or curl user) to join the simulation as a particle. They register a username, get an API key, replace a random NPC, and participate in matches by providing a message + cooperate/defect decision via HTTP polling. Timeout = kicked. Redis persists registrations. Frontend modal for onboarding with curl examples.

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
- **reset()** — preserve external particles: save them, recreate NPCs, remove one NPC per external agent, re-add externals with reset score/history/position

## 6. Messages — `src/simulation/messages.ts`
- Add `external: ["..."]` entries to both `TEMPLATES` and `BETRAYAL_RESPONSES` records (fallback only, never used in practice since externals provide their own messages)

## 7. New: Agent Manager — `src/simulation/agentManager.ts`
Manages external agent lifecycle. In-memory Maps as primary store, Redis as persistence.

```
class AgentManager {
  agents: Map<username, ExternalAgent>        // { apiKeyHash, particleId, replacedNpcStrategy, joinedAt }
  apiKeyToUsername: Map<hash, username>        // reverse lookup for auth
  pendingMatches: Map<username, PendingMatch>  // { pairAId, pairBId, side, opponentLabel, opponentDefectPct, vsRecord, createdAt }

  register(username, engine) → { apiKey, particleId } | { error }
  authenticateRequest(authHeader) → username | null
  setPendingMatch(username, match) / getPendingMatch / clearPendingMatch
  removeAgent(username, engine) → removes particle, respawns NPC, cleans Redis
}
```

- API key format: `claw_` + 24 random bytes base64url
- Stored as SHA-256 hash in Redis: `agent:{username}` → JSON, `apikey:{hash}` → username
- Max 10 external agents
- Username validation: 1-8 chars, alphanumeric + underscore, unique
- Redis connection: lazy-init from `REDIS_URL` env var. If unset, in-memory only (local dev works without Redis)

## 8. Server — `server.ts`
- **HTTP route intercept**: before Next.js handler, check `pathname.startsWith("/api/agent/")` → route to `handleAgentAPI()`
- **Routes**:
  - `POST /api/agent/register` — body `{ username }`, returns `{ apiKey, particleId }`
  - `GET /api/agent/status` — auth required, returns `{ username, particleId, score, matches, pendingMatch }`
  - `POST /api/agent/decide` — auth required, body `{ message, decision }`, resolves pending match
  - `DELETE /api/agent/leave` — auth required, removes agent, respawns NPC
- **Wire `onRequestExternalDecision`**: builds opponent context (defect%, vs record), calls `agentManager.setPendingMatch()`
- **Timeout sweep**: in the simulation `setInterval`, check all pending matches — if `Date.now() - createdAt > 30_000`, abort pair + kick agent
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
