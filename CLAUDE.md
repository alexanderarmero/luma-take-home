# Luma Take-Home — styled product shots

Turns a home-goods brand's catalog CSV into styled product images, reviewed and
approved entirely inside Slack. Design of record: `APPROACH.md`. Reasoning trail:
`Approach/`.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

There is no `CONTEXT.md` and no `docs/adr/` here — this repo keeps its domain
record in a different shape, and `docs/agents/domain.md` says to proceed
silently when those files are absent. Read these instead:

- **`APPROACH.md`** — the design of record. What was built, why, and what each
  choice cost. Start here.
- **`Approach/`** — the working record, kept as the work happened:
  `Facts.md` (verified only), `Assumptions.md` (each as *question → assumption
  → what it changed*), `Decisions.md` (numbered, superseded entries kept in
  full), `Tradeoffs.md` (what each decision cost and what would reverse it).

**Cross-references are load-bearing.** `F5` is a fact, `A10.4` an assumption,
`D56` a decision, `T13` a tradeoff, `OQ-17` an open question. A decision citing
`F5` was made against measured data; one citing `A10.4` was made against an
admitted guess. Cite the same way when adding to any of these files, and use
the next free number rather than reusing one — two concurrent branches both
claimed `D59` once.
