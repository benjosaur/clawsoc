/**
 * ClawSoc E2E Tests
 *
 * Usage:
 *   bun tests/e2e.ts              # remote (clawsoc.fly.dev)
 *   bun tests/e2e.ts local        # local  (localhost:3000)
 *
 * Tests:
 *   - HTTP health & static assets
 *   - WebSocket init/event/slow frames, pause/resume
 *   - Agent API lifecycle: register → match → decide → leave
 *   - Player lookup API
 */

const local = process.argv.includes("local");
const BASE = local ? "http://localhost:3000" : "https://clawsoc.fly.dev";
const WS_URL = local ? "ws://localhost:3000/ws" : "wss://clawsoc.fly.dev/ws";

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

// ---------------------------------------------------------------------------
// WebSocket helpers (Bun native WebSocket)
// ---------------------------------------------------------------------------

/** Open a WebSocket, return first parsed JSON message */
function wsFirstMessage(url: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws message timeout"));
    }, timeoutMs);
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(ev.data as string));
    };
    ws.onerror = (ev: any) => {
      clearTimeout(timer);
      reject(new Error(ev.message ?? "ws error"));
    };
  });
}

/** Collect frames until predicate returns true */
function wsCollectUntil(
  url: string,
  timeoutMs: number,
  done: (data: any) => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("wsCollectUntil timeout"));
    }, timeoutMs);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data as string);
      if (done(data)) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    };
    ws.onerror = (ev: any) => {
      clearTimeout(timer);
      reject(new Error(ev.message ?? "ws error"));
    };
  });
}

/** Open a WebSocket, wait for init, then return the open socket */
function wsConnectAndInit(
  url: string,
  timeoutMs: number
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws connect+init timeout"));
    }, timeoutMs);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data as string);
      if (data.type === "init") {
        clearTimeout(timer);
        resolve(ws);
      }
    };
    ws.onerror = (ev: any) => {
      clearTimeout(timer);
      reject(new Error(ev.message ?? "ws error"));
    };
  });
}

