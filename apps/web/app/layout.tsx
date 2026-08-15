import type { Metadata } from "next";
import { Recursive } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const recursive = Recursive({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-recursive",
});

export const metadata: Metadata = {
  title: "PayBench Run Desk",
  description: "Private PayBench workflow operations",
};

const designContract = `
THESIS: One paid study reads like a live stage-manager rundown; no generic SaaS overview.
OWN-WORLD: Bright work surface, deep-harbor cobalt, brass live cues, ruled modules, Recursive variable type.
STORY: Select a founder, scan the ordered run, watch both sandboxes, verify study and Replay, inspect evidence.
FIRST VIEWPORT: Runs at left; selected job and eight-cue rundown lead; current action is always visible.
FORM: Internal cue sheet, pinned by the brief; seed key USER-PINNED-PAYBENCH-RUNDOWN.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={recursive.variable}>
        <template
          data-design-contract="USER-PINNED-PAYBENCH-RUNDOWN"
          dangerouslySetInnerHTML={{ __html: `<!--${designContract}-->` }}
        />
        {children}
      </body>
    </html>
  );
}
