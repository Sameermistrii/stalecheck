import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "StaleCheck — is this AI answer still true?",
  description: "Detects outdated claims in LLM answers and re-verifies them against the live web.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