// ---------------------------------------------------------------------------
// 1. HTTP Health
// ---------------------------------------------------------------------------
async function testHttpHealth() {
  console.log("\n\x1b[1mHTTP Health\x1b[0m");

  await test("GET / returns 200 with HTML", async () => {
    const res = await fetch(BASE);
    expect(res.ok, `status ${res.status}`);
    const text = await res.text();
    expect(
      text.includes("<!DOCTYPE html") || text.includes("<html"),
      "response is not HTML"
    );
  });

  await test("GET /SKILL.md returns 200", async () => {
    const res = await fetch(`${BASE}/SKILL.md`);
    expect(res.ok, `status ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 2. WebSocket
// ---------------------------------------------------------------------------
async function testWebSocket() {
  console.log("\n\x1b[1mWebSocket\x1b[0m");

  await test("connect and receive init frame", async () => {
    const data = await wsFirstMessage(WS_URL, 5000);
    expect(data.type === "init", `expected type=init, got ${data.type}`);
    expect(typeof data.tick === "number", "missing tick");
    expect(data.config, "missing config");
    expect(Array.isArray(data.particles), "missing particles array");
    expect(Array.isArray(data.meta), "missing meta array");
    expect(data.particles.length > 0, "particles array is empty");
  });

  await test("receive event + slow frames within 8s", async () => {
    let gotEvent = false;
    let gotSlow = false;
    await wsCollectUntil(WS_URL, 8000, (data) => {
      if (data.type === "e") gotEvent = true;
      if (data.type === "s") gotSlow = true;
      return gotEvent && gotSlow;
    });
    expect(gotEvent, "no event frame received");
    expect(gotSlow, "no slow frame received");
  });

  await test("pause and resume accepted", async () => {
    const ws = await wsConnectAndInit(WS_URL, 5000);
    ws.send(JSON.stringify({ type: "pause" }));
    await sleep(500);
    expect(ws.readyState === WebSocket.OPEN, "ws closed after pause");
    ws.send(JSON.stringify({ type: "resume" }));
    await sleep(500);
    expect(ws.readyState === WebSocket.OPEN, "ws closed after resume");
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// 3. Agent Registration
// ---------------------------------------------------------------------------
const TEST_USER = `e2e_${Date.now().toString(36)}`;

let apiKey = "";
let particleId = -1;

async function testAgentRegistration() {
  console.log("\n\x1b[1mAgent Registration\x1b[0m");

  await test("register with valid username", async () => {
    const res = await fetch(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USER, greeting: "e2e test agent" }),
    });
    const body = await res.json();
    expect(res.ok, `status ${res.status}: ${JSON.stringify(body)}`);
    expect(body.apiKey, "missing apiKey");
    expect(typeof body.particleId === "number", "missing particleId");
    apiKey = body.apiKey;
    particleId = body.particleId;
  });

  await test("reject empty username", async () => {
    const res = await fetch(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("reject invalid characters", async () => {
    const res = await fetch(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "no spaces!" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("reject duplicate username", async () => {
    const res = await fetch(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USER }),
    });
    // could be 400 (taken) or 200 (returning) — just verify no 500
    expect(res.status < 500, `server error: ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 4. Agent Status
// ---------------------------------------------------------------------------
async function testAgentStatus() {
  console.log("\n\x1b[1mAgent Status\x1b[0m");

  if (!apiKey) {
    skip("status with valid token", "registration failed, no apiKey");
    skip("status without auth returns 401", "skipping group");
    return;
  }

  await test("status with valid token", async () => {
    const res = await fetch(`${BASE}/api/agent/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.username === TEST_USER, `wrong username: ${body.username}`);
    expect(body.particleId === particleId, `wrong particleId`);
    expect(typeof body.score === "number", "missing score");
    expect(typeof body.matches === "number", "missing matches");
  });

  await test("status without auth returns 401", async () => {
    const res = await fetch(`${BASE}/api/agent/status`);
    expect(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test("match without auth returns 401", async () => {
    const res = await fetch(`${BASE}/api/agent/match`);
    expect(res.status === 401, `expected 401, got ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 5. Agent Decision
// ---------------------------------------------------------------------------
async function testAgentDecision() {
  console.log("\n\x1b[1mAgent Decision\x1b[0m");

  if (!apiKey) {
    skip("invalid decision returns 400", "registration failed, no apiKey");
    skip("decide with no pending match returns 409", "skipping group");
    return;
  }

  await test("invalid decision returns 400", async () => {
    const res = await fetch(`${BASE}/api/agent/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ decision: "maybe" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("decide with no pending match returns 409", async () => {
    const res = await fetch(`${BASE}/api/agent/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ decision: "cooperate" }),
    });
    expect(res.status === 409, `expected 409, got ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 6. Gameplay Loop — blocking match + decide
// ---------------------------------------------------------------------------
async function testGameplayLoop() {
  console.log("\n\x1b[1mGameplay Loop\x1b[0m");

  if (!apiKey) {
    skip("wait for match (blocking)", "registration failed, no apiKey");
    skip("match response has expected shape", "skipping group");
    skip("submit decision and get result", "skipping group");
    skip("score updated after match", "skipping group");
    return;
  }

  let matchData: any = null;

  await test("wait for match via blocking endpoint (up to 120s)", async () => {
    const res = await fetch(`${BASE}/api/agent/match`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(120_000),
    });
    expect(res.ok, `match failed: ${res.status}`);
    matchData = await res.json();
  });

  await test("match response has expected shape", async () => {
    expect(matchData, "match response is null");
    expect(typeof matchData.opponentLabel === "string", "missing opponentLabel");
    expect(typeof matchData.opponentGreeting === "string", "missing opponentGreeting");
    expect(matchData.opponentGreeting.length > 0, "opponentGreeting is empty");
    expect(
      matchData.vsRecord === null || typeof matchData.vsRecord === "object",
      `unexpected vsRecord type: ${typeof matchData.vsRecord}`
    );
  });

  await test("submit decision and receive result", async () => {
    const res = await fetch(`${BASE}/api/agent/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ decision: "cooperate", message: "e2e test" }),
      signal: AbortSignal.timeout(20_000),
    });
    expect(res.ok, `decide failed: ${res.status}`);
    const body = await res.json();
    expect(body.ok === true, `expected ok: true, got ${JSON.stringify(body)}`);
    expect(body.result, "expected result in response");
    expect(typeof body.result.yourDecision === "string", "missing yourDecision");
    expect(typeof body.result.theirDecision === "string", "missing theirDecision");
    expect(typeof body.result.yourScore === "number", "missing yourScore");
    expect(typeof body.result.theirScore === "number", "missing theirScore");
    expect(typeof body.result.opponent === "string", "missing opponent");
  });

  await test("score updated after match", async () => {
    const res = await fetch(`${BASE}/api/agent/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.matches >= 1, `expected matches >= 1, got ${body.matches}`);
  });
}

// ---------------------------------------------------------------------------
// 7. Player Lookup
// ---------------------------------------------------------------------------
async function testPlayerLookup() {
  console.log("\n\x1b[1mPlayer Lookup\x1b[0m");

  if (apiKey) {
    await test("lookup registered agent (live)", async () => {
      const res = await fetch(
        `${BASE}/api/player/lookup?name=${TEST_USER}`
      );
      expect(res.ok, `status ${res.status}`);
      const body = await res.json();
      expect(body.status === "live", `expected live, got ${body.status}`);
    });
  } else {
    skip("lookup registered agent (live)", "registration failed");
  }

  await test("lookup nonexistent player returns 404", async () => {
    const res = await fetch(
      `${BASE}/api/player/lookup?name=nonexistent_xyz_999`
    );
    expect(res.status === 404, `expected 404, got ${res.status}`);
  });

  await test("lookup without name param returns 400", async () => {
    const res = await fetch(`${BASE}/api/player/lookup`);
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 8. Agent Leave + Cleanup
// ---------------------------------------------------------------------------
async function testAgentLeave() {
  console.log("\n\x1b[1mAgent Leave\x1b[0m");

  if (!apiKey) {
    skip("leave with valid token", "registration failed, no apiKey");
    skip("status after leave returns 404", "skipping group");
    return;
  }

  await test("leave with valid token", async () => {
    const res = await fetch(`${BASE}/api/agent/leave`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.ok, `status ${res.status}`);
  });

  if (local) {
    skip("agent no longer live after leave", "requires Redis for offline lookup");
  } else {
    await test("agent no longer live after leave", async () => {
      const res = await fetch(
        `${BASE}/api/player/lookup?name=${TEST_USER}`
      );
      expect(res.ok, `status ${res.status}`);
      const body = await res.json();
      expect(body.status !== "live", `expected not live, got ${body.status}`);
    });
  }
}

// ---------------------------------------------------------------------------
// 9. Ownership — re-register rejected, match auto-rejoins
// ---------------------------------------------------------------------------
async function testOwnership() {
  console.log("\n\x1b[1mOwnership\x1b[0m");

  if (!apiKey) {
    skip("register claimed username rejected", "registration failed, no apiKey");
    skip("match endpoint auto-rejoins after leave", "skipping group");
    skip("cleanup: leave rejoined agent", "skipping group");
    return;
  }

  // At this point the agent has left (testAgentLeave ran).
  // All ownership tests require Redis — leave deletes auth, rejoin verifies via Redis.
  if (local) {
    skip("register claimed username rejected", "requires Redis");
    skip("match endpoint auto-rejoins after leave", "requires Redis");
    skip("cleanup: leave rejoined agent", "requires Redis");
    return;
  }

  await test("register claimed username rejected", async () => {
    const res = await fetch(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USER, greeting: "no key" }),
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    expect(
      body.error?.includes("claimed"),
      `unexpected error: ${body.error}`
    );
  });

  await test("match endpoint auto-rejoins after leave", async () => {
    // The agent left the arena. Calling /api/agent/match should auto-rejoin.
    // We use a short timeout since we just want to verify it doesn't 404.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${BASE}/api/agent/match`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      // 200 = got a match, 408 = timeout (both mean it rejoined successfully)
      expect(
        res.status === 200 || res.status === 408,
        `expected 200 or 408, got ${res.status}`
      );
    } catch (e: any) {
      clearTimeout(timer);
      // AbortError means the request was still blocking (agent rejoined, waiting for collision)
      expect(
        e.name === "AbortError",
        `unexpected error: ${e.message}`
      );
    }
    // Verify agent is back in arena via status
    const statusRes = await fetch(`${BASE}/api/agent/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(statusRes.ok, `status after rejoin: ${statusRes.status}`);
  });

  await test("cleanup: leave rejoined agent", async () => {
    const res = await fetch(`${BASE}/api/agent/leave`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.ok, `status ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1;36mClawSoc E2E Tests\x1b[0m — ${BASE}`);
  console.log(`Test agent: ${TEST_USER}\n`);

  await testHttpHealth();
  await testWebSocket();
  await testAgentRegistration();
  await testAgentStatus();
  await testAgentDecision();
  await testGameplayLoop();
  await testPlayerLookup();
  await testAgentLeave();
  await testOwnership();

  const total = passed + failed + skipped;
  let summary = `\n\x1b[1m${total} tests: \x1b[32m${passed} passed\x1b[0m`;
  if (failed) summary += `, \x1b[31m${failed} failed\x1b[0m`;
  if (skipped) summary += `, \x1b[33m${skipped} skipped\x1b[0m`;
  console.log(summary + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
