# Decisions

One entry per settled decision, recorded as we work through the design tree.
Nothing lands here until it has actually been decided.

Format per entry: **what was decided**, **the options considered**, **why this one**,
**what it unblocks**. The cost of each decision is recorded in `Tradeoffs.md`.

---

*(Round 1 in progress — no decisions settled yet.)*
## ~~D1 — Surface: Slack-triggered pipeline, approvals in a mobile-friendly web app~~ SUPERSEDED

> **Status: SUPERSEDED by D2** (Round 1, Q1 revision). Kept in full because the fact that
> this shape was considered, specified, and then rejected is part of the reasoning trail —
> and because D2 inherits several of its sub-decisions.

**Originally settled:** Round 1, Q1.

**Decision.** A pipeline fronted by Slack, where the work is *done* in a mobile-friendly
web app. Slack is the familiar interface and the trigger; the web app is where state lives.

| Sub-decision | Ruling |
|---|---|
| **D1.1** | **Slack is the trigger, notification and command surface — not the approval surface.** A run is kicked off from Slack; Slack posts that results are ready and carries the link. A series of slash commands complements the web app. |
| **D1.2** | **The web app is the approval surface.** Approve, discard, confirm, magic-link entry, and access management all happen there. Mobile-friendly is a hard requirement, not a nice-to-have (F3.6). |
| **D1.3** | **All progress auto-saves; there is no explicit save step.** State is shared, so a second team member viewing the app sees what has been approved and what has been discarded without anyone publishing or forwarding anything. |
| **D1.4** | **Access is permission-based.** v1 hardcodes the allowlist; a Slack command to grant or revoke approve/discard rights comes after. |
| **D1.5** | **A `Confirm` action terminates a stage.** Distinct from per-image approve/discard: Confirm marks the batch finished and closes that pipeline image stage completely. |

**Options considered.** (a) Slack-native approval with Block Kit buttons; (b) magic-link
mobile web approval; (c) login-gated dashboard.

**Why this one.** (c) was never viable — it rebuilds the tool they abandoned (F3.5).
Between (a) and (b), the deciding factor was **state**. Slack buttons can capture a
decision but Slack is a poor place to *hold* one — that is precisely today's failure, where
"the pick lives wherever the conversation happened" (F3.3, brief step 5). A web app with
shared auto-saved state gives the decision a durable home and a canonical answer to "what
is final," which a thread cannot. Slack still supplies the thing the dashboard lacked:
**push**, and a familiar front door nobody has to install.

**What it unblocks.** Auth/identity model (magic link + allowlist), the persistence layer,
the status vocabulary and its state machine, the Slack command surface, and deploy target.

**Notable consequence — this closes the gap in the handoff data.** F1.1 established the CSV
has nowhere to record done-ness, which is why "nobody can tell you which of the sixteen are
done." `Confirm` (D1.5) is that missing record, and it is also the exact signal the web
person currently has to ask Slack for every week (brief step 7, A0.1).

---

## D2 — Surface: all-in-Slack. Slack is the entire product surface.

**Settled:** Round 1, Q1 (revision). **Supersedes D1.**

**Decision.** There is no web app. The product is a Slack app operating in a dedicated,
posting-restricted channel. Candidate images are posted there; Ellie scrolls and reviews;
approval happens on a Block Kit button in the channel. Everything else is a slash command.

| Sub-decision | Ruling |
|---|---|
| **D2.1** | **A dedicated channel with restricted posting.** Keeps the review surface free of unrelated chatter so scrolling is a viable review method. |
| **D2.2** | **Approval rights are permission-controlled, via slash command.** v1 hardcodes Ellie's Slack user ID; a command grants/revokes rights to others. (Inherited from D1.4.) |
| **D2.3** | **`/…export` — zip of all approved images to date.** The hand-off artefact for the web person. |
| **D2.4** | **Weekly/monthly fetch commands** — retrieve the images for a given period. |
| **D2.5** | **CSV upload into Slack, with a size guard.** Either a row limit enforced at ingest, or the service batches posts into groups of 10–20. **Deliberately left open — to be decided by testing which is less unpleasant in a real channel.** |
| **D2.6** | **Slack is the interface; it is NOT the datastore.** *(Added by me — flagged for Alexander's confirmation.)* Approvals are recorded in our own store keyed by SKU and generation ID. The channel renders that state; it never defines it. |

**Why this one.** Three arguments, in order of weight:

1. **It is the purest possible reading of Ellie's constraint (F3.6).** No link, no new
   destination, no install, nothing to remember. D1 required her to open a web page, which
   rested entirely on A2.1 — the assumption that "don't install anything" meant *installing*
   and not *going somewhere new*. That assumption is now **retired**: this design does not
   need it to be true.
2. **Identity comes free (F4.2).** Slack tells us who clicked. D1 would have required magic
   links, sessions, and an access model built from scratch. Given a one-day budget, this
   removes an entire subsystem.
3. **It is one surface, not two.** D1's T1.2 flagged that building both a Slack app and a
   mobile web app inside a day risked two shallow things instead of one working thing.

**What it unblocks.** Message granularity and channel layout, the pending-work discovery
mechanism, storage (F4.4 makes this urgent), the slash command surface, and the CSV
ingest/selection model.

**Explicitly accepted risk.** Alexander's own stated concern: *"main concern is how messy it
would be, but we can pivot later if it's terrible."* Recorded as a known, accepted,
monitored risk — see T2.1. **This is a legitimate way to decide** given that the failure is
observable early and the pivot target (D1) is already fully specified above.

**Carried forward from D1, still unsettled:** whether `Confirm`/stage-closing (D1.5)
survives, or whether `/…export` (D2.3) absorbs its role. See OQ-4.

---

## D3 — Channel layout: flat, one message per image

**Settled:** Round 1, Q1b. **Overrides my recommendation of thread-per-product.**

| Sub-decision | Ruling |
|---|---|
| **D3.1** | **One Slack message per candidate image, at top level.** No contact sheets, no thread-nesting of candidates. Opening the channel shows a scrollable stream of full images. |
| **D3.2** | **Each image message carries an Approve button and a Discard button.** |
| **D3.3** | **Each image message is labelled with a name.** |
| **D3.4** | **Top-level posting is restricted; thread replies are open.** Discussion happens in the thread under the image it concerns — preserving brief step 5's back-and-forth without letting it scroll the review stream. |
| **D3.5** | **`/status` lists image names with state — approved / pending / discarded — each deep-linked to its Slack message** (F4.7), so Ellie can jump straight to anything outstanding. |
| **D3.6** | A higher-level overview command is **deferred**, not rejected. |

**Why flat beats threads.** The argument that won: **threads reduce scroll cost but raise
viewing cost.** A thread parent shows a summary; seeing the actual image requires a tap. On
a phone, one extra tap per image, 120 times, is worse than a longer scroll — because the
scroll is *passive* and the tap is *deliberate*. Ellie's stated workflow is to go one by one
down the stream; flat messages are that workflow rendered directly. The governing principle
Alexander named: **do not make the review process harder than it already is.**

**The naming decision is larger than it looks.** D3.3 asks for a label so Ellie knows what
she's looking at. But F3.4 (the wrong `IMG_43xx.jpg` shipped for three weeks) and A0.1 (no
filename standard in the Drive folder) are both *naming* failures. So the label should not
be a display string — **it should be the deterministic filename itself**, e.g.
`HG-002_morning-kitchen_01.jpg`. The name Ellie reads in Slack becomes the name the web
person receives in the export. One identifier, end to end, no translation step where the
wrong file can be substituted.

**D3.7 — Governing principle, stated explicitly:** *discussion is worth more than tidiness.*
Ellie does not work in a silo. Brief step 5 records her actively soliciting opinions —
"that one," "no, too staged" — and her final word is exercised *after* input, not instead
of it. Any layout that buys a clean channel by removing the place where opinions land is
optimising the wrong variable. Notification volume (T3.4) is the price, and it is accepted
deliberately; a channel can be muted, an amputated conversation cannot be restored.

**D3.8 — Per-image threads centralise the decision record.** *(Added Round 1, Q1b addendum.)*
A further argument for flat messages over the batch-parent design: because each image owns
its own thread, every message about that image is naturally collected in one place. "Where
was that decided?" has a mechanical answer — open the image's thread. This is a **direct
countermeasure to brief step 5's failure**, where the pick lives wherever the conversation
happened. The layout does the filing for us; nobody has to remember to record anything.

---

## D4 — The pipeline is DONE at generate → download → store. Approval is a separate service.

**Settled:** Round 1, Q2.

| Sub-decision | Ruling |
|---|---|
| **D4.1** | **Pipeline scope:** read CSV → build prompts → generate → **download every image** → store → hand off to the Slack comms layer. That is the whole pipeline, and it is DONE at storage. |
| **D4.2** | **Download ALL generated images immediately, not just approved ones.** Driven by F2.3 (Luma URLs expire in 1 hour). Selective download would impose a 60-minute deadline on a human decision process. |
| **D4.3** | **Approval/selection is a decoupled service.** It does not gate, delay, or define pipeline completion. Generation and decision-making run on independent clocks. |
| **D4.4** | **The approval service, on a decision, does two things:** patches our stored record (selected / discarded) and — in the full design — pushes approved files to Google Drive. |
| **D4.5** | **Publishing to the product page stays manual and human.** Out of scope, permanently, not just for the POC (A1.4). |
| **D4.6** | **Data model instinct: model decisions as their own relation, not a boolean column** on the image row. Deferred to implementation, but the shape is chosen now. See T4.3 for a refinement. |
| **D4.7** | **Hard-deleting discarded images is a future item.** Not a priority; storage is cheap (T4.2). |

