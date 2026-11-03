// Pure helpers (no imports) so `node --test` can load this file directly.

export type Status = "current" | "outdated" | "unverifiable";

/** 0-100: how safe it is to rely on this claim today. */
export function freshness(status: Status, confidence: number): number {
  const c = Math.min(1, Math.max(0, Number(confidence) || 0));
  const s = status === "current" ? 60 + 40 * c : status === "outdated" ? 30 - 30 * c : 45;
  return Math.round(s);
}

/** LLMs sometimes wrap JSON in prose or ``` fences; grab the outermost object. */
export function parseJSON(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export type Span = { start: number; end: number; id: number };

/** Locate each claim quote in the answer; drop ones not found or overlapping an earlier match. */
export function findSpans(answer: string, quotes: { id: number; quote: string }[]): Span[] {
  const lower = answer.toLowerCase();
  const spans: Span[] = [];
  for (const { id, quote } of quotes) {
    const q = quote.trim().toLowerCase();
    if (!q) continue;
    let from = 0;
    let i = -1;
    while ((i = lower.indexOf(q, from)) !== -1) {
      const end = i + q.length;
      if (!spans.some((s) => i < s.end && end > s.start)) break;
      from = i + 1;
    }
    if (i !== -1) spans.push({ start: i, end: i + q.length, id });
  }
  return spans.sort((a, b) => a.start - b.start);
}
