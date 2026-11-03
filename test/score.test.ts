import { test } from "node:test";
import assert from "node:assert/strict";
import { freshness, parseJSON, findSpans } from "../lib/score.ts";

test("freshness orders statuses and clamps confidence", () => {
  assert.equal(freshness("current", 1), 100);
  assert.equal(freshness("current", 0), 60);
  assert.equal(freshness("outdated", 1), 0);
  assert.equal(freshness("outdated", 5), 0);
  assert.equal(freshness("unverifiable", 0.9), 45);
  assert.ok(freshness("current", 0.1) > freshness("unverifiable", 1));
  assert.ok(freshness("unverifiable", 0) > freshness("outdated", 0));
});

test("parseJSON strips fences and prose", () => {
  assert.deepEqual(parseJSON('Sure!\n```json\n{"a":[1,{"b":2}]}\n```'), { a: [1, { b: 2 }] });
  assert.throws(() => parseJSON("no json here"));
});

test("findSpans is case-insensitive, skips misses and overlaps", () => {
  const text = "Python 3.11 is latest. python 3.11 again.";
  const spans = findSpans(text, [
    { id: 0, quote: "Python 3.11" },
    { id: 1, quote: "python 3.11" }, // second occurrence, not overlapping the first
    { id: 2, quote: "not in text" },
  ]);
  assert.deepEqual(spans, [
    { start: 0, end: 11, id: 0 },
    { start: 23, end: 34, id: 1 },
  ]);
});