**Why "done" stops before approval.** Two independent arguments, and both hold:

1. **The 1-hour URL expiry (F2.3) would otherwise leak into human time.** A pipeline that
   waited for approval before downloading would give the team 60 minutes to finish a
   conversation. Alexander's framing is exactly right: *"we never know if there is going to
   be a long discussion or a pivot during approval."* Coupling them would put an API
   implementation detail in charge of how long a team is allowed to deliberate.
2. **Separation of concerns.** Generation is machine work with machine failure modes
   (rate limits, moderation, retries). Approval is human work with human failure modes
   (Ellie is on a flight). Fusing them means a stalled human blocks a batch, and a failed
   generation looks like an undecided image.

**The economic argument that settles D4.2 outright:** the image is already paid for the
moment it is generated (F2.4). Declining to download it saves nothing and risks losing an
asset we bought. **Download-all is strictly dominant, not merely simpler.**

---

## D5 — Handoff: a self-serve Slack query returning a named zip. Drive is a mirror, descoped.

**Settled:** Round 1, Q2. **Resolves the (a)/(b)/(c) choice.**

| Sub-decision | Ruling |
|---|---|
| **D5.1** | **A Slack command retrieves a period's final images** — e.g. `getWeeklyFinalImages`, `getMonthlyFinalImages`. **The web person triggers it themselves**, with no dependency on Ellie or on anyone's Drive habits. |
| **D5.2** | **It returns a zip download.** |
| **D5.3** | **Every file in it carries the standardised, deterministic name** (per A4.4, the same string shown on the Slack image message). |
| **D5.4** | **Google Drive remains in the architecture as a write-only mirror** for backwards compatibility and manual browsing — **and is never the source of truth for what gets uploaded to the site.** |
| **D5.5** | **Drive push is NOT built for the POC.** It adds no value to the demonstration and consumes build time. It belongs in the scope ledger under "next", with its reasoning. |

**The target, in Alexander's words:** *selection/approval, storage, and upload-to-site — where
human error happens most and matters most.* Note that this is precisely the back half of
their process (brief steps 5–7), which is also where both named failures live: the pick
getting lost (step 5) and the wrong file shipping (steps 6–7). **The generation half is the
visible bottleneck; the handoff half is where the damage occurs.**

**Why self-serve matters more than it appears.** A0.2 diagnosed the previous tool's failure
as organisational: Ellie gatekept because nothing was delegated. D5.1 hands the web person a
command they run without asking anyone — which attacks the gatekeeping directly rather than
hoping a dashboard fixes it. It also deletes brief step 7's *"usually after asking in Slack
which files are actually final,"* by making the answer a query instead of a question.

---

## D6 — Status vocabulary. The word "done" is retired.

**Settled:** Round 1, Q2 follow-up (T4.1).

| Stage | Term shown to humans | Means |
|---|---|---|
| Pipeline complete | **`ready for review`** | Generated, downloaded, stored, posted to Slack |
| Per image | **`pending`** / **`approved`** / **`discarded`** | Decision state (D3.5) |
| Batch complete | **`complete`** | Every image in the batch has been actioned (D8.1) |
| Request complete | **`delivered`** | Approved images exported for upload to the site |

**"Done" is banned from all user-facing text.** It is the most overloaded token in this
domain and it is precisely the question the customer cannot currently answer (F1.1).

---

## D7 — Decisions are recorded as events, and approval date drives retrieval

**Settled:** Round 1, Q2 follow-up (points 2 and 3).

| Sub-decision | Ruling |
|---|---|
| **D7.1** | Decisions live in their own relation, **not as a boolean column** on the image row. |
| **D7.2** | The relation is an **event log** carrying `image_id`, decision, **actor's Slack ID**, and **timestamp** — giving all three states, provenance, and reversibility for free (T4.3). |
| **D7.3** | **The row's creation timestamp is the approval date**, and it is what retrieval queries filter on (T4.4). Approving an image writes a row; the row's `created_at` *is* the approval date. |
| **D7.4** | Table naming TBC. |

**⚠️ Conflict flagged for resolution.** Point 2 accepted the **event log** (records approves
*and* discards); point 3 describes an **`approvedImages`** table (records approvals only).
These are different shapes and only one can be built:

- If it is a pure `approvedImages` membership table, `pending` and `discarded` are
  indistinguishable — which is the exact distinction `/status` (D3.5) exists to show, and
  which D8.1's completion check requires in order to know whether every image was actioned.
- **The event log satisfies both descriptions**: it is still "query a table, not a boolean,"
  and an approval still writes a row whose `created_at` is the approval date.

**Proceeding on the event log**, since D8.1 mathematically requires knowing discards.
The name `approvedImages` should therefore change — it would be misleading.

**⚠️ Second, subtler consequence — a query that ships wrong files if written naively.**
With reversibility (T4.3/OQ-2), an image can be approved in week 1 and discarded in week 2.
A query of *"rows created in week 1"* still returns it. Retrieval must filter on
**current state = approved**, not merely on the existence of an approval row in the window.
This is exactly the class of error that produced F3.4, so it is worth stating as an
invariant rather than trusting to care at implementation time.

---

## D8 — Batch completion is automatic, on full actioning. No manual Confirm.

**Settled:** Round 1, Q2 follow-up (point 4). **Resolves OQ-4 — `Confirm` is deleted.**

| Sub-decision | Ruling |
|---|---|
| **D8.1** | On every approve/discard, the server checks whether **every image in the batch has been actioned**. When all are, the batch flips to `complete` automatically. |
| **D8.2** | Only a `complete` batch is retrievable by the fetch command. Completion is what makes a batch's set final. |
| **D8.3** | **Every image must be actioned individually.** No bulk discard, no partial completion, no "skip the rest." To reject the back half of a batch, press Discard on each one. |
| **D8.4** | **The POC ships one retrieval command: get the latest batch.** Weekly/monthly window commands are **deferred** — no use case has been identified yet. |
| **D8.5** | A manual confirm command remains available as a future option if forced completeness proves too rigid. |

**Why forced completeness is the right default.** It is not merely simple — it is a
guardrail. A batch cannot reach `complete` while anything in it is unexamined, so **the
system structurally cannot deliver a set containing images nobody looked at.** Set against
F1.1 (nobody can say what is done) and F3.4 (a wrong file went unnoticed for three weeks),
"you must look at everything before anything ships" is a strong property to get for free
from a completion rule.

**It also composes with `/status` (D3.5).** The obvious failure mode — one un-actioned image
silently blocking a whole batch — is exactly what `/status` surfaces. The two features are
load-bearing for each other, which raises `/status` further in the OQ-3 ranking.

---

## D9 — An output CSV with generated-image URLs, delivered at `ready for review`

**Settled:** Round 1, Q2 follow-up (point 5). **Resolves OQ-9.**

| Sub-decision | Ruling |
|---|---|
| **D9.1** | The pipeline emits a CSV: the input rows plus an appended column carrying **URLs to view the generated images**. |
| **D9.2** | It is produced **after images are downloaded and stored** — i.e. at `ready for review`, before any approval exists. |
| **D9.3** | It is **shared into Slack**, like everything else. |

**Note on timing:** this artefact describes *what was generated*, not *what was approved* —
those are different questions answered at different times. It satisfies Alexander's
`notes.md` requirement ("put the images created into the sheet") and the brief's "an updated
export at the end is fine" (F3.9). See T5.3 for the open sub-questions it raises.

---

## D10 — `uni-1-max`, configurable. Approval integrity is inviolable.

**Settled:** Round 1, Q3.

| Sub-decision | Ruling |
|---|---|
| **D10.1** | **Generate at `uni-1-max`** ($0.1030/image, F2.4). Quality first. |
| **D10.2** | **The model is configuration, not a hardcoded constant** — swapping to `uni-1` must be a config change, so cost spikes have a one-line answer. |
| **D10.3** | **No pre-spend approval gate is built.** The economics do not justify one (T5.1). |
| **D10.4** | **THE INTEGRITY PRINCIPLE — the image that goes to production is byte-identical to the image Ellie approved.** No re-generation at a higher tier, no re-render, no upscale, no re-encode. Ellie approves what ships, not a preview of it. |

**D10.4 in Alexander's words:** *"We do not want any approved image to look different on
production from the moment it was approved. This is unacceptable. We need Ellie to approve
what will be on production, not a watered down version of it."*

**This is the single strongest principle in the design, and it kills a tempting
optimisation.** The obvious cost-saver — draft on `uni-1`, re-render the winner on
`uni-1-max` — is broken, because re-running a prompt on a better model yields a *different
picture*, not a sharper one. It would ship something Ellie never saw and label it approved:
a more sophisticated F3.4. D10.1 exists precisely so that no such substitution is ever
tempting.

**Testable invariant this creates:** the file posted to Slack, the file in the store, and the
file in the export zip are the same bytes with the same checksum. That is assertable in a
test, and it should be.

---

## D11 — Data model: a materialised `approvedImages` table plus an append-only event log

**Settled:** Round 1, Q3 follow-up point 1. **Revises D7.2.**

| Sub-decision | Ruling |
|---|---|
| **D11.1** | **`approvedImages` is a real table and membership is the state.** Presence means approved. Retrieval queries it directly. |
| **D11.2** | **No status column on the images table.** `SELECT * FROM images WHERE status = 'approved'` is explicitly rejected as the query shape. |
| **D11.3** | **An event-log table records every action** (approve / discard), for the completion check (D8.1) and for provenance. |
| **D11.4** | **Undo deletes the posted entry.** Approving then discarding removes the `approvedImages` row rather than layering a superseding state on top of it. |

**This is a read-model + write-log pattern, and it is a better fit than my pure event log.**
Two concrete wins:

1. **Retrieval becomes trivial and hard to get wrong:** `SELECT … FROM approvedImages WHERE
   batch_id = <latest>`. No "latest event per image" window function anywhere in the
   delivery path — which matters, because that path is the one that ships files to a website.
2. **It eliminates the bug I flagged in D7 outright.** The approved-in-week-1,
   discarded-in-week-2 hazard existed only because a stale approval row could still match a
   date window. With D11.4, discarding *deletes the row*, so no stale approval can exist.
   **The design removes the failure mode rather than defending against it** — which is
   strictly better than a correctly-written query.

**`approvedImages` is derived and therefore reconstructible.** The event log is the audit
source of truth; if the two ever disagree, the log wins and the table can be rebuilt by
replay. Worth stating, because it makes the duplication safe rather than merely redundant.

**Open — where does `discarded` live?** D3.5 requires three states. Membership in
`approvedImages` gives approved vs. not-approved. Deriving `discarded` from the event log
would reintroduce the "latest event per image" logic D11.2 exists to avoid. **My proposal:
a symmetric `discardedImages` table.** Then every state is plain membership —
approved = in one, discarded = in the other, pending = in neither — the completion check
(D8.1) becomes `count(approved) + count(discarded) == batch size` without touching the log,
and the event log is left as pure audit. See OQ-14.

**⚠️ "Undo deletes any posted entries" carries more weight than it appears.** If approval
ever triggers side effects — the Drive push (D4.4), a future publish hook — then undo must
cascade to **every one of them**. An undone approval that leaves a file sitting in Drive is
precisely F3.4: a stale wrong file, available for upload, with nobody aware. Recorded as an
invariant: **approval side effects must be enumerable and reversible, or they must not
exist.**

---

## D12 — `batch_id`, assigned at CSV upload

**Settled:** Round 1, Q3 follow-up point 2.

| Sub-decision | Ruling |
|---|---|
| **D12.1** | A simple incrementing integer `batch_id`, **populated when the CSV is uploaded** — before generation. |
| **D12.2** | "Latest batch" means highest `batch_id`. Retrieval sorts on it. |
| **D12.3** | Retrieval filters **current state = approved, for the latest batch** (D11.1 + D12.2). |

**One CSV upload = one batch.** Clean and unambiguous. Two consequences to accept knowingly:

- **Empty batches are possible.** A batch exists from upload; if the user never presses
  Generate (D14), the `batch_id` is allocated and unused. Harmless, but "latest batch" must
  mean *latest batch with content*, or a stray upload will make retrieval return nothing.
- **Re-uploading the same CSV creates a second batch.** Deliberate and correct — a re-run is
  a new attempt, not an edit of the old one.

---

## D13 — CSV ingest: a slash command opening a modal, inside Slack

**Settled:** Round 1, Q4 part 1.

| Sub-decision | Ruling |
|---|---|
| **D13.1** | Ingest is a **slash command that opens a modal** carrying instructions. Confirmed buildable via Slack's `file_input` element (F4.13). |
| **D13.2** | **Strict format validation** — required headings, expected columns. Only a conforming file is accepted. |
| **D13.3** | **Everything stays in Slack.** Introducing a web upload here would contradict D2 and, in Alexander's word, be *unintuitive*. |

**Why a modal beats dropping the file in the channel.** The channel is the review stream
(D3.1). A CSV posted there is noise in the one place that must stay scannable — and it would
sit among the image messages Ellie is scrolling. **The modal keeps ingest off the review
surface entirely**, which flat-message layout makes more valuable than it would otherwise be.

---

## D14 — Ingest is a two-step workflow: validate and recap, then a button to generate

**Settled:** Round 1, Q4 part 2. **Resolves OQ-6.**

| Sub-decision | Ruling |
|---|---|
| **D14.1** | **Upload never generates.** It validates and returns a recap. Nothing is spent. |
| **D14.2** | The recap reports: is the CSV structured correctly, are the headings right, **and how many rows have the Shot Idea column filled**. |
| **D14.3** | The recap carries a **button that triggers generation**. The user sees exactly what they are about to commit to before committing. |
| **D14.4** | **Auto-fixing or rewriting shot ideas at ingest is explicitly rejected** — considered and cut as out of place at this step. |

**The purpose, in Alexander's words:** *"if it fails, or if it's three hundred
white-background images, they're not surprised — because they hit the approve and generate
button."*

**This is a better answer to Maya's budget fear than the one I recommended in Q3.** I argued
against a pre-spend gate on economic grounds — a gate costing half a build-day to save $30 is
the wrong trade (T5.1). But **this gate is essentially free**: it is validation you must do
anyway, with a button attached. It costs almost nothing and it retires the fear, which the
economics alone could not do. Maya's *"don't burn our budget on stuff she'll reject"* is
answered not by spending less, but by never spending without a human seeing the bill first.

**Which makes the recap the natural home for OQ-13 (cost visibility).** The recap should
state the number of images and the estimated spend — *"16 of 40 rows have shot ideas → 48
images ≈ $4.94"* — because that is the exact moment the question is live in the reader's
mind, and the data is already in hand.

**D14.2 also makes the blank-Shot-Idea problem visible rather than silent.** A recap saying
*"16 of 40 rows have shot ideas"* surfaces A1.2 — that the drop will arrive mostly blank —
at the moment someone can act on it. That is the subject of Q5.

---

## D15 — `confirm-review-done`: a manual gate for everything downstream of approval

**Settled:** Round 1, T6.2 follow-up. **Partially reinstates what D8 deleted — with a different job.**

| Sub-decision | Ruling |
|---|---|
| **D15.1** | **Downstream side effects (the Drive push, delivery) fire only after every image is actioned.** Never mid-review. |
| **D15.2** | **The trigger is manual, not automatic.** A human declares the review finished. |
| **D15.3** | The command is `/luma confirm-review-done` (naming TBC), **and it is also exposed as a button** so Ellie taps rather than types. |
| **D15.4** | **The intro message that prefaces the image stream states the instruction** — "when you've reviewed everything, press this." |

**Why manual is right, and why this does not contradict D8.** These are two different things,
and separating them is the whole value:

| | Trigger | Meaning | Nature |
|---|---|---|---|
| **`complete`** (D8.1) | Automatic, on last action | *"Every image has been decided"* | A **computed fact** |
| **`confirm-review-done`** (D15) | Manual | *"I am finished; publish it"* | A **declared intent** |

A machine can determine the first. Only a human can assert the second — she may have
actioned everything and still want to revisit one.

**This resolves T6.2's undo blast radius, cleanly.** Because no side effect fires before
confirm, **undo is free before confirm and expensive after.** That gives A7.1 an actual
mechanism instead of a hope: the window in which reversals are cheap is exactly the window
in which they are likely.

**⚠️ Placement problem with D15.4.** The intro message sits at the **top of 120 messages**.
After reviewing, Ellie is at the *bottom*. Telling her to scroll back up to a button she
passed an hour ago is the kind of small friction that gets a feature abandoned.

**Proposed fix:** keep the instruction in the intro message *as information*, but **post the
button as a fresh message at the moment the batch auto-completes (D8.1).** That is the
natural moment, it appears where she already is, and it only exists when it is actionable —
so it can never be pressed early. The auto-completion event and the confirm affordance
become one interaction.

**⚠️ Open — what does confirm gate in the POC?** With Drive descoped (D5.5), if confirm only
triggers the Drive push it does **nothing observable in the demo**, and an invisible button
should not be built. The coherent answer: **confirm is the transition to `delivered` (D6),
and `delivered` is what enables retrieval.** That gives it a real job now and a bigger one
later. But it means revising D8.2, which currently gates retrieval on `complete`. See OQ-16.

---

## D16 — `discardedImages` table. All three states are membership.

**Settled:** Round 1, OQ-14. **Resolves OQ-14.**

Symmetric to `approvedImages` (D11.1). Consequently:

- `approved` = row in `approvedImages`
- `discarded` = row in `discardedImages`
- `pending` = row in neither
- **Completion check (D8.1)** = `count(approved) + count(discarded) == batch size` — two
  counts, no event-log traversal, no window functions. This runs on every button press.
- The event log (D11.3) is left as **pure audit**: who did what, when, including reversals.

---

## D17 — CSV validation is deterministic. No LLM repair.

**Settled:** Round 1, T6.5 follow-up.

| Sub-decision | Ruling |
|---|---|
| **D17.1** | **No LLM parsing or restructuring of the CSV.** Considered and rejected: hard to build, not a priority, and redundant work. |
| **D17.2** | **Structure is enforced.** Required headings must be present; content must sit in the required columns. |
| **D17.3** | **Content quirks are tolerated** and reported, not rejected. |
| **D17.4** | **Errors must be comprehensive enough that the team knows why** — an actionable message, not a rejection. |

**D17.4 is a real spec, not a nicety.** The bar: an error must name what was expected, what
was found, and what to change — *"Missing required column `Photo`. Found: SKU, Product Name,
Category, … Expected: SKU, Product Name, Category, Color / Finish, Material, Price, Photo,
Shot Idea, Notes."* This matters because **the recipient is not an engineer**, and per T6.5
the first real contact with next month's production data may well be a rejection. A bad
error message at that moment reads as "the product is broken."

**Why rejecting the LLM repair is right:** an LLM that silently restructures a customer's
file introduces an unauditable transformation between what they sent and what we processed —
in a system whose entire purpose is eliminating "which file is the real one." Determinism is
worth more than tolerance here.

---

## D18 — Generate only rows with a Shot Idea. Proposal for blanks is designed, deferred.

**Settled:** Round 1, Q5.

