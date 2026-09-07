# Approach — the working record

This folder is the reasoning trail behind [`../APPROACH.md`](../APPROACH.md). It exists so
that every decision can be traced back to a verified fact or a named assumption — and so that
coming back to this cold (or walking someone through it on video) doesn't require
reconstructing the argument from memory.

**Nothing here is a summary.** `APPROACH.md` is the summary. These are the working notes,
kept in the order they were made, including the parts that were later reversed.

---

## The four files

| File | Contains | Feeds |
|---|---|---|
| **[`Facts.md`](./Facts.md)** | 16 entries. Only verified, checkable statements — measured from the data, read from the docs, or fixed by the brief. No opinions. | Everything |
| **[`Assumptions.md`](./Assumptions.md)** | Every assumption as *question I'd have asked → assumption taken → what it changed*, with `HELD` / `AT RISK` / `RETIRED` status. Plus the open-questions register. | `APPROACH.md` |
| **[`Decisions.md`](./Decisions.md)** | 60 numbered decisions with sub-rulings, the options considered, why this one, and what it unblocked. Superseded and deferred entries are kept in full, **not deleted** — the revisions are part of the reasoning. | Scope ledger |
| **[`Tradeoffs.md`](./Tradeoffs.md)** | 18 entries. What each decision cost, the strongest case against it, what to watch after it ships, and what would reverse it. Three *roads not taken* recorded in full. | `APPROACH.md` |

**Cross-references are load-bearing.** `F3.4` is a fact, `A1.2` an assumption, `D22` a
decision, `T9.1` a tradeoff, `OQ-17` an open question. A decision that cites `F5` was made
against measured data; one citing `A10.4` was made against an admitted guess.

---

## The design in one paragraph

**A Slack app with one web page hanging off it.** A slash command opens a modal to upload a
CSV; the system validates it and shows a recap *with the cost* in that same modal before
spending anything, so the estimate and the decision are one screen. Each shot idea becomes
three distinct prompts via Claude, generated at `uni-1-max` against the product's own photo,
downloaded immediately and stored. The channel gets one line per product and that product's
candidates go in its thread; the line links to an overview page showing them side by side,
which is where approving and discarding actually happen. Rows with no shot idea pass their
original photo through, unmodified and free. When every photograph is actioned the batch
auto-completes and a confirm panel appears; confirming freezes it, advances a delivered
pointer, and attaches the zip and the approved-catalog CSV to the confirmation message,
under filenames that mean something.

> **This paragraph was rewritten once.** The original design put approval on Slack buttons
> alone, with no page at all — see `D39`, and *The road not taken* in `Tradeoffs.md`. The
> page exists because **approving shot 2 of 3 is a comparison, not a verdict**, and Slack
> cannot show three candidates together. Push versus pull was the rule that mattered; Slack
> versus browser was not.

---

## Before writing any other code

Three facts are unverified and each can invalidate a load-bearing decision. All are minutes
to check and expensive to discover late.

| Check | Decides | If it fails |
|---|---|---|
| **F4.5** — do buttons work in a posting-restricted channel? | `D2.1` — the read-only review channel | The channel can't be restricted, or approval moves |
| **F4.12** — do @-mentions still badge in a *muted* channel? | `T3.4` — the only notification-flood mitigation | Push is lost; fall back to a bot DM to Ellie |
| **F8.2** — do buttons work on a *file-share* message? | `D3.2` + `D32` together | Revert to `image_url`, or double the message flood |

Plus: **the four-cent rate-limit probe** (`F8.5`) — one `uni-1` text-to-image returns
`X-RateLimit-Limit` and validates auth, the SDK, and the ceiling in a single call, before any
throttling logic is written against a guess — and **a deployed hello-world**, because
deployment is a hard requirement and deploy problems found late are how one-day builds die.

---

## Build order

1. The three verifications + rate-limit probe + deployed hello-world
2. Slack app skeleton, channel, DB schema
3. Ingest → validate → recap → Generate button
4. Pipeline: submit → poll → download → store
5. Post to Slack with buttons
6. Approve / Discard → completion check → confirm
7. **Zip export — mandatory.** Without it the system produces decisions and no artefacts.
8. `/status` — if time allows

**`/status` being last is the known risk** (`T11.5`). It's load-bearing for three separate
things, most importantly **Maya's entire stated ask** — *"see where things stand without
having to ask Ellie."* If it doesn't ship, one of the two named stakeholders gets nothing
from v1, and that would be a cut by clock rather than by value.

*The near-free hedge:* a crude `/status` at step 4 is a `SELECT COUNT(*) … GROUP BY state`
over a schema that already exists. It makes the pipeline debuggable while the rest is built
and grows into the real feature for free — **the same code serving developer observability
and Maya's requirement.**

---

## The invariants

Five rules that must survive contact with implementation. Each one, if quietly broken by a
later optimisation, reintroduces a failure this design exists to remove.

1. **Byte-identity** (`D10.4`) — the image posted to Slack, the object in storage, and the file in the zip are the same bytes with the same checksum. No re-encoding, no thumbnails as canonical, no re-generation after approval. *Assertable in a test, and should be.*
2. **Discarded images are unreachable by any handoff path** (`A5.5`) — retained forever for recovery, never deliverable. An engineer must be able to reach one; the product must never hand one out.
3. **Slack is the interface, never the datastore** (`D2.6`) — approvals live in our database; the channel renders them. Delete Slack tomorrow, lose the interface, keep every decision.
4. **Retrieval reads through the delivered pointer** (`D20.1`) — never "highest batch id". This is what makes an unfinished batch structurally unreachable, and it looks like unnecessary indirection to anyone reading the code later.
5. **Write intent before spending** (`D30.5`) — the job row commits before `POST /v1/generations`, because Luma has no idempotency key. Fail toward a wasted dime, never toward a lost record.

---

## The parts I'd defend hardest

- **The freeze** (`D22`/`D25`). Immutable batches are the structural opposite of all three failures in the brief. *Start strict, loosen on evidence* — rigidity is reversible, an affordance people depend on is not.
- **The naming chain** (`A4.4` → `D31.3`). The label Ellie reads, the file the web person gets, and the object in storage are one identifier — with the URL kept separately unguessable. That kills the `IMG_43xx` class of bug at the root instead of guarding against it.
- **Cutting `Notes` on measurement, not instinct** (`F5`). Three rows corrupted against one or two improved. The measurement is what makes it a decision rather than a preference.
- **`F9.5`** — *what breaks first is Ellie, not the system*, with the numbers to show it.

## The parts I'd flag first in review

- **`A3.3`** — we still assume a new Slack channel doesn't count as "something new" to Ellie. Weaker than the assumption the all-Slack pivot retired, but not zero.
- **`A10.4`** — the rejection rate is unknown and load-bearing for the "2–3 candidates" choice. One real batch supplies it; no amount of reasoning will.
- **`A13.4`** — `D35`'s approved-CSV only repairs the source spreadsheet if someone actually pastes it back. Nothing enforces that and nobody was asked.
