/**
 * Compute the global mean avgScore (C) from all Redis records.
 * Usage: REDIS_URL=redis://... bun run scripts/compute-global-mean.ts
 */
import Redis from "ioredis";

const url = process.env.REDIS_URL;
if (!url) { console.error("Set REDIS_URL"); process.exit(1); }

const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
await redis.connect();

const keys = await redis.keys("record:*");
console.log(`Found ${keys.length} record keys\n`);

interface OpponentRecord { cc: number; cd: number; dc: number; dd: number }

let totalAvgSum = 0;
let countWithGames = 0;
const players: { label: string; games: number; score: number; avg: number; strategy: string }[] = [];

for (const key of keys) {
  const raw = await redis.get(key);
  if (!raw) continue;
  const record = JSON.parse(raw) as {
    score: number;
    matchHistory: Record<string, OpponentRecord>;
    strategy: string;
    isExternal?: boolean;
  };

  let games = 0;
  let coops = 0;
  for (const r of Object.values(record.matchHistory)) {
    games += r.cc + r.cd + r.dc + r.dd;
    coops += r.cc + r.cd;
  }

  if (games > 0) {
    const avg = record.score / games;
    totalAvgSum += avg;
    countWithGames++;
    players.push({
      label: key.replace("record:", ""),
      games,
      score: record.score,
      avg: Math.round(avg * 100) / 100,
      strategy: record.strategy,
    });
  }
}

players.sort((a, b) => b.games - a.games);

const globalMean = countWithGames > 0 ? totalAvgSum / countWithGames : 0;

console.log("Top 20 by games played:");
console.log("─".repeat(70));
console.log("Label".padEnd(25), "Strategy".padEnd(15), "Games".padStart(7), "Score".padStart(8), "Avg".padStart(7));
console.log("─".repeat(70));
for (const p of players.slice(0, 20)) {
  console.log(
    p.label.padEnd(25),
    p.strategy.padEnd(15),
    String(p.games).padStart(7),
    String(p.score).padStart(8),
    p.avg.toFixed(2).padStart(7),
  );
}

console.log("\n─".repeat(70));
console.log(`Players with games > 0: ${countWithGames}`);
console.log(`Players with >= 20 games: ${players.filter(p => p.games >= 20).length}`);
console.log(`\n  Global Mean C = ${globalMean.toFixed(4)}`);
console.log(`  Rounded: ${Math.round(globalMean * 10) / 10}`);

await redis.quit();