| Sub-decision | Ruling |
|---|---|
| **D18.1** | **POC behaviour: generate only rows whose Shot Idea column has content.** Maya's literal ask. |
| **D18.2** | **The ingest recap (D14.2) reports both counts** — how many rows have a shot idea, how many don't — so the gap is visible, not silent. |
| **D18.3** | **An opt-in to propose shot ideas for blank rows is part of the design**, offered from the recap. |
| **D18.4** | **Mechanism:** an LLM reads the shot ideas already present and derives ideas in the same spirit for the blank rows. |
| **D18.5** | **Fallback when no shot ideas exist at all:** produce something standard — what a professional studio / marketing agency would shoot. |
| **D18.6** | **D18.3–D18.5 are follow-up scope.** Build D18.1 first. |

**D18.4 is the smart part, and worth stating plainly in `APPROACH.md`.** Deriving proposals
*from the team's own existing shot ideas* means the output sounds like **Ellie wrote it**,
not like an AI. "morning kitchen counter, steam, warm light" and "holiday mantel with
evergreen" are a house style; few-shotting from them preserves it. This is the difference
between a tool that drafts in her voice and one that replaces her taste — and taste is the
one thing she has never asked anyone to take from her.

**⚠️ Refinement needed: few-shot from history, not from the current file.** Per A1.2, next
month's 40-product drop will likely arrive with **zero** shot ideas. If D18.4 only learns
from the file it is given, the generic fallback (D18.5) fires **exactly when the feature
matters most** — the first real test. **The 16 existing shot ideas (F1.5) are the training
set**, and they live in the *current* catalog, not the drop. So proposals must draw on all
historical shot ideas across batches. Cheap to build in from the start, awkward to retrofit.

---

## D19 — Decision writes are deferred to `confirm-review-done`. Confirm = `delivered`.

**Settled:** Round 1, OQ-16. **Revises D8.2, D11.4, D16.**

| Sub-decision | Ruling |
|---|---|
| **D19.1** | **During review, decisions are recorded in the event log only.** `approvedImages` and `discardedImages` are not written. |
| **D19.2** | **`confirm-review-done` materialises the final state** into `approvedImages` / `discardedImages`, in one transaction. |
| **D19.3** | **Confirm is the transition to `delivered`** (D6), and `delivered` is what enables retrieval. |
| **D19.4** | **Changing your mind before confirm requires no undo** — it is simply another event. There is nothing to reverse because nothing has been materialised. |
| **D19.5** | The intro message still carries the instruction about confirming (D15.4), even though the actionable button is posted at auto-completion. |

**What this buys, and it is more than the stated reason.** Alexander's rationale was avoiding
undo. Worth noting that **T6.2's undo problem was already solved by D15** — deferring *side
effects* to confirm is what removed the blast radius; the table rows were never the painful
part. What D19 actually buys is **semantic**: `approvedImages` now means *"the record of what
was delivered,"* not *"what someone has clicked so far."* That is a cleaner thing for a table
to mean, and it is exactly what the retrieval path (D12.3) wants to read.

**The consequence to accept.** With no materialised tables during review, `/status` must
derive the three states from the event log — the latest-event-per-image logic D16 was
designed to avoid. **This is acceptable because it is now confined to a display query.** The
delivery path — the one that ships files to a website — still reads plain table membership.
The complexity sits where a mistake shows a wrong label, not where a mistake ships a wrong
file.

**Completion check (D8.1) stays simple.** "Actioned" means *has any event*, so the check is
`COUNT(DISTINCT image_id) FROM events WHERE batch_id = X` against the batch size. A distinct
count, not a window function.

**Revised status flow:**
`ready for review` → *(all actioned)* → `reviewed — awaiting confirmation` → *(confirm pressed)* → `delivered` → retrievable.

---

## D18 — REVISED: shot-idea proposal is cut, not deferred

**Revised:** Round 1, Q5 follow-up.

**D18.3, D18.4, D18.5 are CUT.** The system is **input-only**: it generates from Shot Idea
text that a human wrote into the CSV. No LLM proposes, derives, or invents shot ideas. Cut
on time, explicitly.

**D18.1 and D18.2 stand:** generate only rows with Shot Idea content, and the ingest recap
reports both counts so the gap is visible.

**⚠️ CRITICAL DISTINCTION — this must not be over-applied.** There are two entirely separate
LLM uses in this design, and only one is cut:

| | Use | Status |
|---|---|---|
| **LLM-A** | **Propose** shot ideas for blank rows | **CUT** (D18) |
| **LLM-B** | **Translate** a human's shot idea into a generation prompt | **STILL OPEN — likely essential** |

LLM-B is a different problem. The brief is explicit that Shot Ideas are *"worded as what the
creatives are picturing, not as an AI prompt"* — `"on a set dinner table, with food in it?"`
is a thought, complete with a question mark, not an instruction to an image model. Something
must bridge that gap. **"No time for LLM generation" was said about LLM-A and must not
silently remove LLM-B**, which is the central open question of Round 2.

---

## D19 — REVERTED (partially). Decision writes are live again.

**Reverted:** Round 1, D16 follow-up. D19 stood for one exchange.

**D19.1 and D19.2 are REVERTED.** Approving or discarding writes **immediately** to
`approvedImages` / `discardedImages`. Membership is the live state during review, exactly as
D11.1 and D16 specified.

**Reason:** `/status` must not read the event log. D19 pushed latest-event-per-image logic
into the status query; reverting keeps all three states as plain membership checks
(D16), everywhere, at every moment.

**Consequently restored:**
- **D11.4** — changing a decision *deletes* the row from one table and inserts into the other.
- **D8.1's completion check** — `count(approved) + count(discarded) == batch size`. Two
  counts, no log traversal.
- The event log (D11.3) returns to being **pure audit**: who did what, when, including
  reversals. Nothing reads it in the operational path.

**D19.3 survives:** confirm is still the transition to `delivered`. See D20.

**Net position on the data model, now stable:**

| Relation | Written when | Read by |
|---|---|---|
| `images` | At generation | Everything. No status column (D11.2). |
| `approvedImages` | On approve (live) | `/status`, retrieval |
| `discardedImages` | On discard (live) | `/status`, completion check |
| `eventLog` | On every action | **Nothing operational.** Audit and provenance only. |

---

## D20 — What `confirm-review-done` is for: a delivered-batch pointer

**Settled:** Round 1, D16 follow-up. **Resolves OQ-15 and OQ-16.**

Alexander's own framing of the problem: *"without it the web person will always get the
previous batch of images."* That is the clearest statement of what confirm does.

| Sub-decision | Ruling |
|---|---|
| **D20.1** | **A pointer records the latest *delivered* batch.** Retrieval reads through the pointer, not through "highest batch_id". |
| **D20.2** | **Confirm advances the pointer** to the batch just confirmed, and marks it `delivered` (D6). |
| **D20.3** | **Confirm triggers downstream side effects** — the Drive push, when built (D4.4, D5.5). |
| **D20.4** | **Every step is confirmed back in the Slack message**, so the state change is visible where the action happened. |

**⚠️ Correction to the phrasing.** *"The confirm message might update the current Batch Id
table to batch Id + 1"* conflates two counters. `batch_id` is allocated at **CSV upload**
(D12.1) and identifies a batch; it must not be incremented by confirm, or the ID would no
longer identify the thing it was assigned to. What advances is a **separate pointer** —
`latest_delivered_batch` — which confirm sets to the batch being confirmed. Retrieval then
reads `approvedImages WHERE batch_id = latest_delivered_batch`.

**This is a better design than "highest batch_id" and it resolves OQ-15 for free.** An
uploaded-but-never-generated batch, or a generated-but-unreviewed one, can never become the
target of a fetch — because the pointer only ever moves on a human confirmation. **The web
person structurally cannot pull an unfinished set.** That was the open worry in OQ-15 and
it disappears rather than needing a rule.

**⚠️ Open — what happens to a delivered batch that is then changed?** Alexander raised and
rejected hard-freezing: *"prevent any further changes to the selection? but this seems
unreasonable."* Agreed — Ellie must be able to fix a mistake. But the alternative cannot be
silent change, because the web person may already hold the downloaded zip, and a delivered
set that quietly diverges from the current state **is F3.4** — a stale wrong file in
circulation with nobody aware.

**Proposed middle path (needs a ruling — OQ-17):** changes after delivery are allowed and
simply update the tables, but the batch is marked **`delivered — modified since`**, and
`/status` says so. Re-confirming re-delivers and clears the flag. Not a freeze; an
acknowledgement that something downstream is now out of date.

---

## D21 — LLM-B is in. Notes are out. Inputs are fixed.

**Settled:** Round 1, Q6 and LLM-B follow-up.

| Sub-decision | Ruling |
|---|---|
| **D21.1** | **LLM-B is kept**: it translates a human's Shot Idea into a generation prompt. |
| **D21.2** | **The `Notes` column is cut entirely from v1.** Not read, not passed, not interpreted. |
| **D21.3** | **The inputs to prompt-building are: Shot Idea + Photo + product attributes** (name, category, colour/finish, material). Nothing else. |
| **D21.4** | Alexander's rule, recorded verbatim as the principle: **"if it needs to be in the shot, it should be in Shot Idea."** |

**Why cutting Notes is right, measured rather than argued.** Per F5, across the 16 rows that
would actually generate: 1–2 prompts improved, 4 unaffected, **3 actively corrupted**. Raw
Notes corrupt roughly twice as many rows as they improve. The multi-product requests
(`El: shoot with the mugs maybe`) are legitimate creative instructions that are simply
**incomprehensible to a single-product generator** — passing them through produces mugs in a
blanket photograph.

**D21.4 is also a process fix, not just a scope cut.** It gives the team a clear contract:
the Shot Idea column is the instruction, and anything that must reach the image belongs in
it. That is a better answer than teaching a machine to guess which of four kinds of note is
a styling constraint.

