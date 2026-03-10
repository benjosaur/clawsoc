/**
 * ClawSoc Edge Case Tests — Turn API, State Machine Guards, Check-Username
 *
 * Usage:
 *   bun tests/edge-turn-api.ts              # remote (clawsoc.io)
 *   bun tests/edge-turn-api.ts local        # local  (localhost:3000)
 *   bun tests/edge-turn-api.ts local -v     # local with verbose request/response logging
 *
 * Tests:
 *   - /api/agent/turn validation (type, decision)
 *   - State machine guards on /api/agent/match (concurrent calls, pending match)
 *   - /api/agent/check-username edge cases
 *   - Username validation boundaries
 *
 * Note: Some tests wait for a collision (up to 120s).
 * Note: check-username and register share a strict rate limit (10 req/min).
 *       Tests include short delays to avoid 429s.
 */

const local = process.argv.includes("local");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
const BASE = local ? "http://localhost:3000" : "https://clawsoc.io";

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name: string) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}

function fail(name: string, reason: string) {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${name}: ${reason}`);
}

function skip(name: string, reason: string) {
  skipped++;
  console.log(`  \x1b[33m-\x1b[0m ${name}: ${reason}`);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass(name);
  } catch (e: any) {
    fail(name, e.message ?? String(e));
  }
}

function expect(val: any, msg: string) {
  if (!val) throw new Error(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Verbose-aware fetch: logs request/response details when -v is set. */
async function tracedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : (input as Request).url;
  const method = init?.method ?? "GET";
  const path = url.replace(BASE, "");
  if (verbose) {
    let line = `    \x1b[2m→ ${method} ${path}\x1b[0m`;
    if (init?.body) line += `\x1b[2m  ${String(init.body).slice(0, 120)}\x1b[0m`;
    console.log(line);
  }
  const res = await fetch(input, init);
  if (verbose) {
    const clone = res.clone();
    const text = await clone.text().catch(() => "");
    console.log(`    \x1b[2m← ${res.status} ${text.slice(0, 200)}\x1b[0m`);
  }
  return res;
}

/** Retry a fetch if rate-limited (429). Waits for Retry-After header. */
async function fetchRetry(input: RequestInfo, init?: RequestInit, maxRetries = 3): Promise<Response> {
  for (let i = 0; i <= maxRetries; i++) {
    const res = await tracedFetch(input, init);
    if (res.status !== 429 || i === maxRetries) return res;
    const wait = parseInt(res.headers.get("retry-after") || "2", 10);
    await sleep((wait + 1) * 1000);
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const TEST_USER = `eturn_${Date.now().toString(36)}`;
let apiKey = "";

async function setup() {
  console.log("\n\x1b[1mSetup\x1b[0m");

  await test("register test agent", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USER }),
    });
    const body = await res.json();
    expect(res.ok, `status ${res.status}: ${JSON.stringify(body)}`);
    expect(body.apiKey, "missing apiKey");
    apiKey = body.apiKey;
  });
}

// ---------------------------------------------------------------------------
// 1. Check-Username Endpoint
//    Rate-limited at 10 req/min — we batch validation-only tests (empty,
//    special chars, reserved, too-long) with short pauses.
// ---------------------------------------------------------------------------
async function testCheckUsername() {
  console.log("\n\x1b[1mCheck-Username Endpoint\x1b[0m");

  await test("available name returns {available: true}", async () => {
    const name = `avail_${Date.now().toString(36)}`;
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=${name}`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === true, `expected available: true, got ${JSON.stringify(body)}`);
  });

  await test("taken name returns {available: false}", async () => {
    if (!apiKey) throw new Error("no apiKey");
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=${TEST_USER}`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === false, `expected available: false, got ${JSON.stringify(body)}`);
  });

  await test("check-username is case-insensitive", async () => {
    if (!apiKey) throw new Error("no apiKey");
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=${TEST_USER.toUpperCase()}`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === false, `expected false (case-insensitive), got ${JSON.stringify(body)}`);
  });

  await test("empty name returns {available: false}", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === false, `expected available: false, got ${JSON.stringify(body)}`);
    expect(body.reason, "expected a reason");
  });

  await test("special chars returns {available: false}", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=bad!name`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === false, `expected available: false, got ${JSON.stringify(body)}`);
    expect(body.reason?.includes("special characters"), `expected special char reason, got '${body.reason}'`);
  });

  // "gandhi" is a reserved NPC name — defined in DEFAULT_CONFIG.agentClasses (src/simulation/types.ts)
  await test("reserved bot name returns {available: false}", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=gandhi`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === false, `expected available: false, got ${JSON.stringify(body)}`);
  });

  await test("9-char name returns {available: false}", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/check-username?username=${"a".repeat(9)}`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.available === false, `expected available: false, got ${JSON.stringify(body)}`);
    expect(body.reason?.includes("8"), `expected length reason, got '${body.reason}'`);
  });

  // fetchRetry handles 429s automatically
}

// ---------------------------------------------------------------------------
// 2. Username Validation Boundaries
// ---------------------------------------------------------------------------
async function testUsernameBoundaries() {
  console.log("\n\x1b[1mUsername Validation Boundaries\x1b[0m");

  const eightCharName = `b${Date.now().toString(36)}`.slice(0, 8).padEnd(8, "x");
  let eightKey = "";

  await test("register with exactly 8-char username succeeds", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: eightCharName }),
    });
    const body = await res.json();
    expect(res.ok, `status ${res.status}: ${JSON.stringify(body)}`);
    eightKey = body.apiKey;
  });

  // Clean up the 8-char user
  if (eightKey) {
    await test("cleanup: leave 8-char agent", async () => {
      const res = await tracedFetch(`${BASE}/api/agent/leave?username=${eightCharName.toLowerCase()}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${eightKey}` },
      });
      expect(res.ok, `status ${res.status}`);
    });
  }

  await test("register with 17-char username returns 400", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "a".repeat(17) }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 3. Turn API — No Pending Match
// ---------------------------------------------------------------------------
async function testTurnNoPendingMatch() {
  console.log("\n\x1b[1mTurn API — No Pending Match\x1b[0m");

  if (!apiKey) {
    skip("turn tests (no pending match)", "no apiKey");
    return;
  }

  await test("turn with missing type returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    expect(body.error?.includes("type"), `expected type error, got '${body.error}'`);
  });

  await test("turn with invalid type returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ type: "invalid" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("turn with type=decision but missing decision returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ type: "decision" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("turn with type=decision and invalid decision returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ type: "decision", decision: "maybe" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("turn with no pending match returns 409", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ type: "decision", decision: "cooperate" }),
    });
    expect(res.status === 409, `expected 409, got ${res.status}`);
    const body = await res.json();
    expect(body.error?.includes("not your turn"), `unexpected error: ${body.error}`);
  });
}

// ---------------------------------------------------------------------------
// 4. State Machine Guards on /match
// ---------------------------------------------------------------------------
async function testMatchGuards() {
  console.log("\n\x1b[1mState Machine Guards on /match\x1b[0m");

  if (!apiKey) {
    skip("match guard tests", "no apiKey");
    return;
  }

  await test("second concurrent /match returns 409", async () => {
    // Fire first /match (will block waiting for collision)
    const controller = new AbortController();
    const firstMatch = tracedFetch(`${BASE}/api/agent/match?username=${TEST_USER}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    }).catch(() => null); // ignore abort error

    // Give the first request time to register the waiter
    await sleep(500);

    // Fire second /match — should get 409 immediately
    const secondRes = await tracedFetch(`${BASE}/api/agent/match?username=${TEST_USER}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Cancel the first request
    controller.abort();
    await firstMatch;

    expect(secondRes.status === 409, `expected 409, got ${secondRes.status}`);
    const body = await secondRes.json();
    // Either "already waiting" (waiter guard) or "pending match" (collision happened during wait)
    expect(
      body.error?.includes("already waiting") || body.error?.includes("pending match"),
      `expected match guard 409, got '${body.error}'`
    );
  });

  // The aborted /match leaves a stale waiter on the server. Clean up by
  // leaving and re-registering the agent so the next /match call starts fresh.
  await test("reset agent state after concurrent match test", async () => {
    const leaveRes = await tracedFetch(`${BASE}/api/agent/leave?username=${TEST_USER}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(leaveRes.ok, `leave failed: ${leaveRes.status}`);

    // Wait for register rate limit to recover (10 req/min ≈ 6s per token)
    await sleep(7000);

    const regRes = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USER }),
    });
    const body = await regRes.json();
    expect(regRes.ok, `re-register failed: ${regRes.status}: ${JSON.stringify(body)}`);
    apiKey = body.apiKey;
  });
}

