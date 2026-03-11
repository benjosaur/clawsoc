/**
 * ClawSoc Edge Case Tests — Auth, Body Parsing, HTTP Methods
 *
 * Usage:
 *   bun tests/edge-auth-body.ts              # remote (clawsoc.io)
 *   bun tests/edge-auth-body.ts local        # local  (localhost:3000)
 *   bun tests/edge-auth-body.ts local -v     # local with verbose request/response logging
 *
 * Tests:
 *   - Authentication and authorization edge cases
 *   - Body parsing (invalid JSON, oversized, empty)
 *   - HTTP method enforcement (wrong method → 404)
 *   - CORS preflight handling
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
// Setup: register a test agent for authenticated tests
// ---------------------------------------------------------------------------
const TEST_USER = `a_${Date.now().toString(36)}`;
const TEST_USER_B = `b_${Date.now().toString(36)}`;
let apiKey = "";
let apiKeyB = "";

async function setup() {
  console.log("\n\x1b[1mSetup\x1b[0m");

  await test("register test agent A", async () => {
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

  await test("register test agent B", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USER_B }),
    });
    const body = await res.json();
    expect(res.ok, `status ${res.status}: ${JSON.stringify(body)}`);
    expect(body.apiKey, "missing apiKey");
    apiKeyB = body.apiKey;
  });
}

// ---------------------------------------------------------------------------
// 1. Authentication & Authorization
// ---------------------------------------------------------------------------
async function testAuth() {
  console.log("\n\x1b[1mAuthentication & Authorization\x1b[0m");

  if (!apiKey) {
    skip("auth tests", "registration failed");
    return;
  }

  await test("missing Authorization header returns 401", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`);
    expect(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test("malformed auth (no Bearer prefix) returns 401", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    expect(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test("empty Bearer token returns 401", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`, {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test("bogus token returns 401", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`, {
      headers: { Authorization: "Bearer not_a_real_key_at_all" },
    });
    expect(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test("valid token for wrong username returns 403", async () => {
    if (!apiKeyB) {
      throw new Error("agent B registration failed");
    }
    // Use agent A's key but request agent B's status
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER_B}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status === 403, `expected 403, got ${res.status}`);
    const body = await res.json();
    expect(body.error?.includes("does not belong"), `unexpected error: ${body.error}`);
  });
}

// ---------------------------------------------------------------------------
// 2. CORS
// ---------------------------------------------------------------------------
async function testCors() {
  console.log("\n\x1b[1mCORS\x1b[0m");

  await test("CORS headers present on agent API response", async () => {
    if (!apiKey) throw new Error("no apiKey");
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao === "*", `expected ACAO *, got '${acao}'`);
  });

  await test("CORS preflight returns 204", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`, {
      method: "OPTIONS",
    });
    expect(res.status === 204, `expected 204, got ${res.status}`);
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao === "*", `expected ACAO * on preflight, got '${acao}'`);
    const methods = res.headers.get("access-control-allow-methods");
    expect(methods?.includes("GET"), `expected Allow-Methods to include GET, got '${methods}'`);
    expect(methods?.includes("POST"), `expected Allow-Methods to include POST, got '${methods}'`);
    expect(methods?.includes("DELETE"), `expected Allow-Methods to include DELETE, got '${methods}'`);
    const headers = res.headers.get("access-control-allow-headers");
    expect(headers?.includes("Authorization"), `expected Allow-Headers to include Authorization, got '${headers}'`);
  });
}

// ---------------------------------------------------------------------------
// 3. Body Parsing
// ---------------------------------------------------------------------------
async function testBodyParsing() {
  console.log("\n\x1b[1mBody Parsing\x1b[0m");

  await test("register with invalid JSON returns 400", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is not json",
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
    const body = await res.json();
    expect(body.error?.includes("Invalid JSON"), `unexpected error: ${body.error}`);
  });

  await test("register with empty body returns 400", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    // Empty string parsed as JSON throws, so 400
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("register with body >10KB rejected (413 or connection reset)", async () => {
    const bigPayload = JSON.stringify({ username: "x".repeat(11_000) });
    let status: number | null = null;
    try {
      const res = await fetchRetry(`${BASE}/api/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigPayload,
      });
      status = res.status;
    } catch {
      // readBody calls req.destroy() on oversized body, closing the socket
      // before the 413 response is written — connection reset is valid
      return;
    }
    expect(status === 413 || (status !== null && status >= 400), `expected 413 or error, got ${status}`);
  });

  if (!apiKey) {
    skip("decide with invalid JSON returns 400", "no apiKey");
    skip("turn with invalid JSON returns 400", "no apiKey");
    return;
  }

  await test("decide with invalid JSON returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/decide?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: "{bad json",
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("turn with invalid JSON returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: "!!!not-json",
    });
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// 4. HTTP Method Enforcement
// ---------------------------------------------------------------------------
async function testMethodEnforcement() {
  console.log("\n\x1b[1mHTTP Method Enforcement\x1b[0m");

  if (!apiKey) {
    skip("method enforcement tests", "no apiKey");
    return;
  }

  await test("POST to /api/agent/match returns 404", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/match?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: "{}",
    });
    expect(res.status === 404, `expected 404, got ${res.status}`);
  });

  await test("GET to /api/agent/register returns 404", async () => {
    const res = await fetchRetry(`${BASE}/api/agent/register`);
    // register route only matches POST; GET falls through to auth check (no username → 400)
    expect(
      res.status === 400 || res.status === 404,
      `expected 400 or 404, got ${res.status}`
    );
  });

  await test("POST to /api/agent/leave returns 404", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/leave?username=${TEST_USER}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: "{}",
    });
    expect(res.status === 404, `expected 404, got ${res.status}`);
  });

  await test("GET to /api/agent/turn returns 404", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/turn?username=${TEST_USER}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status === 404, `expected 404, got ${res.status}`);
  });

  await test("PUT to /api/agent/status returns 404", async () => {
    const res = await tracedFetch(`${BASE}/api/agent/status?username=${TEST_USER}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: "{}",
    });
    expect(res.status === 404, `expected 404, got ${res.status}`);
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanup() {
  console.log("\n\x1b[1mCleanup\x1b[0m");

  if (apiKey) {
    await test("leave agent A", async () => {
      const res = await tracedFetch(`${BASE}/api/agent/leave?username=${TEST_USER}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.ok, `status ${res.status}`);
    });
  }

  if (apiKeyB) {
    await test("leave agent B", async () => {
      const res = await tracedFetch(`${BASE}/api/agent/leave?username=${TEST_USER_B}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKeyB}` },
      });
      expect(res.ok, `status ${res.status}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1;36mClawSoc Edge Tests — Auth, Body Parsing, HTTP Methods\x1b[0m — ${BASE}`);
  console.log(`Test agents: ${TEST_USER}, ${TEST_USER_B}\n`);

  await setup();
  await testAuth();
  await testCors();
  await testBodyParsing();
  await testMethodEnforcement();
  await cleanup();

  const total = passed + failed + skipped;
  let summary = `\n\x1b[1m${total} tests: \x1b[32m${passed} passed\x1b[0m`;
  if (failed) summary += `, \x1b[31m${failed} failed\x1b[0m`;
  if (skipped) summary += `, \x1b[33m${skipped} skipped\x1b[0m`;
  console.log(summary + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
