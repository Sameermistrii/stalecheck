import { tavily } from "@tavily/core";
import { freshness, parseJSON, type Status } from "./score";

// 127.0.0.1, not localhost: on Windows, Node may resolve localhost to IPv6 (::1) while Bifrost listens on IPv4.
const BIFROST = process.env.BIFROST_URL ?? "http://127.0.0.1:8080";
const PRIMARY = process.env.PRIMARY_MODEL || "groq/openai/gpt-oss-120b";
const FALLBACKS = (process.env.FALLBACK_MODELS || "groq/openai/gpt-oss-20b,gemini/gemini-3.8-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_CLAIMS = 8;

export type Category = "pricing" | "version" | "regulation" | "company" | "other";
export type Source = { title: string; url: string; snippet: string; published?: string };
export type ClaimResult = {
  id: number;
  quote: string;
  claim: string;
  category: Category;
  status: Status;
  currentValue: string | null;
  explanation: string;
  confidence: number;
  freshness: number;
  sources: Source[];
  cached: boolean;
};
export type Stats = {
  llmCalls: number;
  tokens: number;
  searches: number;
  cacheHits: number;
  ms: number;
  models: Record<string, number>;
  fallbacks: number;
};

// shortcut: in-process cache, lost on restart and not shared across instances; move to Redis if deployed multi-node.
const cache = new Map<string, { at: number; value: Omit<ClaimResult, "id" | "quote" | "cached"> }>();
const CACHE_MS = 60 * 60 * 1000;

const today = () => new Date().toISOString().slice(0, 10);

async function chat(system: string, user: string, stats: Stats): Promise<any> {
  const res = await fetch(`${BIFROST}/v1/chat/completions`, {
    signal: AbortSignal.timeout(45_000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // shortcut: fixed local key matching bifrost/config.json; set a real secret before deploying anywhere public.
      "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY || "sk-bf-stalecheck-local",
    },
    body: JSON.stringify({
      model: PRIMARY,
      fallbacks: FALLBACKS,
      temperature: 0,
      reasoning_effort: "low", // gpt-oss reasons before answering; low keeps tokens and rate limits down
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }).catch((e) => {
    throw new Error(`Can't reach Bifrost at ${BIFROST} (${e.cause?.code ?? e.message}). Is it running? Open ${BIFROST} in your browser to check.`);
  });
  if (!res.ok) throw new Error(`Bifrost ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const route = data.extra_fields?.routing_info;
  const model = route ? `${route.provider}/${route.model}` : data.model ?? PRIMARY;
  stats.llmCalls++;
  stats.tokens += data.usage?.total_tokens ?? 0;
  stats.models[model] = (stats.models[model] ?? 0) + 1;
  if (route?.is_fallback) stats.fallbacks++;
  return parseJSON(data.choices?.[0]?.message?.content ?? "");
}

const EXTRACT_PROMPT = `You find time-sensitive factual claims in AI-generated text: claims that can become outdated.
Categories: pricing (prices, plans, fees), version (software/API/model versions, "latest" anything), regulation (laws, rules, compliance status), company (who leads/owns/acquired, headcount, funding, products), other (any other fact that changes over time).
Ignore timeless facts, opinions and definitions.
Return JSON: {"claims":[{"quote": "<exact substring copied character-for-character from the text>", "claim": "<the claim as a standalone sentence>", "category": "<category>", "query": "<a short web search query that would reveal the current truth>"}]}
At most ${MAX_CLAIMS} claims, most consequential first. If none, return {"claims":[]}.`;

const JUDGE_PROMPT = `You verify whether a claim is still true today, using ONLY the numbered web sources given.
- "current": sources support the claim as true now.
- "outdated": sources clearly show the fact has changed; give the current value.
- "unverifiable": sources are missing, conflicting or don't address it. Never guess.
- Plans, forecasts, rumors and "might/will/expected to" statements are NOT evidence that a fact has changed. Only an actual, reported change counts.
- Prefer official sources (vendor sites, docs, government pages) over blogs and aggregators.
Return JSON: {"status":"current|outdated|unverifiable","current_value":"<the up-to-date fact, or null>","explanation":"<one sentence citing sources like [1]>","confidence":<0..1>,"evidence":[<source numbers used>]}`;

async function verify(
  c: { claim: string; category: Category; query: string },
  stats: Stats,
): Promise<Omit<ClaimResult, "id" | "quote" | "cached">> {
  const tv = tavily({ apiKey: process.env.TAVILY_API_KEY ?? "" });
  stats.searches++;
  const search = await tv.search(c.query || c.claim, {
    searchDepth: "basic",
    maxResults: 5,
    topic: c.category === "company" ? "news" : "general",
    // Recent sources only, except laws: their authoritative pages can be older than a year.
    ...(c.category === "regulation" ? {} : { timeRange: "year" as const }),
  });
  const sources: Source[] = search.results.map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: String(r.content ?? "").slice(0, 600),
    published: r.publishedDate || undefined,
  }));
  const numbered = sources
    .map((s, i) => `[${i + 1}] ${s.title}${s.published ? ` (published ${s.published})` : ""}\n${s.url}\n${s.snippet}`)
    .join("\n\n");
  const v = await chat(
    JUDGE_PROMPT,
    `Today is ${today()}.\nClaim: ${c.claim}\n\nSources:\n${numbered || "(no results)"}`,
    stats,
  );
  const status: Status = ["current", "outdated", "unverifiable"].includes(v.status) ? v.status : "unverifiable";
  const used = Array.isArray(v.evidence)
    ? v.evidence.map((n: number) => sources[n - 1]).filter(Boolean)
    : [];
  return {
    claim: c.claim,
    category: c.category,
    status,
    currentValue: v.current_value ?? null,
    explanation: String(v.explanation ?? ""),
    confidence: Number(v.confidence) || 0,
    freshness: freshness(status, v.confidence),
    sources: used.length ? used : sources.slice(0, 3),
  };
}

export async function checkAnswer(answer: string): Promise<{ claims: ClaimResult[]; stats: Stats; overall: number | null }> {
  const t0 = Date.now();
  const stats: Stats = { llmCalls: 0, tokens: 0, searches: 0, cacheHits: 0, ms: 0, models: {}, fallbacks: 0 };
  const { claims = [] } = await chat(EXTRACT_PROMPT, answer, stats);

  const results = await Promise.all(
    (claims as any[]).slice(0, MAX_CLAIMS).map(async (c, id): Promise<ClaimResult> => {
      const key = String(c.claim).toLowerCase().replace(/\s+/g, " ").trim();
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) {
        stats.cacheHits++;
        return { ...hit.value, id, quote: String(c.quote ?? ""), cached: true };
      }
      try {
        const value = await verify(c, stats);
        cache.set(key, { at: Date.now(), value });
        return { ...value, id, quote: String(c.quote ?? ""), cached: false };
      } catch (e: any) {
        // One failed claim shouldn't sink the whole check.
        return {
          id, quote: String(c.quote ?? ""), claim: String(c.claim), category: c.category ?? "other",
          status: "unverifiable", currentValue: null, explanation: `Verification failed: ${e.message}`,
          confidence: 0, freshness: freshness("unverifiable", 0), sources: [], cached: false,
        };
      }
    }),
  );

  stats.ms = Date.now() - t0;
  const overall = results.length
    ? Math.round(results.reduce((s, r) => s + r.freshness, 0) / results.length)
    : null;
  return { claims: results, stats, overall };
}
