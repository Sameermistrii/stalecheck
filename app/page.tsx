"use client";

import { useState, type ReactNode } from "react";
import { findSpans } from "@/lib/score";
import type { ClaimResult, Stats } from "@/lib/pipeline";

const SAMPLE = `As of my last update, the latest stable version of Python is 3.11, and React's newest major release is React 18. Node.js 18 is the current active LTS release. OpenAI's most advanced model is GPT-4, and ChatGPT Plus costs $20 per month. Twitter is led by CEO Jack Dorsey. The EU AI Act is still being negotiated and has not been adopted yet.`;

type Result = { claims: ClaimResult[]; stats: Stats; overall: number | null };

const LABEL = { current: "Current", outdated: "Outdated", unverifiable: "Unverified" } as const;

export default function Home() {
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  async function check() {
    setLoading(true);
    setError("");
    setResult(null);
    setActive(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setChecked(answer);
      setResult(data);
      setActive(data.claims[0]?.id ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const byId = new Map(result?.claims.map((c) => [c.id, c]));
  const selected = active != null ? byId.get(active) : undefined;

  function highlighted(): ReactNode[] {
    if (!result) return [];
    const spans = findSpans(checked, result.claims.map((c) => ({ id: c.id, quote: c.quote })));
    const out: ReactNode[] = [];
    let pos = 0;
    for (const s of spans) {
      const c = byId.get(s.id)!;
      out.push(checked.slice(pos, s.start));
      out.push(
        <button
          key={s.id}
          className={`mark ${c.status} ${active === s.id ? "on" : ""}`}
          onClick={() => setActive(s.id)}
          aria-label={`${LABEL[c.status]} claim, freshness ${c.freshness}`}
        >
          {checked.slice(s.start, s.end)}
          <sup>{c.freshness}</sup>
        </button>,
      );
      pos = s.end;
    }
    out.push(checked.slice(pos));
    return out;
  }

  return (
    <main>
      <header>
        <h1>
          Stale<span>Check</span>
        </h1>
        <p>Paste any ChatGPT, Claude or Gemini answer. Every time-sensitive claim gets re-checked against the live web.</p>
      </header>

      <section className="input">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Paste an AI-generated answer…"
          rows={7}
          aria-label="AI answer to check"
        />
        <div className="row">
          <button className="ghost" onClick={() => setAnswer(SAMPLE)} disabled={loading}>
            Try a sample
          </button>
          <button className="primary" onClick={check} disabled={loading || !answer.trim()}>
            {loading ? "Checking…" : "Check freshness"}
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {loading && <p className="muted pulse">Extracting claims → searching the web → judging each claim…</p>}

      {result && (
        <>
          <section className="summary">
            <div className={`score ${tone(result.overall)}`}>
              <strong>{result.overall ?? "—"}</strong>
              <span>freshness</span>
            </div>
            <ul className="counts">
              {(["outdated", "unverifiable", "current"] as const).map((s) => (
                <li key={s} className={s}>
                  <b>{result.claims.filter((c) => c.status === s).length}</b> {LABEL[s].toLowerCase()}
                </li>
              ))}
            </ul>
            <dl className="stats">
              <div><dt>LLM calls</dt><dd>{result.stats.llmCalls}</dd></div>
              <div><dt>Tokens</dt><dd>{result.stats.tokens.toLocaleString()}</dd></div>
              <div><dt>Searches</dt><dd>{result.stats.searches}</dd></div>
              <div><dt>Cache hits</dt><dd>{result.stats.cacheHits}</dd></div>
              <div><dt>Fallbacks</dt><dd>{result.stats.fallbacks}</dd></div>
              <div><dt>Time</dt><dd>{(result.stats.ms / 1000).toFixed(1)}s</dd></div>
            </dl>
          </section>
          <p className="muted small">
            Served by {Object.entries(result.stats.models).map(([m, n]) => `${m} ×${n}`).join(", ") || "—"} via Bifrost
          </p>

          {result.claims.length === 0 ? (
            <p className="muted">No time-sensitive claims found in this answer.</p>
          ) : (
            <section className="grid">
              <article className="answer">{highlighted()}</article>

              <aside>
                <ol className="list">
                  {result.claims.map((c) => (
                    <li key={c.id}>
                      <button className={`item ${c.status} ${active === c.id ? "on" : ""}`} onClick={() => setActive(c.id)}>
                        <span className="pill">{LABEL[c.status]}</span>
                        <span className="txt">{c.claim}</span>
                        <span className="num">{c.freshness}</span>
                      </button>
                    </li>
                  ))}
                </ol>

                {selected && (
                  <div className={`detail ${selected.status}`}>
                    <p className="cat">
                      {selected.category} · confidence {Math.round(selected.confidence * 100)}%
                      {selected.cached && " · cached"}
                    </p>
                    <h2>{selected.claim}</h2>
                    {selected.currentValue && selected.status !== "current" && (
                      <p className="now">
                        <b>Now:</b> {selected.currentValue}
                      </p>
                    )}
                    <p>{selected.explanation}</p>
                    {selected.sources.length > 0 && (
                      <ul className="sources">
                        {selected.sources.map((s, i) => (
                          <li key={i}>
                            <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                            <span>{host(s.url)}{s.published ? ` · ${s.published.slice(0, 16)}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </aside>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function tone(n: number | null) {
  if (n == null) return "";
  return n >= 70 ? "current" : n >= 40 ? "unverifiable" : "outdated";
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
