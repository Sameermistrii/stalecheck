// Runs every case through the running app (npm run dev) and reports accuracy.
// Usage: npm run eval   (APP_URL defaults to http://localhost:3000)
import { readFile, writeFile } from "node:fs/promises";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const { cases } = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"));

const rows = [];
for (const c of cases) {
  const res = await fetch(`${APP}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: c.answer }),
  });
  const data = await res.json();
  // Each case holds one claim; take the least-fresh one the app found.
  const top = (data.claims ?? []).sort((a, b) => a.freshness - b.freshness)[0];
  const got = top?.status ?? (data.error ? "error" : "none");
  rows.push({ answer: c.answer, expected: c.expected, got, freshness: top?.freshness, tokens: data.stats?.tokens ?? 0 });
  console.log(`${got === c.expected ? "✓" : "✗"} [${c.expected} → ${got}] ${c.answer}`);
}

const correct = rows.filter((r) => r.got === r.expected).length;
const stale = rows.filter((r) => r.expected === "outdated");
const caught = stale.filter((r) => r.got === "outdated").length;
const falseAlarms = rows.filter((r) => r.expected === "current" && r.got === "outdated").length;
const tokens = rows.reduce((s, r) => s + r.tokens, 0);

const summary = {
  accuracy: `${correct}/${rows.length}`,
  staleCaught: `${caught}/${stale.length}`,
  falseAlarms,
  avgTokensPerCheck: Math.round(tokens / rows.length),
};
console.log("\n", summary);
await writeFile(new URL("./results.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