**⚠️ CONFLICT FLAGGED AND RESOLVED.** Earlier in the same message: *"[LLM-B] should also
translate the notes (if applicable only) into the shot idea."* That contradicts the Q6 ruling
made a few lines later. **Proceeding on the Q6 ruling** — later, explicit, reasoned, and
supported by F5. Notes are cut. Flagged in case the intent was the reverse.

**⚠️ Second ambiguity flagged.** *"If blank it should default to something."* If this means
*blank Shot Idea → invent one*, it re-introduces LLM-A, which was cut in D18.
**Proceeding on D18.1: a blank Shot Idea means the row is not generated.** See OQ-18.

---

## D22 — A confirmed batch is frozen. No editing after `delivered`.

**Settled:** Round 2, OQ-17. **Resolves OQ-17.**

| Sub-decision | Ruling |
|---|---|
| **D22.1** | **Once `confirm-review-done` is pressed, the batch is immutable.** No approvals, no discards, no reversals. |
| **D22.2** | **This must be made explicit to the user before they confirm** — the confirm affordance states that decisions cannot be changed afterwards. |
| **D22.3** | Chosen to avoid the added complexity of a `delivered — modified since` flag and a re-confirm cycle. |

**What this makes the design.** Batches become **immutable ledger entries**: a batch is
open for decisions, then closed forever. Nothing that was delivered is ever rewritten.

**This is a stronger position than it first appears.** Every failure in the brief comes from
mutable, ambiguous records — a Drive folder that accumulates and is edited by hand (A0.1),
a pick that lives wherever the conversation happened (F3.3), a wrong file that sat live for
three weeks (F3.4). **An append-only history of frozen batches is the structural opposite of
all three.** "What did we deliver in batch 3?" has exactly one answer, permanently.

**⚠️ The recovery path must be named, because D22 removes the obvious one.** A mistake
spotted after confirm cannot be edited. The coherent remedy is **a new batch**: re-upload the
affected rows, generate, review, confirm. This is consistent with D12 (one CSV upload = one
batch) and with how the team already works in cycles. **Corrections are supersessions, not
edits.** See T9.1 for the consequence this has for retrieval.

---

## D23 — The generated prompt is shown in the image message

**Settled:** Round 2, Q7 part 1. **Overrides my recommendation of store-but-hide.**

| Sub-decision | Ruling |
|---|---|
| **D23.1** | **The prompt LLM-B produced is displayed in the image's Slack message**, alongside the image and its filename label (D3.3). |
| **D23.2** | Full transparency: the team can always see what the machine was asked to make. |

**The argument for it, which is better than my objection was.** Their previous tool failed
partly for lack of visibility (A0.2) — a black box nobody could see into. Showing the prompt
is the structural opposite of that. And it does something my "hide it" recommendation could
not: **it teaches the team what the system does with their words.** Seeing
`morning kitchen counter, steam, warm light` become a full generation prompt is the fastest
possible way to learn what a good Shot Idea looks like — which is precisely the contract
D21.4 asks them to keep. Transparency here is an adoption mechanism, not just a courtesy.

**⚠️ It does have a real cost against D3.** The review stream must stay scannable (T3.1); a
40–80 word prompt between every pair of images adds substantial vertical distance on mobile,
in the one workflow the flat layout was chosen to optimise.

**Proposed mitigation — use a `context` block, not a `section` block.** Slack renders context
blocks in small, de-emphasised grey text. The prompt stays fully visible and copyable, but
reads as a footnote rather than as content competing with the image. This preserves D23's
transparency at a fraction of the scroll cost. Recommended unless overruled.

---

## D24 — N distinct prompts per product, 2–3 candidates

**Settled:** Round 2, Q7 part 2.

| Sub-decision | Ruling |
|---|---|
| **D24.1** | **Each candidate gets its own distinct prompt**, not N samples of one prompt. LLM-B produces deliberately divergent interpretations of the same Shot Idea. |
| **D24.2** | **2–3 candidates per product, always.** |

**Why distinct prompts.** Ellie's judgement is comparative — *"that one," "no, too staged."*
Three samples of one prompt give her three near-identical images and a false choice. Three
deliberate interpretations — different framing, different light, different degree of styling
— give her a real one. It also gives *"too staged"* somewhere to land: if one of the three is
deliberately restrained, she has an option when the others are too much.

**The cost:** LLM-B now has a harder job. "Expand this into a prompt" is easy; "produce three
genuinely different readings of this that are all faithful to it" is a real prompt-design
problem. Done badly it yields three descriptions of the same photograph and the choice
collapses anyway. It also makes each candidate fail independently — one of three may be
nonsense — where one-prompt-N-samples fails uniformly.

---

## D25 — Start strict. Friction is deliberate. Recovery is a tech request, not a feature.

**Settled:** Round 2, OQ-19. **Resolves OQ-19.**

| Sub-decision | Ruling |
|---|---|
| **D25.1** | **The freeze (D22) stays rigid.** No product mechanism edits a delivered batch. |
| **D25.2** | **High-priority post-delivery corrections go through the web person as a tech request.** An engineer queries the store directly. |
| **D25.3** | **This is viable only because discarded images are retained** — nothing is deleted, so anything ever generated can be recovered by hand. |
| **D25.4** | **The friction is intentional.** If the team proves unable to confirm cleanly and decisions start flying around, the rigidity is reverted — with evidence. |

**The governing principle, in Alexander's words:** *"The more flexibility provided, the more
the client usually wants. Start strict and then get feedback."*

**This is the right shape for a forward-deployed first version and worth stating in
`APPROACH.md` as a stance rather than an omission.** Rigidity is reversible on evidence;
flexibility, once given, is not. Every escape hatch shipped in v1 becomes a workflow someone
depends on by v2, and it is far cheaper to loosen a constraint the team is pushing against
than to remove an affordance they have already built habits around.

**⚠️ THIS REVERSES D4.7.** D4.7 recorded hard-deleting discarded images as a future
housekeeping item. **It must not be built.** D25.3 makes retention the *only* recovery path
for a post-delivery error — deleting discarded images would remove the sole remedy for the
failure mode D22's freeze creates. Storage is cents per month (T4.2), so there was never a
reason to delete; now there is an active reason not to.

**Recorded as a rule:** discarded images are retained indefinitely. `discardedImages` is not
a wastebasket, it is the recovery ledger.

---

## ~~D26 — Regeneration with an editable prompt, before approval~~ DEFERRED TO POST-V1

> **Status: DEFERRED** (Round 2, Q9). Considered, specified, and cut from v1 — to be
> revisited once the v1 system is in place. Kept in full because the mechanics are worked
> out and because it is the strongest item in the scope ledger's "next" column.

**Originally settled:** Round 2, Q8. **Alexander's addition — not among the options I offered.**

| Sub-decision | Ruling |
|---|---|
| **D26.1** | **A third affordance on each image message: regenerate.** Alongside Approve and Discard. |
| **D26.2** | **The prompt is editable at the point of regeneration.** Because D23 already displays it, the user can change it and re-run for that image. |
| **D26.3** | **Low friction is a requirement, not a preference.** Tap → modal with the prompt pre-filled → edit → submit. |
| **D26.4** | Rationale: *"A one-time generation is never the correct option if it's too rigid."* |

**This subsumes T9.4's shortfall problem, and better than any option I offered.** I framed the
gap as *"what if rejection leaves a product with one approved image"* and proposed
over-generating or flagging. **Regeneration answers it at the point of failure instead**: if
two of three are wrong, fix the prompt and re-run those two. Spend follows need rather than
being provisioned in advance for a rejection rate nobody can predict (A10.4). It also turns
D23's transparency from a nice-to-have into a *mechanism* — showing the prompt is what makes
editing it possible.

**It does not violate D10.4 (the integrity principle), and it is worth saying why**, because
it looks like it might: regeneration happens **before** approval. Ellie still approves exactly
what ships. What D10.4 forbids is changing an image *after* approval; D26 changes it *before*.
The two are complementary — D26 is how you get to an image worth approving, D10.4 is what
guarantees that image is the one delivered.

**Open mechanics, all consequential — see OQ-20 through OQ-23.**

---

## D27 — 1:1 aspect ratio

**Settled:** Round 2, Q8.

All generations at `1:1` for v1. Works on a product page, works on social, crops predictably.
Multi-format output (one shot idea rendered at several ratios for different destinations) is
deferred — it competes with D24.1 for the same three candidate slots, and **format
multiplication and creative variety are different axes; v1 can only afford one.** Variety
wins; formats are addable later by re-running an approved prompt at a new ratio, which is one
of the few regenerations that does not violate D10.4 because it produces an explicitly new
deliverable rather than a substitute for an approved one.

---

## D28 — Regeneration is deferred. v1 is single-pass.

**Settled:** Round 2, Q9. **Defers D26.**

**v1 behaviour:** each product gets 2–3 candidates (D24.2), generated once. The reviewer's
only actions are Approve and Discard. There is no second attempt inside the product.

**Consequences to carry knowingly:**

1. **T9.4's shortfall gap re-opens and is now unanswered.** F3.2 defines a completed request
   as 2–3 approved images. With 3 candidates, no regeneration, and D22's freeze, a product
   whose candidates are mostly rejected ends the batch **below the definition of done, with
   no in-product remedy.** This needs a v1 answer — see Q10.
2. **OQ-20 through OQ-23 are parked with D26**, not resolved. Replacement vs. append,
   filename versioning, spend caps, and regenerate-after-approve all become live again the
   moment regeneration is built. The analysis in T10.1–T10.3 stands and should be read before
   that work starts.
