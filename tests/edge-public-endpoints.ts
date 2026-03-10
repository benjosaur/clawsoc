/**
 * ClawSoc Edge Case Tests — Public Endpoints
 *
 * Usage:
 *   bun tests/edge-public-endpoints.ts              # remote (clawsoc.io)
 *   bun tests/edge-public-endpoints.ts local        # local  (localhost:3000)
 *   bun tests/edge-public-endpoints.ts local -v     # local with verbose request/response logging
 *
 * Tests:
 *   - /health endpoint shape and values
 *   - /api/halloffame pagination clamping and edge cases
 *   - /api/player/lookup edge cases
 *   - Security headers on all responses
 */

const local = process.argv.includes("local");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
const BASE = local ? "http://localhost:3000" : "https://clawsoc.io";

let passed = 0;
let failed = 0;

function pass(name: string) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}

function fail(name: string, reason: string) {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${name}: ${reason}`);
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

// ---------------------------------------------------------------------------
// 1. Health Endpoint
// ---------------------------------------------------------------------------
async function testHealthEndpoint() {
  console.log("\n\x1b[1mHealth Endpoint\x1b[0m");

  await test("GET /health returns 200 with expected shape and values", async () => {
    const res = await tracedFetch(`${BASE}/health`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(typeof body.status === "string", `missing status field`);
    expect(body.status === "ok", `expected status 'ok', got '${body.status}'`);
    expect(typeof body.tick === "number" && body.tick > 0, `tick should be > 0, got ${body.tick}`);
    expect(typeof body.uptime === "number" && body.uptime > 0, `uptime should be > 0, got ${body.uptime}`);
    expect(typeof body.clients === "number" && body.clients >= 0, `clients should be >= 0, got ${body.clients}`);
    expect(body.redis !== undefined, `missing redis field`);
    expect(typeof body.consecutiveErrors === "number", `missing consecutiveErrors`);
  });
}

// ---------------------------------------------------------------------------
// 2. Hall of Fame Pagination
// ---------------------------------------------------------------------------
async function testHallOfFame() {
  console.log("\n\x1b[1mHall of Fame Pagination\x1b[0m");

  await test("default params return valid response shape", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(Array.isArray(body.entries), "missing entries array");
    expect(typeof body.page === "number", "missing page");
    expect(typeof body.pageSize === "number", "missing pageSize");
    expect(typeof body.totalEntries === "number", "missing totalEntries");
    expect(body.page === 1, `expected page 1, got ${body.page}`);
    expect(body.pageSize === 50, `expected pageSize 50, got ${body.pageSize}`);
  });

  await test("page=0 clamps to page 1", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?page=0`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.page === 1, `expected page 1, got ${body.page}`);
  });

  await test("page=-5 clamps to page 1", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?page=-5`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.page === 1, `expected page 1, got ${body.page}`);
  });

  await test("page=abc defaults to page 1", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?page=abc`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.page === 1, `expected page 1, got ${body.page}`);
  });

  await test("pageSize=0 defaults to 50 (falsy fallback)", async () => {
    // parseInt("0") is 0, which is falsy, so `0 || 50` = 50
    const res = await tracedFetch(`${BASE}/api/halloffame?pageSize=0`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.pageSize === 50, `expected pageSize 50, got ${body.pageSize}`);
  });

  await test("pageSize=200 clamps to 100", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?pageSize=200`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.pageSize === 100, `expected pageSize 100, got ${body.pageSize}`);
  });

  await test("pageSize=-10 clamps to 1", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?pageSize=-10`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.pageSize === 1, `expected pageSize 1, got ${body.pageSize}`);
  });

  await test("pageSize=abc defaults to 50", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?pageSize=abc`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.pageSize === 50, `expected pageSize 50, got ${body.pageSize}`);
  });

  await test("page=99999 returns empty entries", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame?page=99999`);
    expect(res.ok, `status ${res.status}`);
    const body = await res.json();
    expect(body.entries.length === 0, `expected 0 entries, got ${body.entries.length}`);
  });

  await test("Cache-Control header present", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame`);
    const cc = res.headers.get("cache-control");
    expect(cc && cc.includes("max-age=60"), `expected Cache-Control with max-age=60, got '${cc}'`);
  });

  await test("CORS header present on halloffame", async () => {
    const res = await tracedFetch(`${BASE}/api/halloffame`);
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao === "*", `expected ACAO *, got '${acao}'`);
  });
}

// ---------------------------------------------------------------------------
// 3. Player Lookup Edge Cases
// ---------------------------------------------------------------------------
async function testPlayerLookupEdges() {
  console.log("\n\x1b[1mPlayer Lookup Edge Cases\x1b[0m");

  await test("whitespace-only name returns 400", async () => {
    const res = await tracedFetch(`${BASE}/api/player/lookup?name=%20%20%20`);
    expect(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("CORS header present on player lookup", async () => {
    const res = await tracedFetch(`${BASE}/api/player/lookup?name=nobody_xyz_999`);
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao === "*", `expected ACAO *, got '${acao}'`);
  });
}

// ---------------------------------------------------------------------------
// 4. Security Headers
// ---------------------------------------------------------------------------
async function testSecurityHeaders() {
  console.log("\n\x1b[1mSecurity Headers\x1b[0m");

  await test("X-Frame-Options: DENY present", async () => {
    const res = await tracedFetch(`${BASE}/health`);
    const val = res.headers.get("x-frame-options");
    expect(val === "DENY", `expected 'DENY', got '${val}'`);
  });

  await test("X-Content-Type-Options: nosniff present", async () => {
    const res = await tracedFetch(`${BASE}/health`);
    const val = res.headers.get("x-content-type-options");
    expect(val === "nosniff", `expected 'nosniff', got '${val}'`);
  });

  await test("Strict-Transport-Security header present", async () => {
    const res = await tracedFetch(`${BASE}/health`);
    const val = res.headers.get("strict-transport-security");
    expect(val && val.includes("max-age"), `expected STS header, got '${val}'`);
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1;36mClawSoc Edge Tests — Public Endpoints\x1b[0m — ${BASE}\n`);

  await testHealthEndpoint();
  await testHallOfFame();
  await testPlayerLookupEdges();
  await testSecurityHeaders();

  const total = passed + failed;
  let summary = `\n\x1b[1m${total} tests: \x1b[32m${passed} passed\x1b[0m`;
  if (failed) summary += `, \x1b[31m${failed} failed\x1b[0m`;
  console.log(summary + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
