# APPROACH

> **Status: built, deployed, and in use.** This document is the design of record — what I
> built, why, and what each choice cost. Live URLs and workspace access are in
> [Getting In](#getting-in).
>
> Everything here is a summary of a working record kept as I went. If you want the raw
> reasoning — every fact I verified, every assumption I took, every decision and its
> price — it is in [`Approach/`](./Approach/), and the last section of this document is a
> map of it.

---

## What I built, and why

A brand's catalog spreadsheet has a column called **Shot Idea**. Someone has written
`morning kitchen counter` next to a stoneware mug, and `draped over a reading chair` next
to a woven throw. Today those sentences wait months for a photographer. This turns them
into styled product photographs, reviewed and signed off by the people who already work
here, in the place they already work.

**The product is a Slack app with one web page hanging off it.** Almost everything happens
in Slack. The single exception is a page where a product's candidate photographs are shown
side by side — and that page is *linked to*, never navigated to.

That split is the most important decision in the build, and I got it wrong the first time,
so it is worth explaining properly.

### Why Slack, and why not a dashboard

Maya's team told me exactly what they had already rejected:

> *"Last quarter they trialed a creative-automation tool with a beautiful dashboard.
> Nobody logged in after week one."*

And Ellie set her own constraint:

> *"it has to work from my phone, and I don't want to install anything new."*

The dashboard did not fail because it was ugly. **It failed because it required pull** —
somebody had to remember to go there, every day, forever. Slack is push. It arrives where
the team already is, and, critically, it is where the decision already happens today: step
5 of their current process is literally *"Ellie forwards her favorites into Slack for
opinions."*

So the design rule became: **the work comes to Ellie, and nothing new gets installed.**

I originally read a stronger rule into that — *no web page at all, not even for approval* —
and designed the whole review flow as Slack messages with Approve and Discard buttons on
them. That was wrong, and the build proved it. The distinction that actually matters is
push versus pull, not Slack versus browser. **A link that arrives inside the message
telling you your photographs are ready is still push.** The notification does the
remembering; the person does not. Nothing is installed, nothing is logged into daily, and
the page cannot be found without Slack handing you the link.

What forced the change was the shape of the decision itself. **Approving shot 2 of 3 is a
comparison, not a verdict.** Slack renders three candidates as three separate file uploads
you scroll between; you cannot see them together, which is precisely what you need to
choose between them. The page shows a product's shots side by side. That is the whole
reason it exists, and it is why the page is a *review surface* rather than a dashboard: it
has one job, it is reached from a notification, and nobody is expected to visit it on a
Tuesday to see how things are going.

The prediction I made when I first considered and rejected this design held exactly: the
expensive half of the system — pipeline, storage, prompt translation, ingest — moved over
untouched. What I got wrong was calling Slack identity *free*. It was free right up until
deciding left Slack, and then it cost a magic link, a session and an access list. About a
day's work, fairly spent, but a real cost hidden inside a choice I had described as costless.

### The loop, end to end

1. **Upload.** `/luma upload` opens a modal; drop the CSV in. It never touches the review
   channel, so a file somebody is still fiddling with is not everybody's business.
2. **Recap.** The system reads and validates the file, then shows — *in the same modal* —
   exactly what it would make and what it would cost: *"40 products, 16 with shot ideas, 24
   without, 48 photographs, about $5.12."* **Nothing has been spent.** The modal's own
   submit button is Generate, so the estimate and the decision are the same screen.
3. **Generate.** Each shot idea becomes three *distinct* prompts via Claude, each rendered
   against that product's own white-background photo. Rows with a blank Shot Idea are not
   invented for — their original photo passes through untouched, and free.
4. **Review.** The channel gets one line per product; that product's three candidates are
   posted into its thread; the line links to the overview page anchored at that product,
   and the page links back to the thread. Comparing happens on the page. *"No, too staged"*
   happens in the thread, under the photograph it is about.
5. **Reshoot, if none of them are right.** *Ask for another* takes a prompt you write
   yourself and makes exactly one more. It is appended, never substituted.
6. **Confirm.** When every photograph has a yes or a no, a confirm panel appears on the
   page. It takes two taps and freezes the batch permanently.
7. **Deliver.** The zip arrives attached to the confirmation message, with no command to
   run. Every file named `HG-002_morning-kitchen_01.jpg`. Nobody has to ask Slack which
   files are final.

### What this actually fixes

The brief describes seven steps. The visible bottleneck is steps 3–4 — the photographer,
the months of waiting — and that is what everyone notices.

**But both of the named disasters live in steps 5–7:** the pick that ends up living
"wherever the conversation happened", and the wrong `IMG_43xx.jpg` that shipped to a
product page and sat there for three weeks before anyone noticed.

Generation is the impressive part. **The handoff is where the damage occurs.** This design
targets both, and treats the second as the harder problem, because it is.

---

## Key decisions and tradeoffs

These are grouped by what they are protecting rather than listed in the order I made them.
Every one has a cost, and the costs are stated.

### A. What must never break

Four rules that the rest of the system is arranged around. They are not features; they are
the reason the features are shaped the way they are.

#### The photograph that ships is byte-identical to the one that was approved

No re-render, no upscale, no re-encode, no regeneration at a higher tier. Ever.

This killed a genuinely tempting optimisation: *draft on the cheap model, re-render the
winner on the expensive one.* That is broken, and not subtly. **Re-running a prompt on a
better model produces a different picture, not a sharper one.** It would ship something
Ellie never saw and call it approved — a more sophisticated version of the exact bug the
brief describes. So everything is generated at `uni-1-max` from the start, and what ships
is the file that was looked at. It is assertable by checksum, and it is asserted.

**Cost:** every candidate is generated at the expensive tier, including the two-thirds that
get discarded. That is 10.3 cents instead of 4.3 for photographs nobody will use. At the
volumes in play — see [Unit economics](#unit-economics) — buying the guarantee outright is
obviously worth it. At ten times the catalog it is still under a thousand dollars.

#### Decision state is membership, not a column

There is no `status` column on the images table. A photograph is approved because a row
exists in `approved_images`, and discarded because a row exists in `discarded_images`.
Retrieval is a join, never a filter on a mutable field.

This sounds like a preference and is not. **A status column is one bad `UPDATE` away from
silently changing what "approved" means for a photograph somebody already signed off.** A
membership table makes the wrong thing hard to express: you cannot accidentally overwrite a
decision, because decisions are rows, not values. Alongside it, `decision_events` is
append-only — it records every decision ever made, including the ones later superseded, so
*"who approved this and when"* survives everything.

**Cost:** more joins, and two tables to keep consistent instead of one field to set. The
consistency is enforced in one place (`recordDecision`) and covered by tests that assert a
photograph cannot be in both tables at once.

#### Batches are immutable once confirmed

No edits, no reversals. A correction is a **new batch**, not an amendment.

Every failure described in the brief comes from a mutable, ambiguous record — a Drive
folder edited by hand, a decision buried in a chat log, a wrong file that stood for three
weeks. An append-only history of frozen batches is the structural opposite of that.
*"What did we deliver in batch 3?"* has exactly one answer, permanently.

There is also a deliberate stance behind the strictness: **start strict and loosen on
evidence.** Rigidity is reversible. An affordance people have built habits around is not.
Making a post-delivery correction a deliberate act, rather than a quiet edit, also makes
its *frequency* visible — which is the number you would actually want before deciding to
loosen anything.

**Cost:** a genuine mistake caught after confirmation is annoying to fix. That is the
intended trade, but it is a real one, and it is the first thing I would revisit with usage
data in hand.

#### A discarded photograph is never deleted, and never reachable

Storage is cents. More importantly, retention is the *only* recovery path for a
post-delivery error, given that batches are frozen. `discarded_images` is not a wastebasket
— **it is the recovery ledger.**

The invariant that comes with it is the sharp half: **a discarded photograph must never be
reachable through any handoff path.** An engineer must be able to find one. The product
must never hand one out. Otherwise we have rebuilt the wrong-file bug inside our own
system, with better tooling to do it faster. The zip, the approved-catalog CSV and every
retrieval path read through the delivered pointer, which only ever advances on a human
confirmation.

### B. Deciding, and getting unstuck

The review flow is where a system like this quietly fails: not by breaking, but by leaving
somebody unable to finish.

#### Every photograph gets a yes or a no — and a failure counts as neither

The completion rule is that nothing ships until every candidate has been decided. At 120
photographs that is a genuine guarantee: no set can go out containing something nobody
looked at.

The trap is what happens when a photograph **never arrives** — the model refuses the
prompt, or a download fails. It cannot be approved, because there is nothing to approve. If
it also cannot be settled, the batch is stuck forever. That is exactly what happened during
end-to-end testing, and the cause was subtler than the missing buttons: the page and the
confirm endpoint were *counting different things*. The endpoint excluded failures; the page
did not. So the button was refused by the page for a batch the server would happily have
accepted.

Now: failures are excluded from the completion count by the same function everywhere, and a
failed photograph carries two controls — **Discard**, which settles it as it stands, and
**Try again**, which resets it and puts *the same row* back in the queue. The same row, not
a new one, because the shot that is missing is that one; asking for a different shot is a
different act.

#### A reshoot appends; it never replaces

*Ask for another* generates **one** photograph from **exactly** the words you type, and adds
it to the product alongside the existing candidates.

Three deliberate differences from the batch path, each with a reason:

| | Batch | Reshoot |
|---|---|---|
| How many | 3 | **1** |
| Prompt | written by Claude from the shot idea | **used verbatim** |
| Effect on existing shots | — | **none; appended** |

The batch makes three because nobody has said what they want yet, and variety is the answer
to that. By the time somebody is reshooting they have looked at three attempts and know
exactly what was wrong — making three more would be spending twice as much to throw two
away. The text is used as written because passing a considered instruction through a model
that rewrites it is the one thing guaranteed to lose what made it considered. And it is
appended because a reshoot is a *new opinion about a shot*, not a correction of the record:
the photograph it was asked from stays exactly where it was, decided or not. That is the
same rule as byte-identity, applied to a different surface.

**Cost:** nothing caps how many times a shot can be re-asked, at 10.3 cents a time. The
only friction is that each one is typed by hand by somebody looking at the result — real
friction, but not a budget. A ceiling is in [Next](#next-in-priority-order).

#### Two credentials, answering two different questions

Reading the overview page needs nothing but the link. Acting on it needs a session.

| Credential | Question it answers |
|---|---|
| Review token, in the URL | *Which batch may you look at?* |
| Session cookie | *May you act on anything at all?* |

Keeping them separate is what makes the link safely shareable: forwarding it shares
reading and never writing. `/luma signin` issues a single-use magic link, good for ten
minutes, which trades for a 24-hour cookie.

The detail that matters most: **write access is re-checked on every write, not stamped into
the session at sign-in.** A capability baked in at login would outlive a revocation by up to
a day. Removing somebody should take effect on their next click, which means the check
belongs on the write.

**Cost:** a sign-in step that did not exist when everything was in Slack, and a second list
of who may act that can drift from Slack's own membership. Both are noted in
[`Tradeoffs.md`](./Approach/Tradeoffs.md) as T13.

### C. Spending money

#### Show the bill before spending it

Maya's fear — *"don't burn our budget on stuff she'll reject"* — is real, and anchored on
photographer economics. The actual number for a 40-product drop is **$12.36.**

I initially argued against building a pre-spend gate: half a build-day to save thirty
dollars is a bad trade. **That was wrong, for the right reason.** The gate costs almost
nothing, because it is validation you have to do anyway with a button attached. And it
answers her in a way the economics cannot: *the numbers prove the fear is unfounded, but a
proof is not a reassurance.* Seeing the bill is.

The recap now lives inside the upload modal rather than in the channel, and Generate is the
modal's own submit button — so you cannot press it without the estimate in front of you.
Because the recap became private to whoever uploaded, the **cost is announced publicly when
the batch starts**: the upload is one person's business, the spend is the team's.

#### The `Notes` column is ignored — and that was measured, not assumed

Notes look valuable. *"El: smoke glass photographs badly, careful"* is Ellie's taste written
down in advance. So I checked what feeding them into prompts would actually do, across the
16 rows that generate:

| Outcome | Rows |
|---|---|
| Prompt improved | 1–2 |
| No effect (scheduling notes, priority flags) | 4 |
| **Prompt corrupted** | **3** |

`HG-011` is a *Woven Throw Blanket*, shot idea `draped over a reading chair`, note
`El: shoot with the mugs maybe`. Fed to a generator, that plausibly produces **mugs in a
blanket photograph.**

**Raw Notes corrupt roughly twice as many rows as they improve.** They are not junk — they
are four different kinds of instruction that only a human currently tells apart. The rule
instead: **if it needs to be in the shot, it goes in Shot Idea.** That is a contract the
team can follow, and it costs them nothing they were not already doing.

#### The prompt is editable — but only its opinion half

`/luma system-prompt` shows the wording that turns a shot idea into three prompts, and lets
anyone who can approve photographs change it. Saving an empty box reverts to the built-in.

The system prompt has two halves, and only one is editable:

| Half | Where it comes from | Editable |
|---|---|---|
| Brand block — palette, materials, the team's own shot-idea phrasing | Read from the uploaded catalog, per batch | No |
| Direction — the job, and the rules | Written by us | **Yes** |

Letting an override replace the whole prompt would have been less code and strictly worse:
every edit would silently discard the catalog-derived identity, which is the thing making
the output look like *this* brand rather than stock. So the two are composed, and the modal
edits the second while saying plainly what sits above it.

**Cost, and it is a real one:** nothing records *which* wording produced a given
photograph. "Why does batch 7 look like that?" is now a question the system cannot answer.
That is the debt shipping this created, and it is first in [Next](#next-in-priority-order).

#### Delivery is pushed, not requested

Confirming a batch posts the confirmation, pins it, and attaches the approved-catalog CSV
and the zip to that message. There is no export command.

The handoff *is* the moment the web person needs the files. A command they have to know
exists and remember to run is a step at precisely the point where the old process lost
things — step 7 of the brief is somebody not trusting a folder and asking Slack which files
are final. Making delivery something you *ask for* rebuilds a small version of that.

**Cost:** there is now one route to the files where there were two. If the upload fails,
nobody can ask for it again — the failure says outright that the photographs are still
stored and still on the page, so nothing is *lost*, but recovery is a hand operation. It
also ties the zip's lifetime to Slack's file retention. A download on the overview page
would be a better second route than the command was, and is the obvious fix if it ever
matters.

### D. How it is built to survive

These are engineering decisions rather than product ones, but two of them changed the
product's behaviour enough to belong here.

#### State lives in the database, and the worker resumes

Generation is a fire-and-forget async job on Luma's side: you submit, you get an id, you
poll. The naive shape is to do all of that inside the request that pressed Generate. That
works until the process restarts, at which point a batch is stranded with no record that
anything is outstanding.

So every photograph has a job row and a state — `pending_submit → submitted → completed →
stored → posted`, plus a shorter `pending_fetch → stored → posted` for the free
pass-throughs — and a worker loop claims work by scanning for rows in non-terminal states.
**One committed transaction per transition.** A deferred task dies with its process; a
batch sitting in the database does not. This is also what makes the ready-for-review
announcement survive a deploy mid-batch.

One consequence worth naming: photographs are posted **per product, once all of that
product's candidates have settled** — where "settled" means stored *or* failed, so one
refused candidate cannot hold its two siblings hostage. An earlier version claimed the
work in order but posted on completion, which scattered a product's shots randomly through
the channel and made the stream unreviewable.

#### One substitution seam, and never a fake database

There is exactly one place where the real world is swapped out: the composition root, where
Luma, Slack, the object store and the prompt writer are replaced together. Tests drive the
real HTTP app through real routes. **The database is never faked** — tests run against
PGlite, which is genuinely Postgres in-process.

That last rule paid for itself. A bug where a "transaction" ran its begin, body and commit
on three different pooled connections — leaving connections idle-in-transaction and
providing no atomicity whatsoever — was invisible to a fake and invisible to PGlite too,
because PGlite is single-connection. It was caught by a test with a *connection-recording*
fake, written specifically because the seam made it obvious which collaborator was
unexamined.

The general lesson, which cost me twice: **a fake faithful on the dimension you are thinking
about and silent on the one you are not will pass, and then break in production.** The same
shape caused a poll loop to stop early, because every generator fake completed on the first
call.

---

## The road not taken

Three designs were specified and rejected. The strongest is the one I later partially
adopted, which is its own kind of answer.

### A full mobile web app holding the approvals

Slack pushes a magic link; Ellie opens a phone-shaped page and swipes; shared auto-saved
state means anyone can see what is approved without asking her.

**Its real advantages:** a purpose-built review view — filter to pending, compare candidates
side by side, no scroll archaeology at 120 photographs. A canonical, linkable "what is
final" page. No Block Kit ceilings. Honestly, **a better review experience.**

**Why it lost at the time:** it rested on an interpretation of Ellie's words I could not
check. It meant building an auth system Slack gives away. And it meant two surfaces inside a
one-day budget — likely two shallow things instead of one that works.

**What actually happened:** I built the half of it that earns its keep. The page exists and
holds every write, but it is a review surface reached from a notification, not an app you
log into. The auth system did have to be built, exactly as predicted. The parts I did not
build — swipe interactions, a standalone "what is final" destination — are still not built,
and I do not think they are missed.

### Also considered and rejected

- **One batch-parent message with every photograph in its thread.** Solves tidiness *and*
  the notification flood structurally. Killed by one fact: **Slack threading is
  single-level.** Put the photographs in the thread and per-photograph discussion has
  nowhere left to go, pushing the team back to channel-level replies or DMs — which is
  today's failure. The per-product compromise keeps one thread per product, which is the
  grain the conversation actually has.
- **A login-gated dashboard.** Rejected on evidence, not taste: it is the tool they already
  abandoned.

---

## Scope ledger

### In

| Item | Reasoning |
|---|---|
| CSV ingest via slash command + modal | Keeps ingest off the review stream; stays inside Slack |
| Validate → recap → Generate, all in one modal | The budget answer, and what makes it safe to aim at 300 rows |
| Generation pipeline with a resumable job table | The product, and the part that must survive a restart |
| One channel line per product, photographs in its thread | Keeps the channel scannable; keeps comments under the shot |
| Overview page: every candidate for a product side by side | Where approving and discarding actually happen |
| Magic-link sign-in, 24h sessions, an access list | The price of moving decisions off Slack |
| Filters on the page, including retried and failed | Finding what still needs you is most of the work at 120 photographs |
| Reshoot, and retry for photographs that never arrived | Without these, three bad candidates or one failure strands a batch |
| Editable system prompt | The team maintains its own look without a redeploy |
| Auto-completion + two-tap confirm | Turns "12 approved" into "we're finished" — the thing nobody can answer today |
| Zip and CSV delivered with the confirmation | The web person's entire job; it should not need asking for |
| Deterministic filenames end-to-end | The direct fix for the named disaster |
| Two CSV exports (generated, approved) | The only artefact that repairs the source spreadsheet |
| One-off try-outs (`/luma generate`) | Testing an idea before committing it to the catalog, without touching a batch |

### Out

| Item | Reasoning |
|---|---|
| Publishing to the product page | No site access, and the brief never describes how publishing works. The last mile stays human. |
| Writing to Google Drive | **The folder is the bug, not the goal.** No naming, no index, no way to tell shipped from unshipped — and step 7 admits the web person already doesn't trust it. Writing to it creates a *second* place claiming to know what's final, inside a system whose defining problem is disagreement about what's final. Kept in the architecture as a write-only mirror; not built. |
| Multi-product grouped shots | `El: shoot with the mugs maybe`, `bathroom set w/ the towels?` — **Ellie has already asked for something this can't do.** Needs multiple sources composited into one scene, and a grouping concept the CSV has no column for. Named rather than half-built. |
| LLM-authored shot ideas | Cut on time. See *Next* — it's the highest-value item there. |
| Prompt versioning per photograph | The editable system prompt shipped without it. Nothing records *which* wording a given photograph was made from. |
| A ceiling on reshoots and one-offs | Nothing caps either, and one-off spend appears in no report. Hand-typed one at a time is real friction, but it is not a budget. |
| Cleaning up one-off source uploads | Every `/luma generate` leaves its source photo in the bucket forever. Invisible at this volume; a lifecycle rule on the `scratch/` prefix is one line when it matters, which is partly why that prefix exists. |
| Multi-format output (social / banner ratios) | Competes with creative variety for the same three candidate slots. Variety wins; formats are addable later. |

### Next, in priority order

1. **Prompt versioning on every photograph.** Making the system prompt editable turned
   *"what wording produced this photograph?"* into a question the system cannot answer. The
   fix is to stamp the direction onto the batch at generation time. **This is the debt that
   shipping the editable prompt created**, and it comes first for that reason.
2. **LLM-proposed shot ideas for blank rows.** **v1 automates the photographer; it does not
   automate Ellie reconstructing the wishlist from the sheet, Slack scrollback and her
   inbox.** With 24 of 40 rows blank today, and the next drop likely emptier still, this is
   cut *by risk and sequencing, not by value.*
3. **Attention-side scaling** — bulk actions, auto-approving pass-throughs. Now the sharpest
   limit: the page made comparison cheap, which makes the *number* of comparisons the wall.
   See [What breaks first](#what-breaks-first-under-pressure).
4. **A spend ceiling, and one-off spend in the reports.** Both reshoots and one-offs are
   uncapped, and one-off spend is counted nowhere. Invisible at today's volume; the first
   sign of trouble would be a Luma bill nobody can attribute.
5. **A download on the overview page**, restoring a second route to the files now that the
   export command is gone — better than the command was, because it does not expire.
6. **A Drive write-only mirror**, if the team's habit proves immovable.

---

## Unit economics

Generation is `image_edit` on `uni-1-max` at **$0.1030/image**. Prompt translation is
`claude-opus-5` with a cached brand prefix, about **$0.011/product**.

| Scale | Images | Image cost | Prompts | **Total** | Approved | **$ / approved image** |
|---|---|---|---|---|---|---|
| One 40-product drop | 120 | $12.36 | $0.45 | **$12.81** | ~100 | **$0.128** |
| Full 300 catalog | 900 | $92.70 | $3.38 | **$96.07** | ~750 | **$0.128** |
| **10× catalog (3,000)** | 9,000 | $927.00 | $33.75 | **$960.75** | ~7,500 | **$0.128** |

**About 13 cents per approved photograph, flat at every scale.** The catalog as delivered —
16 shot ideas among 40 rows — costs **$5.12**, because the 24 blank rows pass through free.

**In minutes — measured, not estimated.** A generation takes **93 seconds** at the median
(135s worst), and Luma allows **three at a time** for this account: ten weight units at
three per image edit. That is the binding constraint, and it puts a 40-product drop at
roughly **25 minutes** of machine time for its 48 styled photographs. The 24 pass-throughs
cost nothing and finish immediately.

I had this wrong until there were logs to read. The earlier claim here was "about two
minutes, Slack's posting rate is the constraint" — an estimate that never survived contact
with the API. Slack is not close to binding; Luma's concurrent capacity is, by a factor of
about ten. See F14 and F16.

Against the current process — *"two or three times a year… weeks later, candidate shots
come back by email"* — twenty-five minutes is still not a percentage change.

**What changes at 10×: nothing, on cost.** It scales linearly and stays trivial. Time is a
different story: at three concurrent, 900 styled photographs is about eight hours of
wall-clock, and 9,000 is three and a half days. That is a queue to be managed rather than a
wait to be sat through, and it is the first thing that would need a raised capacity
allowance rather than better code.

---

## What breaks first under pressure

**Ellie does. Not the system.**

| Scale | Cost | Human review load |
|---|---|---|
| 40-product drop | $12.81 | 120 decisions ≈ **6 minutes** |
| Full 300 catalog | $96.07 | 900 decisions ≈ **45 minutes** |
| **10× catalog** | **$960.75** | **9,000 decisions ≈ 7.5 hours of continuous tapping** |

Every architectural choice here is cheap to scale — Postgres, object storage, a job table,
adaptive rate limiting against a sliding window. **What does not scale is the human in the
approval path.** The rule that every photograph gets a yes or a no is a *guarantee* at 120
photographs: no set can ship containing something nobody looked at. At 9,000 it is a full
working day of button-pressing.

Moving review onto the page changed the arithmetic without changing that conclusion. The
channel is now 3,000 lines rather than 9,000 messages, and comparing a product's shots is
one glance rather than three scrolls — so the cost *per decision* fell. The **number** of
decisions did not. A cheaper tap, 9,000 times, is still a working day. Arguably, making
comparison cheap brings that wall closer by removing the excuse not to look.

The mitigations that matter at 10× are all attention-side — bulk actions, sampling,
auto-approving pass-throughs, delegated rights. **Only the last is built** (`/luma access`,
so the day can be split across several people rather than resting on one). That divides the
wall; it does not move it. The rest is the honest ceiling of this design.

**Three things break before that:**

1. **Ellie mutes the channel.** Undetectable from our side, and it silently converts push
   back into pull — the exact failure of the tool they abandoned. *Watch for:*
   time-to-first-decision stretching. Assume the notification path broke before assuming
   she is busy. Partially mitigated now: the batch's opening message and its confirmation
   are both pinned, so the channel's pins are a standing record of what needs attention.
2. **A batch stalls on one un-actioned photograph.** Completion requires all of them.
   `/luma status` is the recovery, which is why it is near-essential rather than a
   reporting feature — and the overview page's filters make the stall visible at a glance,
   which is the cheaper half of the same fix.
3. **The first real drop CSV is rejected on structure.** Validation is strict by design.
   The mitigation is entirely in the error message: it must name what was expected, what
   was found, and what to change — because the reader is not an engineer, and a bad error
   at that moment reads as *"the product is broken."*

---

## Getting in

- **Live URL:** _TBD_
- **Slack workspace invite:** _TBD_

**Start here.** Open the **Luma Shots** app in Slack and read its **Home** tab — it is a
complete walkthrough, from setting up the channel to your first upload. `/luma help` lists
every command.

- **To try it:** `/luma upload`, and drop in a CSV with the same columns as
  [`data/catalog.csv`](./data/catalog.csv). The recap appears in the same modal and tells
  you exactly what it would make and what it would cost. Nothing is spent until you press
  Generate.
- **To decide on anything:** `/luma signin` gives you a link that lasts a day. Reading the
  overview page needs nothing at all.

---

## The reasoning trail

Everything above is a summary. The working record, written as I went, is in
[`Approach/`](./Approach/):

| File | What is in it |
|---|---|
| [`Facts.md`](./Approach/Facts.md) | Everything verified — data quirks, Luma pricing and failure taxonomy, Slack platform limits, the measured `Notes` analysis, unit economics |
| [`Assumptions.md`](./Approach/Assumptions.md) | Every assumption as *question I would have asked → assumption taken → what it changed*, plus what is still open |
| [`Decisions.md`](./Approach/Decisions.md) | 51 decisions, including the superseded ones — kept in full, because the revisions are part of the reasoning |
| [`Tradeoffs.md`](./Approach/Tradeoffs.md) | What each decision cost, what to watch after it ships, and what would reverse it |
| [`Research-html-review-surface.md`](./Approach/Research-html-review-surface.md) | Background research on the review-surface pivot, against primary sources |

Issues and specs are in [`.scratch/styled-shot-pipeline/`](./.scratch/styled-shot-pipeline/).