3. **D23 loses one of its two justifications.** Showing the prompt was argued for on two
   grounds: transparency/adoption, and enabling prompt editing at regeneration time. **The
   second is gone.** D23 still stands on the first — which was always the stronger argument
   (A0.2: their last tool failed for lack of visibility) — but it is now purely informational,
   and the A10.2 risk (Ellie drifting into writing prompts rather than pictures) is no longer
   offset by any control it gives her. Worth re-examining if the review stream feels cluttered.
4. **The escape hatch for a bad batch becomes the tech request (D25.2)** or a fresh CSV
   upload — the same rigidity chosen in D25, now applying to generation quality as well as to
   post-delivery correction. Consistent, and consistent with *"start strict and get
   feedback."*

**Why deferring is defensible.** v1's job is to prove the loop works end to end: CSV in,
images out, decisions captured, files delivered under names that mean something. Regeneration
makes that loop *better*; it is not what makes it *work*. And T10.3's warning is real —
a third button converts review from a scroll into a workshop, which is a change to the
core interaction, not an addition to it. **Shipping the triage loop first and learning the
real rejection rate (A10.4) is what makes the regeneration decision informed rather than
guessed.**

---

## D29 — Short products are flagged, not backfilled

**Settled:** Round 2, Q10.

A product finishing with fewer than 2 approved images is **reported** — in `/status` and on
the batch summary — rather than padded with extra candidates or silently accepted.
*"3 products finished with fewer than 2 approved shots."*

**Why.** One count in a query already being written. It never under-delivers silently, which
matters because silent under-delivery is F1.1 wearing new clothes. And it defers the
expensive choice (generate 4? build regeneration?) until the number that decides it exists —
A10.4, the real rejection rate, which one batch will supply and no amount of reasoning will.

**Explicitly rejected:** generating 4 candidates as insurance. $4 is nothing, but 40 extra
images is 40 more decisions and 40 more messages in the flood (T3.4) — **buying insurance
with Ellie's attention, the one genuinely scarce resource in this system.**

---

## D30 — Runtime: one always-on TypeScript service, Postgres, DB-backed job table

**Settled:** Round 2, Q11/Q12.

| Sub-decision | Ruling |
|---|---|
| **D30.1** | **A single always-on Node/TypeScript service.** Serves Slack webhooks *and* runs the pipeline worker. Not serverless — the pipeline is inherently long-running and paced (F2.7, F4.8, F6.1). |
| **D30.2** | **Postgres** for all relational state. |
| **D30.3** | **A job table in Postgres, not a queue service.** Restart-safety, retry, and visibility from the database already required. "What is the pipeline doing?" becomes a query. |
| **D30.4** | **One job row per candidate image**, not per batch — so recovery resumes at image granularity, which is the mid-batch-interrupt failsafe. |
| **D30.5** | **Write intent before spending.** Insert the job row (committed) *before* `POST /v1/generations`, because F7.5 confirms there is no idempotency key. |
| **D30.6** | **Retry policy is taken directly from F7.2/F7.3**, not invented. |
| **D30.7** | **Rate limiting is adaptive, not configured** — start conservative, read `X-RateLimit-Remaining` from every 201, back off on 429 branching on the `detail` field (F2.6). |
| **D30.8** | **`/status` counts committed rows only.** Never in-memory counters — so it is structurally incapable of reporting work that did not happen. |

**Pipeline state vs. decision state — keep them apart.** D11.2 banned status columns, but that
ruling was about *approval*. Pipeline state is machine-owned, transient, and an execution
detail; a status column on the job table is correct. Approval state is human-owned, durable,
and the business record; it stays membership (D16). **Worth writing down so nobody later
"tidies" one into the other.**

**The one unavoidable loss:** a crash between Luma accepting a request and us persisting the
generation ID orphans a paid generation — $0.1030, unrecoverable (F7.5). This is the safe
direction to fail. `user_id` is set to our internal image ID (F7.6) to give a reconciliation
handle against Luma's usage records.

---

## D31 — Storage: S3-compatible object store, served through the app

**Settled:** Round 2, Q12 part 1 ("use the easiest").

| Sub-decision | Ruling |
|---|---|
| **D31.1** | **S3-compatible object storage via the AWS SDK with a configurable endpoint** — so AWS S3 and Cloudflare R2 are drop-in alternatives and provisioning speed decides, not code. |
| **D31.2** | **Objects are keyed by a random ULID**, giving the permanent unguessable URL A6.4 requires. |
| **D31.3** | **The meaningful filename is served via `Content-Disposition`**, not encoded in the URL path. |
| **D31.4** | **Images are served through the app** (`/img/{ulid}`), not from a public bucket — giving filename control without public-bucket ACL configuration. |
| **D31.5** | **Download once, checksum, store, never re-encode.** One canonical object per image. |

**D31.2 + D31.3 resolve a tension carried since Q2.** A6.4 wants an unguessable URL so the
CSV does not rot; A4.4 wants a deterministic meaningful filename so the web person can trust
what they upload. These look opposed — unguessable versus predictable — but they are
*different fields*. **The URL is random; the downloaded file is named
`HG-002_morning-kitchen_01.jpg`.** Both properties, no compromise.

**D31.5 is where D10.4 gets its anchor.** One object, one checksum, referenced by Slack and
streamed into the zip. The integrity invariant becomes assertable rather than aspirational.

