# APPROACH

> **Status: design complete, build in progress.** This document is the design of record.
> Live URLs and workspace access are in [Getting In](#getting-in) — filled at deploy.
> The full reasoning trail lives in [`Approach/`](./Approach/): every fact I verified,
> every assumption I took, every decision and what it cost.

---

## What I'm building, and why

**A Slack app, with one page hanging off it. Almost the whole product is Slack; the single
exception is the page where photographs are compared, and it is linked to, never navigated
to.**

Maya's team told me exactly what they rejected: *"Last quarter they trialed a
creative-automation tool with a beautiful dashboard. Nobody logged in after week one."*
And Ellie set the constraint herself: *"it has to work from my phone, and I don't want to
install anything new."*

The dashboard didn't fail because it was ugly. **It failed because it required pull** —
someone had to remember to go there. Slack is push. It arrives where the team already is,
and — critically — it's where the decision already happens today: step 5 of their current
process is literally *"Ellie forwards her favorites into Slack for opinions."*

So the design rule is: **the work comes to Ellie, and nothing new gets installed.**

That rule survived contact with the build; the "no web page at all" corollary did not. The
distinction turned out to be the load-bearing one: a dashboard fails because it requires
*pull*. A link that arrives in the message telling you your photographs are ready is still
push — it is the notification that does the remembering, not the person. Nothing is
installed, nothing is logged into daily, and the page cannot be reached without Slack
handing you the link. See revision notes on decisions 1 and 2.

### The loop

1. **Upload** — a slash command opens a modal, drop the CSV in. It never touches the review channel.
2. **Recap** — the system validates and reports back: *"40 rows, 16 with shot ideas, 24 without, 48 images ≈ $4.94."* **Nothing has been spent yet.** One button starts the batch.
3. **Generate** — each shot idea becomes 2–3 *distinct* prompts via Claude, rendered against the product's own white-background photo. Rows with no shot idea pass their original photo through untouched, for free.
4. **Review** — one line per product in the channel, its three candidates posted into that product's thread, and a link to the overview page anchored at that product. The page shows a product's shots side by side, which is the shape of the decision; the thread is where *"no, too staged"* lands on the shot it is about. Approving and discarding happen on the page, behind a session (`/luma signin`).
5. **Reshoot, if none of them are right** — "Ask for another" takes a prompt you write yourself and makes one more, appended to the product and posted into its thread. Nothing is replaced.
6. **Confirm** — when every image has a yes or a no, a confirm panel appears on the page. It takes two taps and freezes the batch.
7. **Deliver** — the web person runs one command and gets a zip. Every file named `HG-002_morning-kitchen_01.jpg`. No asking Slack which ones are final.

### What this actually fixes

The brief describes seven steps. The visible bottleneck is steps 3–4 — the photographer,
the weeks of waiting. **But both named disasters live in steps 5–7:** the pick that lives
"wherever the conversation happened," and the wrong `IMG_43xx.jpg` that shipped to a product
page and sat there for three weeks.

Generation is the part everyone notices. **The handoff is where the damage occurs.** This
design targets both, but it treats the second as the harder problem — because it is.

---

## Key decisions and tradeoffs

### 1. All-in-Slack — no web app, not even for approval → **reversed**

I first designed a hybrid: Slack notifies, a magic link opens a mobile review page. I
abandoned it.

**Why:** the hybrid rested on assuming Ellie meant *"don't install"* rather than *"don't make
me go somewhere new."* I couldn't verify that, and the whole design hung on it. All-in-Slack
doesn't need the assumption to be true. It also means **identity is free** — Slack tells us
who clicked, so there are no magic links, no sessions, no auth system to build.

**Cost:** Slack gives no filtering, no sorting, no side-by-side comparison. Review is
scrolling. At 120 images that's real, and it's the thing most likely to need revisiting.
The hybrid is fully specified and remains the named pivot — and the expensive half of the
system (pipeline, storage, prompts, ingest) survives that move untouched.

> **Revised after building it.** I took the named pivot. Approve, discard and confirm now
> live on the overview page; Slack keeps the photographs, the threads and every
> notification. The cost above is what forced it: **approving shot 2 of 3 is a comparison,
> not a verdict**, and Slack renders three candidates as three file shares you scroll
> between. The page puts them side by side, which is the shape of the decision actually
> being made.
>
> The prediction held — the expensive half survived untouched. Pipeline, storage, prompts
> and ingest needed no change; what moved was where the buttons are drawn.
>
> What I got wrong was calling identity "free". It was free *until* deciding left Slack,
> and then it cost a magic link, a session and an access list — about a day's work. That
> is a fair price for the comparison view, but it was a real cost hidden inside a
> decision I had described as costless. See D41–D43.

### 2. One flat message per image, not threads → **reversed**

Threads would collapse the channel from 120 messages to 40. I recommended them. **The
counter-argument won: threads reduce scroll cost but raise viewing cost.** A thread parent
shows a summary; seeing the image takes a tap. One deliberate tap, 120 times, is worse than a
longer passive scroll on a phone.

Flat messages also mean **each image owns a thread**, so every comment about an image is
filed under that image automatically. *"Where was that decided?"* gets a mechanical answer.
That's a direct countermeasure to the pick living wherever the conversation happened.

**Cost:** notification flood. 120 messages is 120 pings, and Slack has no sender-side mute.
Mitigated by a single @-mention on the batch summary with the stream posted quietly — and
noted as the sharpest un-mitigated risk, because **if Ellie mutes the channel, every push
property that justified this design evaporates.**

> **Revised after building it.** The channel is now one line per *product*, with that
> product's three candidates posted into its thread.
>
> The tap-cost argument was sound and is now paid somewhere else: seeing the photographs
> means opening the page, once, rather than tapping 120 times. Once deciding moved off
> Slack (§1) the flat stream had no job left — it was carrying buttons that no longer
> existed, at the price of 120 messages.
>
> The filing property survived intact, and is the reason threads came back rather than
> disappearing: every comment about a shot still lands under that shot. The page links
> into each product's thread and each product's line links back into the page, so
> *"where was that decided?"* still has a mechanical answer. See D39, D41.

### 3. Approval integrity is inviolable

**The image that goes to production is byte-identical to the image Ellie approved.** No
re-render, no upscale, no re-encode, no regeneration at a higher tier.

This killed a tempting optimisation: *draft on `uni-1`, re-render the winner on `uni-1-max`.*
That's broken — re-running a prompt on a better model produces a **different picture**, not a
sharper one. It would ship something she never saw and call it approved: a more sophisticated
version of the `IMG_43xx` bug. So we generate at `uni-1-max` from the start and ship exactly
what was approved. It's assertable by checksum, and it is.

### 4. Batches are immutable

Once confirmed, a batch is frozen — no edits, no reversals. Corrections are a **new batch**,
not an edit.

**Why the strictness:** every failure in the brief comes from mutable, ambiguous records — a
Drive folder edited by hand, a decision in a chat log, a wrong file that stood for three
weeks. An append-only history of frozen batches is the structural opposite. *"What did we
deliver in batch 3?"* has exactly one answer, permanently.

**The reasoning behind the stance:** the more flexibility you give, the more the client wants.
Start strict, then loosen on evidence. Rigidity is reversible; an affordance people have
built habits around is not. A post-delivery correction is deliberately a tech request — the
friction is the point, and it makes the frequency visible.

### 5. Show the bill before spending it

Maya's fear — *"don't burn our budget on stuff she'll reject"* — is real, and anchored on
photographer economics. The actual number is **$12.36 for a 40-product drop.**

I initially argued against building a pre-spend gate: half a build-day to save $30 is a bad
trade. **That was wrong, for the right reason.** The recap gate costs almost nothing — it's
validation you must do anyway with a button attached. And it answers her in the way the
economics can't: *the numbers prove the fear is unfounded, but a proof is not a reassurance.*
Seeing the bill is.

### 6. The `Notes` column is ignored — and that was measured, not assumed

Notes look valuable: *"El: smoke glass photographs badly, careful"* is Ellie's taste written
down in advance. So I checked what feeding them into prompts would actually do across the 16
rows that generate:

| Outcome | Rows |
|---|---|
| Prompt improved | 1–2 |
| No effect (scheduling notes, priority flags) | 4 |
| **Prompt corrupted** | **3** |

`HG-011` is a *Woven Throw Blanket*, shot idea `draped over a reading chair`, note
`El: shoot with the mugs maybe`. Fed to a generator, that plausibly produces **mugs in a
blanket photograph.**

**Raw Notes corrupt roughly twice as many rows as they improve.** They're not junk — they're
four different kinds of instruction that only a human currently tells apart. The rule
instead: **if it needs to be in the shot, it goes in Shot Idea.** That's a contract the team
can follow, and it costs them nothing they weren't already doing.

### 7. Never delete a discarded image

Storage is cents. More importantly, retention is the *only* recovery path for a
post-delivery error, given that batches are frozen. `discardedImages` isn't a wastebasket —
**it's the recovery ledger.**

The invariant that comes with it: **a discarded image must never be reachable through any
handoff command.** An engineer must be able to reach one; the product must never hand one
out. Otherwise we've rebuilt the wrong-file bug inside our own system, with better tooling to
do it faster.

---

## The road not taken

Three designs were specified and rejected. The strongest:

### Slack notifies, a mobile web app holds the approvals

The original design. A Slack message pushes a magic link; Ellie opens a phone-shaped page and
swipes; shared auto-saved state means anyone can see what's approved without asking her.

**Its real advantages:** a purpose-built review view — filter to pending, compare candidates
side by side, no scroll archaeology at 120 images. A canonical, linkable "what is final"
page. No Block Kit ceilings, no Slack layout constraints. Honestly, **a better review
experience.**

**Why it lost:** it required Ellie to open a link, which rests on an interpretation of her
words we cannot check. It required building an auth system Slack gives away. And it meant two
surfaces inside a one-day budget — likely two shallow things instead of one that works.

**It remains the pivot.** If scrolling 120 images proves unusable, the pipeline, storage,
prompt translation and ingest all move over unchanged; only the presentation layer is rebuilt.

### Also considered and rejected

- **One batch-parent message, images in its thread.** Solves tidiness *and* the notification flood structurally. Killed by one fact: **Slack threading is single-level.** Put the images in the thread and per-image discussion has nowhere left to go — pushing the team back to channel-level replies or DMs, which is today's failure.
- **A login-gated dashboard.** Rejected on evidence, not taste: it's the tool they already abandoned.

---

## Scope ledger

### In

| Item | Reasoning |
|---|---|
| CSV ingest via slash command + modal | Keeps ingest off the review stream; stays inside Slack |
| Validate → recap → Generate button | The budget answer, and what makes it safe to aim at 300 rows |
| Generation pipeline (submit → poll → download → store) | The product |
| One channel line per product, photographs in its thread | The product |
| Overview page: every candidate for a product side by side | Where approving and discarding actually happen |
| Magic-link sign-in, 24h sessions, an access list | The price of moving decisions off Slack |
| Auto-completion + confirm | Turns "12 approved" into "we're finished" — the thing nobody can answer today |
| Zip export by command | The web person's entire job; delivery doesn't exist without it |
| Deterministic filenames end-to-end | The direct fix for the named disaster |
| Two CSV exports (generated, approved) | The only artefact that repairs the source spreadsheet |

### Out

| Item | Reasoning |
|---|---|
| Publishing to the product page | No site access, and the brief never describes how publishing works. The last mile stays human. |
| Writing to Google Drive | **The folder is the bug, not the goal.** No naming, no index, no way to tell shipped from unshipped — and step 7 admits the web person already doesn't trust it. Writing to it creates a *second* place claiming to know what's final, inside a system whose defining problem is disagreement about what's final. Kept in the architecture as a write-only mirror; not built. |
| Multi-product grouped shots | `El: shoot with the mugs maybe`, `bathroom set w/ the towels?` — **Ellie has already asked for something this can't do.** Needs multiple sources composited into one scene and a grouping concept the CSV has no column for. Named rather than half-built. |
| LLM-authored shot ideas | Cut on time. See *Next* — it's the highest-value item there. |
| Prompt versioning per image | The editable system prompt shipped without it. Nothing records *which* wording a given photo was made from. See *Next*. |
| A ceiling on reshoots | Nothing caps how many times a shot can be re-asked. Hand-typed one at a time is real friction but not a budget. |
| Multi-format output (social / banner ratios) | Competes with creative variety for the same three candidate slots. Variety wins; formats are addable later. |

### Built after v1

| Item | Where it landed |
|---|---|
| Every write on the page, behind a signed-in session | D41–D43 |
| Ingest recap as a modal step; cost announced in the channel | D44–D46 |
| Editable system prompt (`/luma system-prompt`) | D47 |
| Reshoot: one manual shot, appended (`Ask for another`) | D48/D49 |
| One-off try-outs (`/luma generate`) | D50 |
| Access management (`/luma access`) | D42 |

### Next, in priority order

1. **Prompt versioning on every image.** The system prompt is now editable, which means
   "what wording produced this photo?" has become a question the system cannot answer.
   The fix is to stamp the direction onto the batch at generation time. **This is the debt
   that shipping D47 created**, and it comes first for that reason.
2. **LLM-proposed shot ideas for blank rows.** **v1 automates the photographer; it does not automate Ellie reconstructing the wishlist from the sheet, Slack scrollback, and her inbox.** With 24 of 40 rows blank today and the drop likely emptier still, this is cut *by risk and sequencing, not by value.*
3. **Attention-side scaling** — bulk actions, auto-approving pass-throughs. Now the sharpest
   limit: the page makes comparison cheap, which makes the number of comparisons the wall.
   See *what breaks first*.
4. **A spend ceiling.** Reshoots and one-offs are both uncapped and one-off spend appears in
   no report at all. Invisible at today's volume; the first sign of trouble would be a bill
   nobody can attribute.
5. **Drive write-only mirror**, if the team's habit proves immovable.

---

## Unit economics

Generation is `image_edit` on `uni-1-max` at **$0.1030/image**. Prompt translation is
`claude-opus-5` with a cached brand prefix, ~**$0.011/product**.

| Scale | Images | Image cost | Prompts | **Total** | Approved | **$ / approved image** |
|---|---|---|---|---|---|---|
| One 40-product drop | 120 | $12.36 | $0.45 | **$12.81** | ~100 | **$0.128** |
| Full 300 catalog | 900 | $92.70 | $3.38 | **$96.07** | ~750 | **$0.128** |
| **10× catalog (3,000)** | 9,000 | $927.00 | $33.75 | **$960.75** | ~7,500 | **$0.128** |

**~13 cents per approved image, flat at every scale.** The catalog as delivered — 16 shot
ideas among 40 rows — costs **$5.12**, because the 24 blank rows pass through free.

**In minutes:** a batch is submitted, polled, downloaded and posted in roughly the time it
takes to post it — Slack's ~1 message/second is the binding constraint, so a 40-product drop
takes about two minutes of machine time. Against the current process — *"two or three times a
year… weeks later, candidate shots come back by email"* — the change isn't a percentage.

**What changes at 10×: nothing, on cost.** It scales linearly and stays trivial.

---

## What breaks first under pressure

**Ellie does. Not the system.**

| Scale | Cost | Human review load |
|---|---|---|
| 40-product drop | $12.81 | 120 decisions ≈ **6 minutes** |
| Full 300 catalog | $96.07 | 900 decisions ≈ **45 minutes** |
| **10× catalog** | **$960.75** | **9,000 decisions ≈ 7.5 hours of continuous tapping** |

Every architectural choice here is cheap to scale — Postgres, object storage, a job table,
adaptive rate limiting against a sliding window. **What doesn't scale is the single human in
the approval path.** The rule that every image gets a yes or a no is a *guarantee* at 120
images: no set can ship containing something nobody looked at. At 9,000 it's a full working
day of button-pressing.

> **Revised.** Moving review onto the page changed the arithmetic without changing the
> conclusion. The channel is now 3,000 lines rather than 9,000 messages, and comparing a
> product's shots is one glance rather than three scrolls — so the per-decision cost fell.
> The **number** of decisions did not. A cheaper tap, 9,000 times, is still a working day,
> and making comparison cheap arguably brings that wall closer by removing the excuse.

The mitigations that matter at 10× are all attention-side — bulk actions, sampling, auto-
approving pass-throughs, delegated rights. **Only the last of those is built** (`/luma
access`, so the day can be split across several people rather than resting on one). That
divides the wall; it does not move it. The rest is the honest ceiling of this design.

**The three things that break before that:**

1. **Ellie mutes the channel.** Undetectable from our side, and it silently converts push back into pull — the exact failure of the tool they abandoned. *Watch for:* time-to-first-decision stretching. Assume the notification path broke before assuming she's busy.
2. **A batch stalls on one un-actioned image.** Completion requires all of them; one missed image blocks delivery. `/luma status` is the recovery — which is why it's near-essential rather than a reporting feature. The overview page makes the stall visible at a glance, which is the cheaper half of the same fix.
3. **The first real drop CSV gets rejected on structure.** Validation is strict by design. The mitigation is entirely in the error message: it must name what was expected, what was found, and what to change — because the reader isn't an engineer, and a bad error at that moment reads as "the product is broken."

---

## Getting in

> Filled at deploy.

- **Live URL:** _TBD_
- **Slack workspace invite:** _TBD_
- **Try it yourself:** `/luma upload` and drop in a CSV with the same columns as `data/catalog.csv`. The recap appears in the same modal and tells you exactly what it would make and what it would cost; nothing is spent until you press Generate. `/luma help` lists everything.
- **To decide on anything:** `/luma signin` gives you a link that lasts a day. Reading the overview page needs nothing.

---

## The reasoning trail

Everything above is a summary. The working record is in [`Approach/`](./Approach/):

| File | What's in it |
|---|---|
| [`Facts.md`](./Approach/Facts.md) | Everything verified — data quirks, Luma pricing and failure taxonomy, Slack platform limits, the measured `Notes` analysis, unit economics |
| [`Assumptions.md`](./Approach/Assumptions.md) | Every assumption as *question I'd have asked → assumption taken → what it changed*, plus what's still open |
| [`Decisions.md`](./Approach/Decisions.md) | 37 decisions, including two superseded and one deferred — kept in full, because the revisions are part of the reasoning |
| [`Tradeoffs.md`](./Approach/Tradeoffs.md) | What each decision cost, what to watch after it ships, and what would reverse it |
