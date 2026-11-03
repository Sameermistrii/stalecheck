// Starts Bifrost with the keys from .env (run via `npm run bifrost`, which passes --env-file=.env).
import { spawn } from "node:child_process";

const missing = ["GROQ_API_KEY", "GEMINI_API_KEY"].filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(`\n⚠  Missing in .env: ${missing.join(", ")} — Bifrost can't call those providers until you add them.\n`);
}

spawn("npx", ["-y", "@maximhq/bifrost", "-app-dir", "./bifrost"], { stdio: "inherit", shell: true })
  .on("exit", (code) => process.exit(code ?? 0));