**Note:** `.env.example` already provisions `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
`AWS_REGION` and states reviewers will supply real keys — a signal that S3 is the
lowest-friction choice for reproducibility.

---

## D32 — Image bytes are uploaded into Slack, not referenced

**Settled:** Round 2, Q12 part 2. **Overrides my recommendation of `image_url`.**

| Sub-decision | Ruling |
|---|---|
| **D32.1** | **Upload bytes to Slack** via the three-call flow (F8.1) rather than pointing an `image_url` at our storage. |
| **D32.2** | **Rationale: decoupling.** The channel is the permanent record (D2, D3) and should not break if our storage does. |
| **D32.3** | Easy to reverse if it proves too much load on Slack. |

**This is the right call and it is the more robust one.** If the channel is genuinely the
record of what was decided, it should not depend on infrastructure we control — a rotated key
or a dead bucket would turn 120 permanent messages into 120 broken images.

**What it costs:** a second copy of every image, and ~3 API calls per image instead of 1
(F8.1). Mitigated by `files.completeUploadExternal` being Tier 4 (100+/min, F8.3), which is
more generous than `chat.postMessage`.

**⚠️ The build risk that must be retired on day one:** F8.2 — buttons on a file-share message
depend on `blocks` accepting an `actions` block, which the docs do not state explicitly.
**D3.2 depends on it.** Two fallbacks are recorded in F8.2; test before committing.

---

## D33 — Command surface and build order

**Settled:** Round 2, Q13. **Resolves OQ-3.**

**In v1 — the non-negotiable spine:**

| # | Surface | Decision |
|---|---|---|
| 1 | Ingest — slash command opening a modal | D13 |
| 2 | Validation recap + Generate button | D14 |
| 3 | Approve / Discard buttons per image | D3.2 |
| 4 | `confirm-review-done` — button and command | D15.3 |
| 5 | **Get-latest-batch → zip. Mandatory, high priority.** | D5.1, D8.4 |

**Cut from v1:** the permissions grant/revoke command (D2.2). Ellie's Slack user ID stays
hardcoded. Consistent with T1.4 — at six people an allowlist in config may be the permanently
correct answer, and the command is ceremony.

**Best-effort, built last:** `/status` (D3.5).

**Alexander on the zip (D33.5):** *"the zip export is mandatory for the web person to be able
to carry out their job, so it's high priority. It's how Slack returns it after querying."*
Correct — it is the entire delivery mechanism. Without it the system produces decisions and
no artefacts, and the back half of the process (brief steps 6–7), which D5 identified as the
real target, stays exactly as broken as it is today.

**Build order, front-loading risk:**

1. **Hour one:** the three verifications (F4.5, F4.12, F8.2) + the four-cent rate-limit probe
   (F8.5) + **a deployed hello-world** — F3.10 is a hard requirement and late deploy problems
   are the classic way a one-day build dies.
2. Slack app skeleton, channel, DB schema
3. Ingest → validate → recap → Generate button
4. Pipeline: submit → poll → download → store (D30)
5. Post to Slack with buttons (D32)
6. Approve / Discard → completion check → confirm
7. **Zip export — mandatory**
8. `/status` — if time allows

**⚠️ The honest consequence of `/status` being last.** It is load-bearing for three separate
things accumulated across this design: Ellie's re-entry into a 120-message stream (T3.1),
D8.1's failure mode where one un-actioned image silently blocks a batch, and — most
significantly — **Maya's entire stated ask** (*"I'd want to see where things stand without
having to ask Ellie,"* F3.7d).

**If `/status` does not ship, one of the two named stakeholders gets nothing from v1.** That
must be said plainly in the scope ledger rather than listed as a missing feature, because the
brief grades whether cuts were made by value or by running out of time — and this one would
be the latter.

**The near-free mitigation remains available** and is recorded in case the schedule tightens:
a crude `/status` built at step 4 is a `SELECT COUNT(*) … GROUP BY state` over a schema that
already exists. It makes the pipeline debuggable while the rest is built, and grows into the
real feature for free — **the same code serving developer observability and Maya's
requirement.**

---

## D34 — LLM-B prompt architecture: the brand's own aesthetic, in a cacheable prefix

**Settled:** Round 2, Q14.

| Sub-decision | Ruling |
|---|---|
| **D34.1** | **Model: `claude-opus-5`.** LLM-B is ~3.5% of batch cost (F9.3); there is no cost argument for downgrading. |
| **D34.2** | **Output shape forced by structured outputs** (`output_config: {format: …}`), **not prefill** — prefill returns 400 on Opus 5 (F9.2). |
| **D34.3** | **The stable system prefix carries the brand's aesthetic, derived from their own CSV** — not invented. |
| **D34.4** | **The 16 existing shot ideas are included as tone calibration**, so output matches their register rather than generic product-photography language. |
| **D34.5** | **Prefix caching on that stable block.** ~1,500 tokens, identical across every product in a batch — exactly the shape caching is designed for. |
| **D34.6** | **FOLLOW-UP: the system prompt becomes editable by the team**, so they can steer and maintain a consistent design and feel across all generations. |

**The aesthetic is in the data, and using it is the "we read your catalog" move.** Across the
40 rows the palette is *terracotta, sage, dusty blue, cream, forest, ochre, clay pink,
charcoal, smoke, amber*; the materials are *stoneware, linen, acacia, recycled glass, organic
cotton, soy blend*. Muted earth tones, natural materials, handmade home goods. **This is a
brand identity recoverable from the CSV alone**, and putting it in the cached prefix is the
difference between shots that look like this brand and shots that look like stock.

**On D34.6 — a strong follow-up, with one requirement attached.** Letting the team edit the
system prompt turns brand voice into a **maintained artefact** rather than a hardcoded
constant, and it is the natural home for the taste that D21.2 removed when Notes were cut —
*"pricey, needs to look premium"* becomes a brand rule rather than a per-row note. **But it
must be versioned:** if the prompt can change, then "which prompt version produced this
image" becomes a provenance question, and D10.4's integrity story depends on being able to
answer it. Store a prompt version ID on every generated image. Cheap now; unreconstructible
later. See OQ-25.

---

## D35 — A second CSV at `delivered`, recording what was approved

**Settled:** Round 2, Q15. **Resolves OQ-11.**

On `confirm-review-done`, the system emits a CSV recording **what was approved** — the
counterpart to D9's export, which records what was *generated*.

**Nearly free** (same code, different query) and it closes the gap F1.1 identified: the
sheet's defining flaw is having nowhere to record outcomes, which is *why* nobody can say
which of the sixteen requests are done. **This is the artefact Maya pastes back into the
master sheet**, and it is the only thing in the design that repairs the source spreadsheet
rather than routing around it.

---

## D36 — Blank Shot Idea: pass the original photo through, unmodified

**Settled:** Round 2, Q16. **Changes D18.1.**

| Sub-decision | Ruling |
|---|---|
| **D36.1** | A row with a blank Shot Idea is **not skipped**. Its original white-background photo is **downloaded, stored, named, and posted** like any other image. |
| **D36.2** | **The Luma step is skipped entirely.** No prompt, no generation, **$0 cost.** |
| **D36.3** | Everything else follows the identical path — same storage, same deterministic naming, same Slack message, same approve/discard. |
| **D36.4** | Rationale: **a blank Shot Idea may be intentional** — the team may want the plain product shot. |

**This is better than skipping, for a reason beyond intent.** It makes a batch deliver **an
image for every product** — styled where a shot idea existed, original where it didn't — so
the export zip is a *complete* set rather than a partial one. The web person receives
everything for the drop in one pull, which is what D5's self-serve retrieval was for.

**It also gracefully handles A1.2's worst case.** If next month's drop arrives almost empty,
the system does not sit idle — it still produces a complete, named, reviewed set:

| Drop scenario | Generated | Pass-through | To review | Cost |
|---|---|---|---|---|
| 40 shot ideas | 120 | 0 | 120 | $12.81 |
| 20 shot ideas | 60 | 20 | 80 | $6.40 |
| **3 shot ideas** | 9 | 37 | 46 | **$0.96** |
| **`catalog.csv` as given (16 of 40)** | **48** | **24** | **72** | **$5.12** |

**Two mechanics that follow, and one open question:**
- **Naming must distinguish a pass-through from a styled shot** — a filename like
  `HG-001_original.jpg` versus `HG-002_morning-kitchen_01.jpg`. The web person must never
  have to guess whether a file was modified.
- **D23 has nothing to show.** There is no prompt for a pass-through; the message should say
  so plainly ("original photo — no shot idea given") rather than leaving an empty field.
- **Open (OQ-26): is a pass-through reviewed, or auto-approved?** It is already the live
  product photo, so approving it is arguably a formality — but auto-approval would breach
  D8's guarantee that no set ships containing an image nobody looked at.
  **Recommendation: review it like anything else.** One tap, consistency preserved, and if
  the blank was *intentional* (D36.4) then confirming it is a real decision, not a formality.

---

## D37 — v1 approval rights: Ellie only

**Settled:** Round 2, Q17. **Resolves OQ-1.**

A single hardcoded Slack user ID. Nobody else can approve or discard in v1.

Matches F3.3 exactly — *"her pick is the decision; there's no other approval step"* — and it
means A2.3's contradiction (delegated rights vs. Ellie's final word) never arises. **Others
still participate fully**: they discuss in per-image threads (D3.4), which is precisely what
brief step 5 shows them doing. **Nothing is taken away from the team; the decision simply
stays where it already is.**

---

## D38 — One message per product, images referenced from our own endpoint

**Settled:** 2026-09-05, after probe 4. **Revises D3.1 and reverses D32.**

| Sub-decision | Ruling |
|---|---|
| **D38.1** | **One Slack message per product**, carrying every candidate that survived, each with its own Approve and Discard directly beneath it. |
| **D38.2** | Images are `image` blocks pointing at our own `/img/:id` endpoint — **not** files uploaded into Slack. |
| **D38.3** | A candidate that failed is **named in the message** with the reason, rather than silently absent. |
| **D38.4** | A pass-through gets its own message stating plainly that the photo is the original and was not changed. |

**Why the reversal was forced.** F12 measured it: an `image` block cannot
reference a Slack-hosted file that was never shared to a channel — by id or by
private url, both rejected as `invalid slack file`. Sharing the file first
creates the very message we are trying to replace. So the only working path to
"several images in one message, each with its own decision" is a public URL,
which we already serve.

**What reversing D32 actually costs.** D32 kept bytes in Slack so the channel —
the permanent record — would not break if our storage did. But **D2.6 already
establishes that Slack is the interface and never the datastore**: decisions
live in Postgres, images live in the bucket under a checksum. A storage outage
therefore breaks the *rendering* of a channel, not the *record* of anything,
and the bytes remain available to re-post from. D32 was protecting convenience
while reading as though it protected correctness.

**The residual risk, stated plainly:** a channel of broken images looks alarming
to a non-technical team even when nothing is lost, and it makes the product look
unreliable exactly when it is under scrutiny. Watch for it; the mitigation if it
ever bites is to re-post from the bucket.

**What it buys beyond layout.** Message volume drops from 120 to 40 for the real
catalog — a two-thirds cut in notification volume. Threads still hang off each
product's message, so the discussion survives intact.

**Note this beats both options from the original Q1b debate.** Threads were
rejected because they lowered scroll cost but raised viewing cost — a tap per
image. This lowers both: every candidate is visible without a tap, and the
channel is a third of the length.

---

## D39 — The channel is an index; the images live in each product's thread

**Settled:** 2026-09-05. **Revises D38. Restores D32.**

| Sub-decision | Ruling |
|---|---|
| **D39.1** | **One text-only message per product in the channel:** SKU, product name, shot idea, and a live count of how many photos are decided. No images. |
| **D39.2** | **The candidates go in that message's thread**, one file share each, with Approve and Discard on the image they belong to. |
| **D39.3** | **Bytes are uploaded to Slack again**, restoring D32. `files.completeUploadExternal` accepts `thread_ts` (F8.4) and blocks ride on file shares (F8.2). |
| **D39.4** | **Discussion happens in the same thread**, beside the images. |

**Why this beats every shape considered before it.** The Q1b objection to threads
was exact and correct: *"threads reduce scroll cost but raise viewing cost"* —
one deliberate tap per image, 120 times. **The objection was about granularity,
and the granularity changed.** One tap per *product* is 40, and inside the
thread all of that product's candidates are visible at once.

| Shape | Channel | Taps to see all | Discussion |
|---|---|---|---|
| Flat per-image *(original)* | 120 image messages | 0 | Per image |
| Batch-parent *(rejected, F4.10)* | 1 message | 1, then scroll 120 | **Nowhere** |
| Per-product with images *(D38)* | 40 image messages | 0 | Per product |
| **This** | **40 text lines** | **40** | **Per product** |

**And the discussion problem dissolves rather than being traded.** F4.10 killed
the batch-parent design because a single thread level meant images and
conversation could not both live there. At *product* grain they can, and should:
*"that one, not the others"* is a comparison across a product's candidates, so
the product is the correct home for both the images and the argument about them.

**What it costs.** A tap to see anything. The channel tells you a product exists
and how far along it is, but not what the photographs look like — so a reviewer
cannot triage by glancing. That is the deliberate trade: the channel becomes
searchable rather than browsable.

**A reversal recovered.** D38 had to reference images from our own endpoint,
because an `image` block cannot reference an unshared Slack file (F12). Posting
each candidate as a file share sidesteps that entirely, so the bytes are back in
Slack and the channel no longer depends on our storage.

---

## D40 — A read-only overview page, linked from Slack

**Settled:** 2026-09-05.

| Sub-decision | Ruling |
|---|---|
| **D40.1** | An HTML page showing the whole batch: every product, its candidates, their state, spend, and what came up short. |
| **D40.2** | **Read-only.** No approving, no discarding, no editing. |
| **D40.3** | Reached by an **unguessable 128-bit token** stored on the batch. No login, no expiry; anyone with the link can look. |
| **D40.4** | **Polls every four seconds while anything is still generating**, and reloads only when the state actually changed. |
| **D40.5** | Linked from the batch-start message and from `/luma status`. |

**Why read-only is the load-bearing part.** Approvals stay in Slack because
Slack tells us who clicked (F4.2). A page reached by a shared link cannot say
who decided — `decision_events.actor` would degrade from a person to *whoever
had the link*, and F3.3's *"Ellie's pick is the decision"* would drop from
enforced to conventional. **That is the same gap that let F3.4 go unnoticed for
three weeks: nobody could say who chose what.** Keeping the page read-only means
the token can be shared freely and still authorises nothing.

**Why polling rather than SSE.** Railway caps SSE at 15 minutes with a 5-minute
idle close, and the research found **no primary source** on whether an SSE
stream survives a locked iPhone (F13, `Research-html-review-surface.md`). Ellie
is phone-first. A failed poll retries; a dropped stream leaves a progress page
**looking finished when it is not** — the worst available failure for a progress
indicator.

**Why this does not repeat the tool they abandoned.** F3.5: nobody logged into
the dashboard after week one. **Nobody has to log into this one to do their
job** — the work happens in Slack, and the page is something you glance at out
of curiosity. A page visited by choice has a different survival rate from one
visited by obligation. It is also, finally, a direct answer to Maya's stated ask
(F3.7d) rather than an indirect one.

---

## D41 — Every write moves to the page; Slack keeps none

**Decision.** Approve, discard and confirm are removed from Slack entirely and
exist only on the overview page. The Slack thread keeps the photographs and
keeps the conversation; it no longer carries a control.

**Why.** Three reasons, in order of weight.

1. **Deciding needs the whole set in view.** Approving shot 2 of 3 is a
   comparison, not a verdict. In Slack the three candidates arrive as three
   file shares in a thread and the comparison happens by scrolling. On the page
   they sit side by side. The decision being made is "which of these", and the
   surface should show "these".
2. **A button in a channel is a button everyone can press.** Slack's block
   actions carry the presser's user id, so we could check it — and did — but
   the control was still drawn for every reader, and refusing after the tap is
   worse than not offering. The page draws controls only for a viewer who may
   use them (D42).
3. **Two surfaces for one action is two implementations of one invariant.**
   Byte-identity (D10.4) and the delivered pointer (D20.1) have to hold no
   matter which path wrote. One path is one place to get that right.

**Cost.** Deciding now takes a tap into a browser rather than a tap in the
channel — see T14.

---

## D42 — Write access is a list, checked on every write

**Decision.** `write_access` holds Slack user ids. `SLACK_APPROVER_USER_ID` is
the bootstrap member and cannot remove itself. `/luma signin` issues a
single-use magic link (10 minutes) that trades for a 24-hour cookie session.
Every write endpoint resolves the session and re-checks membership **on that
request**, not at sign-in.

**Why re-check.** A capability stamped into the session at sign-in outlives a
revocation by up to a day. Ellie removing someone should take effect on their
next click, which means the check belongs on the write, not on the login. The
cost is one indexed lookup per write, against an action that already writes to
three tables.

**What the two credentials mean.** They answer different questions and are
deliberately not merged:

| Credential | Question it answers |
|---|---|
| Review token, in the URL | *Which batch may you look at?* |
| Session cookie | *May you act on anything at all?* |

So the link is shareable — anyone in the channel can read the overview — while
acting stays with the people on the list.

---

## D43 — The handover takes two taps

**Decision.** The confirm control arms on the first tap and sends on the
second, reverting after five seconds.

**Why.** Confirming freezes the batch and advances the delivered pointer, and
nothing undoes it. It now sits on the same page as up to 48 approve and
discard buttons, which is exactly the context in which a mis-tap is likely.
The deliberate friction of D22 was previously supplied by the action living in
a different surface; with the surfaces merged, the friction has to be explicit.

---

## D44 — The recap is a modal step, not a channel message

**Decision.** `/luma upload` now runs entirely inside one modal stack: attach a
CSV → a "reading your file" view → the recap, whose **submit button is
Generate**. Nothing about the upload reaches the channel until a batch actually
starts.

**Why the estimate and the decision are one view.** Previously the recap was a
channel message with a Generate button attached, which meant the bill and the
button were a message anyone could act on, and a rejected file was announced to
everyone. Making Generate the modal's submit means you cannot press it without
the estimate in front of you — the friction is structural rather than
typographic.

**Why a pushed "reading" view.** Slack gives a `view_submission` about three
seconds to respond, and downloading plus parsing a catalog does not reliably
fit. So the response is `response_action: "push"` with a view that says the
work has started, and the deferred task draws its own outcome into that view
when it finishes. This is the same shape as D33's "announce first, work second".

**How we find the view again.** A view pushed in a submission response never
tells us its id. Slack lets a view carry an `external_id` we choose, and
`views.update` accepts it in place of `view_id` — so the id is minted before
the push and used after it. It is unique per workspace, hence a UUID rather
than the batch id, which does not exist yet at push time.

**A failed upload has no submit button at all.** The error view is a view with
no `submit`, so there is nothing to press. Refusing after the press would be
worse than not offering.

---

## D45 — The cost goes to the channel when the batch starts

**Decision.** The public "generating N photos" message now names the estimate
and the model. The recap that used to carry that number is private under D44.

**Why.** The upload is one person's business; the spend is the team's. Moving
the recap into a modal removed the only place the channel saw a price, and a
pipeline that spends money without saying so in the shared room is the thing
the brief was worried about.

**Recomputed, not carried.** The recap describes a *file*; this describes a
*batch*, and only the second is a commitment. Both derive from the same rows so
they agree, but the number quoted publicly is taken at the moment of spending.

---

## D46 — One @-mention per batch, and it is the last one

**Decision.** The "batch has started" message names nobody. The single ping is
"ready for review", at the end, and it now carries the overview link.

**Why.** I briefly added "run by @someone" to the start message for
accountability and it put two pings on one batch — usually on the same person,
since the uploader is normally the approver. The whole notification design
rests on the stream being quiet enough that the one ping means *your turn*. A
second one trains people to ignore both. Accountability is better served by the
audit trail than by a notification.

---

## D47 — The system prompt is editable, but only its opinion half

**Decision.** `/luma system-prompt` opens a modal showing the wording that turns
a shot idea into three prompts, prefilled and editable. Saving stores an
override in a `settings` table (migration 0007); saving an empty box reverts to
the built-in.

**What is *not* editable, and why.** The system prompt has two halves:

| Half | Where it comes from | Editable |
|---|---|---|
| Brand block — palette, materials, categories, the team's own shot-idea phrasing | Read from the uploaded catalog, per batch | No |
| Direction — the job, and the rules | Written by us | **Yes** |

Letting an override replace the whole prompt would have been less code and
strictly worse: every edit would silently discard the catalog-derived identity,
which is the thing that makes the output look like *this* brand rather than
stock. So `buildSystemPrompt(brand, direction)` composes the two, and the modal
edits the second while saying plainly what sits above it.

**Absence means default.** Nothing is written to the row until someone
overrides. Snapshotting the built-in at first open would mean any later
improvement to the built-in silently failed to reach anyone who had ever opened
the modal.

**Read at generation time**, not at the composition root — an override saved
after the process started applies to the next batch, not the next deploy.

**Who may change it.** The same list as approving: `canWrite`, not
`canAdminister`. It changes what gets made and what it costs, so it belongs
with the people who answer for the results. Re-checked on submit, because a
modal outlives the permission that opened it.

**Announced in the channel.** A change to what every future batch looks like is
not a private setting. The post names who changed it and says it applies to the
*next* batch — nothing already generated is ever re-made.

**Length is capped at 4,000 characters.** This text rides on every prompt call,
so a long one is a per-product cost, and the refusal says so rather than just
naming a limit.

---

## D48 — Regeneration is one manual shot, appended

**Decision.** Every candidate on the overview page carries a third control,
"Ask for another". It opens a box prefilled with the prompt that shot was made
from. Submitting generates **one** image, from **exactly** the text written,
and **appends** it to the product as a new slot.

Three differences from the batch path, each deliberate:

| | Batch | Reshoot |
|---|---|---|
| How many | 3 | **1** |
| Prompt | written by LLM-B from the shot idea | **used as typed** |
| Effect on existing shots | — | **none; appended** |

**Why one and not three.** The batch makes three because nobody has said what
they want yet, and variety is the answer to that. By the time someone is
reshooting they have looked at three attempts and know exactly what was wrong.
Making three more would be spending twice as much to throw two away.

**Why the text is used verbatim.** Passing a considered instruction through a
model that rewrites it is the one thing guaranteed to lose what made it
considered. The brand block still applies — it is the image model's own
context — but nothing rephrases what the person wrote.

**Why appended, never substituted.** A reshoot is a new opinion about a shot,
not a correction of the record. The photo it was asked from stays exactly where
it was, decided or not. This is the same rule as D10.4: what was approved is
what gets published, and nothing quietly changes underneath a decision.

**Blocked until the product's thread exists.** The new photo is posted into
that thread. Generating first and discovering there is nowhere to put it would
be spending money to produce an orphan. `hasThread` is checked from
`message_ts`, not from the permalink — the permalink call can fail while the
thread exists perfectly well.

**Blocked once the batch is delivered.** Adding to a handed-over batch would
change what the web person was given.

---

## D49 — A reshoot joins the product's conversation

**Decision.** When a regenerated image is ready, the worker posts it into the
product's existing thread and redraws the product's channel line, rather than
posting a second line about the same product.

**Why.** D39 made the channel an index with one line per product. A second line
for the same SKU would break exactly the adjacency that decision was for. The
redraw keeps the line's counts true as the set grows.

**The failure note is not reposted.** It is posted only when the thread is
created, otherwise every append would repeat the same sentence about the same
failures.