// ---------------------------------------------------------------------------
// 5. Full Turn API — With Real Match
// ---------------------------------------------------------------------------
async function testTurnWithMatch() {
  console.log("\n\x1b[1mTurn API — With Real Match\x1b[0m");

  if (!apiKey) {
    skip("turn with match tests", "no apiKey");
    return;
  }

  let matchData: any = null;

  await test("wait for match (up to 120s)", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/match?username=${TEST_USER}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(120_000),
    });
    expect(res.ok, `match failed: ${res.status}`);
    matchData = await res.json();
    expect(matchData.opponent, "missing opponent in match response");
  });

  if (!matchData) {
    skip("submit decision via /turn and get result", "no match");
    skip("/match with pending match returns 409", "no match");
    return;
  }

  // Before deciding, test the pending match guard
  await test("/match with pending match returns 409", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/match?username=${TEST_USER}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status === 409, `expected 409, got ${res.status}`);
    const body = await res.json();
    expect(body.status === "pending_match", `expected status=pending_match, got '${body.status}'`);
    expect(body.opponent, "expected opponent in 409 response");
  });

  await test("submit decision via /turn and receive result", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ type: "decision", decision: "cooperate" }),
      signal: AbortSignal.timeout(20_000),
    });
    expect(res.ok, `turn failed: ${res.status}`);
    const body = await res.json();
    expect(body.ok === true, `expected ok: true, got ${JSON.stringify(body)}`);
    // Result may be null (timeout) or contain match outcome
    if (body.result) {
      expect(typeof body.result.yourDecision === "string", "missing yourDecision");
      expect(typeof body.result.theirDecision === "string", "missing theirDecision");
      expect(typeof body.result.yourScore === "number", "missing yourScore");
    }
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanup() {
  console.log("\n\x1b[1mCleanup\x1b[0m");

  if (apiKey) {
    await test("leave test agent", async () => {
      const res = await tracedFetch(`${BASE}/api/agent/leave?username=${TEST_USER}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      // Agent may have been auto-removed by parked timeout — 200 or 401 both ok
      expect(res.ok || res.status === 401, `unexpected status ${res.status}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1;36mClawSoc Edge Tests — Turn API & State Machine\x1b[0m — ${BASE}`);
  console.log(`Test agent: ${TEST_USER}\n`);

  await setup();
  // Run non-rate-limited tests first to let register limiter recover
  await testTurnNoPendingMatch();
  await testMatchGuards();
  await testTurnWithMatch();
  // Rate-limited tests (check-username + register share 10 req/min limiter)
  await testCheckUsername();
  await testUsernameBoundaries();
  await cleanup();

  const total = passed + failed + skipped;
  let summary = `\n\x1b[1m${total} tests: \x1b[32m${passed} passed\x1b[0m`;
  if (failed) summary += `, \x1b[31m${failed} failed\x1b[0m`;
  if (skipped) summary += `, \x1b[33m${skipped} skipped\x1b[0m`;
  console.log(summary + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
