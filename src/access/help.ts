export interface HelpEntry {
  command: string;
  what: string;
  /** Shown only to whoever administers access. */
  adminOnly?: boolean;
}

export const COMMANDS: HelpEntry[] = [
  { command: "/luma upload", what: "Drop in a catalog CSV. Shows what it would make and what it would cost before anything is generated." },
  { command: "/luma status", what: "Where the latest batch stands, and which products still need a decision." },
  { command: "/luma signin", what: "Get a private link that lets you approve, discard and confirm on the overview page. Lasts a day." },
  { command: "/luma export", what: "Download the approved photos of the latest confirmed batch as a zip." },
  { command: "/luma system-prompt", what: "See the wording that turns a shot idea into three prompts, and change it. Applies to the next batch." },
  { command: "/luma access", what: "See and change who can approve, discard and confirm.", adminOnly: true },
  { command: "/luma help", what: "This list." },
];

export function buildHelp(isAdmin: boolean): string {
  const lines = ["*What I can do*", ""];
  for (const entry of COMMANDS) {
    if (entry.adminOnly && !isAdmin) continue;
    lines.push(`• \`${entry.command}\` — ${entry.what}`);
  }
  lines.push(
    "",
    "_Photos are reviewed on the overview page. Each product also gets a " +
      "thread here, so you can talk about a shot next to the shot._",
  );
  return lines.join("\n");
}
