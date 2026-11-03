import { checkAnswer } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let answer: unknown;
  try {
    ({ answer } = await req.json());
  } catch {
    return Response.json({ error: "Body must be JSON: {\"answer\": \"...\"}" }, { status: 400 });
  }
  if (typeof answer !== "string" || !answer.trim()) {
    return Response.json({ error: "Paste an answer to check." }, { status: 400 });
  }
  if (answer.length > 8000) {
    return Response.json({ error: "Answer too long (max 8,000 characters)." }, { status: 413 });
  }
  if (!process.env.TAVILY_API_KEY) {
    return Response.json({ error: "TAVILY_API_KEY is not set. See README → Setup." }, { status: 500 });
  }
  try {
    return Response.json(await checkAnswer(answer));
  } catch (e: any) {
    // Bifrost budget/rate-limit errors land here and are shown to the user as-is.
    return Response.json({ error: e.message ?? "Check failed" }, { status: 502 });
  }
}
