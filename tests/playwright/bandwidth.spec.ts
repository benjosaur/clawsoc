import { test, expect } from "@playwright/test";

const SAMPLE_DURATION_MS = 30_000;

type FrameType = "init" | "event" | "slow" | "unknown";

interface FrameStats {
  count: number;
  totalBytes: number;
  minBytes: number;
  maxBytes: number;
}

function classifyFrame(payload: string): FrameType {
  try {
    const parsed = JSON.parse(payload);
    if (parsed.type === "init") return "init";
    if (parsed.type === "e") return "event";
    if (parsed.type === "s") return "slow";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function byteLength(payload: string | Buffer): number {
  if (Buffer.isBuffer(payload)) return payload.byteLength;
  return Buffer.byteLength(payload, "utf8");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function emptyStats(): FrameStats {
  return { count: 0, totalBytes: 0, minBytes: Infinity, maxBytes: 0 };
}

function updateStats(stats: FrameStats, bytes: number) {
  stats.count++;
  stats.totalBytes += bytes;
  stats.minBytes = Math.min(stats.minBytes, bytes);
  stats.maxBytes = Math.max(stats.maxBytes, bytes);
}

test("measure WebSocket bandwidth per connection", async ({ page }) => {
  const received: Record<FrameType, FrameStats> = {
    init: emptyStats(),
    event: emptyStats(),
    slow: emptyStats(),
    unknown: emptyStats(),
  };
  const sent = emptyStats();
  let totalReceivedBytes = 0;
  let totalSentBytes = 0;
  let wsConnected = false;

  // Intercept WebSocket before navigating
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/ws")) return;
    wsConnected = true;

    ws.on("framereceived", (event) => {
      const bytes = byteLength(event.payload);
      totalReceivedBytes += bytes;
      const frameType =
        typeof event.payload === "string"
          ? classifyFrame(event.payload)
          : "unknown";
      updateStats(received[frameType], bytes);
    });

    ws.on("framesent", (event) => {
      const bytes = byteLength(event.payload);
      totalSentBytes += bytes;
      updateStats(sent, bytes);
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2_000);
  expect(wsConnected).toBe(true);

  console.log(
    `\nObserving WebSocket traffic for ${SAMPLE_DURATION_MS / 1000}s...`
  );
  await page.waitForTimeout(SAMPLE_DURATION_MS);

  // --- Report ---
  const dur = SAMPLE_DURATION_MS / 1000;
  const types: FrameType[] = ["init", "event", "slow", "unknown"];

  const hdr = [
    "Frame Type".padEnd(12),
    "Count".padStart(8),
    "Total".padStart(10),
    "Avg Size".padStart(10),
    "Min".padStart(10),
    "Max".padStart(10),
    "Rate".padStart(12),
  ].join(" | ");

  const sep = "-".repeat(hdr.length);

  console.log("\n" + "=".repeat(80));
  console.log("  ClawSoc WebSocket Bandwidth Report — Single Connection");
  console.log("=".repeat(80));
  console.log(`  Duration:  ${dur}s`);
  console.log(sep);
  console.log(`  ${hdr}`);
  console.log(`  ${sep}`);

  for (const t of types) {
    const s = received[t];
    if (s.count === 0) continue;
    const avg = Math.round(s.totalBytes / s.count);
    console.log(
      `  ${[
        t.padEnd(12),
        String(s.count).padStart(8),
        formatBytes(s.totalBytes).padStart(10),
        formatBytes(avg).padStart(10),
        formatBytes(s.minBytes).padStart(10),
        formatBytes(s.maxBytes).padStart(10),
        `${formatBytes(s.totalBytes / dur)}/s`.padStart(12),
      ].join(" | ")}`
    );
  }

  const totalCount = types.reduce((sum, t) => sum + received[t].count, 0);

  console.log(`  ${sep}`);
  console.log(
    `  ${"RECEIVED".padEnd(12)} | ${String(totalCount).padStart(8)} | ${formatBytes(totalReceivedBytes).padStart(10)} | ${"".padStart(10)} | ${"".padStart(10)} | ${"".padStart(10)} | ${`${formatBytes(totalReceivedBytes / dur)}/s`.padStart(12)}`
  );

  if (sent.count > 0) {
    console.log(
      `  ${"SENT".padEnd(12)} | ${String(sent.count).padStart(8)} | ${formatBytes(totalSentBytes).padStart(10)} | ${formatBytes(Math.round(totalSentBytes / sent.count)).padStart(10)} | ${formatBytes(sent.minBytes).padStart(10)} | ${formatBytes(sent.maxBytes).padStart(10)} | ${`${formatBytes(totalSentBytes / dur)}/s`.padStart(12)}`
    );
  }

  console.log("=".repeat(80));
  console.log(
    `  Bandwidth per client:      ~${formatBytes(totalReceivedBytes / dur)}/s downstream`
  );
  console.log(
    `  Estimated for 10 clients:  ~${formatBytes((totalReceivedBytes / dur) * 10)}/s total`
  );
  console.log(
    `  Estimated for 100 clients: ~${formatBytes((totalReceivedBytes / dur) * 100)}/s total`
  );
  console.log("=".repeat(80) + "\n");

  // Sanity checks
  expect(received.init.count).toBeGreaterThanOrEqual(1);
  expect(received.event.count).toBeGreaterThan(100);
  expect(received.slow.count).toBeGreaterThan(3);
  expect(totalReceivedBytes).toBeGreaterThan(0);
});
