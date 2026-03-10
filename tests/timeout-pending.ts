/**
 * Timeout test: pending match (agent gets match but never decides)
 *
 * Usage:
 *   bun tests/timeout-pending.ts              # remote
 *   bun tests/timeout-pending.ts local        # local
 *   bun tests/timeout-pending.ts local -v     # verbose (log all request/response)
 *
 * Expected: server kicks the agent after ~15s of no decision.
 */

const local = process.argv.includes("local");
const verbose = process.argv.includes("-v") || process.argv.includes("--verbose");
const BASE = local ? "http://localhost:3000" : "https://clawsoc.io";
const USERNAME = `_tp_${Date.now()}`;

function elapsed(start: number) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function loggedFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  if (verbose) console.log(`\n  → ${method} ${url}`);
  if (verbose && init?.body) console.log(`    body: ${init.body}`);
  const res = await fetch(url, init);
  const clone = res.clone();
  const text = await clone.text();
  if (verbose) {
    console.log(`  ← ${res.status} ${res.statusText}`);
    console.log(`    ${text}`);
  }
  return res;
}

async function main() {
  console.log(`Pending match timeout test — ${BASE}`);
  console.log(`Agent: ${USERNAME}`);
  if (verbose) console.log("Verbose mode ON");
  console.log();

  // 1. Register
  const regRes = await loggedFetch(`${BASE}/api/agent/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME }),
  });
  if (!regRes.ok) {
    console.error("Registration failed:", regRes.status);
    process.exit(1);
  }
  const { apiKey } = await regRes.json();
  const headers = { Authorization: `Bearer ${apiKey}` };
  console.log("Registered");

  // 2. Wait for match (blocking)
  console.log("Waiting for match...");
  const matchRes = await loggedFetch(`${BASE}/api/agent/match?username=${USERNAME}`, {
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  if (!matchRes.ok) {
    console.error("Match failed:", matchRes.status);
    process.exit(1);
  }
  const match = await matchRes.json();
  console.log(`Got match vs ${match.opponent} — NOT deciding`);

  // 3. Poll status until kicked
  const start = Date.now();
  console.log("Waiting for server to kick us (expecting ~15s)...\n");

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await loggedFetch(`${BASE}/api/agent/status?username=${USERNAME}`, { headers });
    if (res.status === 404) {
      console.log(`  Kicked after ${elapsed(start)}`);
      break;
    }
    const body = await res.json();
    if (!verbose) console.log(`  ${elapsed(start)} — still alive (state: ${body.state ?? "unknown"})`);
    if (Date.now() - start > 60_000) {
      console.error("Timed out waiting for kick after 60s");
      process.exit(1);
    }
  }

  console.log("\nDone — agent was removed by pending match timeout");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
