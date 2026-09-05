# Tradeoffs

What each decision costs. Every entry in `Decisions.md` should have a partner here naming
what we gave up, what we'd watch for after it ships, and what would make us reverse it.

This is the raw material for the deliverable `APPROACH.md` sections
"Key decisions and tradeoffs", "The road not taken", and "What breaks first under pressure."

Format per entry: **the decision**, **what we traded away**, **the strongest case against**,
**the signal that would make us reverse it**.

---

*(Round 1 in progress — no tradeoffs recorded yet.)*
## ~~T1 — Cost of D1 (Slack-triggered pipeline, approvals in a web app)~~ SUPERSEDED

> **Status: SUPERSEDED by T2** (Round 1, Q1 revision). Retained because T1.2 (two surfaces
> in one day) and T1.5 (`Confirm` irreversibility) were among the reasons D1 was abandoned,
> and because D1 is now the named pivot target if D2 proves too messy.

### T1.1 — Approval leaves Slack, so a little "pull" comes back

**Traded away:** the tap-to-approve-without-leaving-the-thread property of Slack-native
approval. Ellie must open a link to act.

**Strongest case against:** the diagnosis of why the last tool failed (F3.5, A0.2) is that
it required *pull* — someone had to remember to go there. Routing approval into a separate
web surface re-introduces a step in that direction. It is a much weaker form of pull than a
login dashboard — the link is pushed to her, arrives as a phone notification, needs no
install and no password — but it is not zero, and the honest version of this tradeoff
admits that.

**Mitigation to build in:** the Slack message must carry image thumbnails and the product
name, so opening the link is a *continuation* of something already begun, not a context
switch into an unknown. If the Slack post is a bare "3 shots ready — click here," we have
built a notification email and inherited its open rate.

**Signal that would reverse it:** if in testing the round-trip Slack→link→decide takes more
than a few seconds on mobile, move the simple accept/reject into Block Kit buttons and
demote the web app to a compare-and-manage view.

---

### T1.2 — Two surfaces to build inside one working day

**Traded away:** depth. A Slack app (OAuth, bot token, slash commands, message posting) and
a mobile web app (auth, state, image review UI) are two integrations, and per the original
estimate the Slack half alone could consume a third of the day.

**Strongest case against:** shipping two shallow surfaces is worse than one that genuinely
works, and the README is explicit that it wants "real, working software — not a prototype."

**Sequencing that protects this:** the web app is load-bearing and must be complete; the
Slack side degrades gracefully — notification-only is a viable v1 if slash commands run out
of runway. **Slash commands are the first thing to cut, and they should be cut by value,
not discovered missing at the deadline.**

---

### T1.3 — Auto-saved shared state is a real engineering cost

**Traded away:** the simplicity of a stateless page. D1.3 requires that a second viewer sees
approvals and discards as they happen, which means server-held state plus either polling or
a live channel, and a concurrency answer for two people acting on the same image at once.

**What to watch after it ships:** two approvers racing on the same batch. Last-write-wins is
probably acceptable at six people, but it should be a *chosen* answer written down, not an
accident of implementation.

---

### T1.4 — Permissions invite scope creep

**Traded away:** simplicity, in exchange for the property A0.3 demands (nobody is
gatekept). D1.4's staging — hardcode first, Slack command later — is the right shape,
because a role model is exactly the kind of feature that quietly grows a settings page.

**Strongest case against:** at six people, an allowlist of email addresses in config may be
the *permanently* correct answer, and the Slack command to manage it may be ceremony. Worth
revisiting when we price it.

---

### T1.5 — `Confirm` closing a stage is irreversible by design

**Traded away:** reversibility. The value of Confirm (D1.5) is that it produces a fact the
web person can trust — "this batch is final." That value comes precisely from it being
hard to change. But their current process has no undo either, and their named disaster
(F3.4) went unnoticed for three weeks, which means **the failure mode here is a confident
wrong answer, not a missing one.**

**Open:** who is allowed to press Confirm, and what happens when a confirmed batch turns out
to be wrong. Deferred to a later round — see `Assumptions.md` OQ-1 and OQ-2.

---

## Road not taken (from Q1)

**Slack-native approval as the primary surface** — Block Kit buttons in a public channel,
with no web app for the accept/reject path. This was my recommendation and it was overruled
for a good reason (state), but it remains the strongest rejected alternative for this
decision. Its advantages, preserved here for `APPROACH.md`:

- Zero context switches: the decision happens in the same app the notification arrived in.
- The approval *is* the broadcast — Maya's transparency need (F3.7d) is satisfied by the
  same act, with no second surface to build or keep in sync.
- Approvals land where they already land today (brief step 5), so adoption asks for no new
  behaviour at all.

**Why it lost:** Slack can capture a decision but cannot *hold* one. Today's core failure is
that the pick lives wherever the conversation happened. Buttons in a thread would have made
the decision faster without making it findable.

**Login-gated dashboard** — rejected outright, not on merit but on evidence: it is the tool
they already abandoned after one week (F3.5).

---

## T2 — Cost of D2 (all-in-Slack)

### T2.1 — Messiness, accepted knowingly

**Traded away:** control of the review surface. 40 products × 3 candidates is **120 images
in a channel**. Slack gives us no filtering, no sorting, no "show me only what's undecided,"
and no way to lay three candidates side by side. Scrolling is the only navigation.

**Strongest case against:** review quality degrades with volume in a way it wouldn't in a
purpose-built view, and it degrades *worst* exactly when the system is most valuable —
during the 40-product drop that is the first real test (F3.7).

**Why it's still the right call:** the failure is cheap, fast, and obvious. If the channel
is unusable, everyone knows within one batch. The pivot target (D1) is already fully
specified, and the expensive half of D2 — generation pipeline, storage, prompt translation,
CSV ingest — is surface-agnostic and survives the pivot intact. **We are risking the thin
layer, not the thick one.**

**Signal that would reverse it:** Ellie stops mid-batch, or asks "which ones haven't I done
yet," or starts making decisions in DMs instead of the channel.

**Mitigations to build in (cheap, and they do most of the work):**
- **Update the message in place on decision (F4.3)** so scrollback shows *outcomes*, not a
  wall of undifferentiated candidates. An approved post should visibly read ✅.
- **One parent message per product, candidates in its thread.** Collapses the channel from
  120 images to 40 lines. This is the single biggest lever against messiness.
- **A `/…status` command returning only what is still pending.** Converts "scroll to find"
  into "ask and receive," which is the actual antidote — and it doubles as Maya's
  self-serve status view (F3.7d), so one command serves both people.

---

### T2.2 — Slack has no side-by-side comparison

**Traded away:** the ability to see three candidates at once. Slack stacks image blocks
vertically; on a phone that is three scroll-lengths.

**Why it matters:** the decision Ellie is making is *comparative* — "that one," "no, too
staged" (brief step 5). We are asking her to make a comparative judgement through a
sequential interface.

**Cheap mitigation:** compose the candidates into a **single contact-sheet image** (a 1×3 or
2×2 grid) posted as one image, with the individual full-resolution images in the thread. She
compares on the grid, approves by index. This is image compositing we do ourselves, costs no
API credits, and converts the comparison from sequential back to parallel.

---

### T2.3 — The channel must not become the system of record

**Traded away:** nothing, if D2.6 holds. Everything, if it doesn't.

**Strongest case against the naive version:** today's defining failure is that *"the pick
lives wherever the conversation happened"* (brief step 5, F3.3). A design where approval
state is inferred from Slack messages **rebuilds that failure with better graphics.** Add
F4.6 (free-tier history limits) and the record can literally age out.

**The discipline this imposes:** the bot owns a database keyed by SKU + generation ID.
Slack renders it. `/…status` and `/…export` read from the database, never from scrollback.
If Slack were deleted tomorrow, we would lose the interface and keep every decision.

---

### T2.4 — Restricting posting suppresses the discussion that currently has value

**Traded away:** step 5 of their existing process. Today Ellie *"forwards her favorites into
Slack for opinions"* and the team responds — "that one," "no, too staged." A
posting-restricted channel is tidy precisely because it prevents that.

**The tension:** D2.1 restricts posting to keep the review surface scrollable; the brief
says the surface's current value is partly that people talk in it. Tidiness and discussion
are directly opposed here.

**Likely resolution:** allow thread replies while restricting top-level posts, so discussion
attaches to the product it concerns instead of scrolling the channel. Needs verification
(F4.5) and a decision — see OQ-5.

---

### T2.5 — Slack's ceilings become product constraints

**Traded away:** freedom in how much we show. F4.1 caps a message at 50 blocks, so batch
size is bounded by the platform, not by taste. D2.5 leaves the row-limit-vs-batching choice
open pending testing, which is reasonable — but note that **at 300 rows the "just cap the
CSV" option stops being a size guard and becomes a product decision about what gets
generated at all.** That question belongs to CSV ingest (Q4) and selection (Q5), not to
message formatting.

---

## Road not taken — REVISED

The previously-recorded road not taken (Slack-native approval) is now **the road taken**.
The rejected alternative is now:

**Slack-triggered pipeline with a mobile web approval app (D1).** Its real advantages,
preserved for `APPROACH.md`:

- A purpose-built review view: filter to pending, compare candidates side by side, no scroll
  archaeology at 120 images.
- Durable, linkable state with a canonical "what is final" page — no risk of the record
  living in a chat log.
- Not bounded by Block Kit's 50-block ceiling or by Slack's layout.

**Why it lost:** it needed Ellie to open a link, which rested on a reading of her constraint
we cannot verify (retired A2.1); it required building an auth system that Slack gives away
free (F4.2); and it meant two surfaces inside a one-day budget (T1.2).

**It remains the named pivot target.** If T2.1 materialises, the generation pipeline,
storage, prompt translation and CSV ingest all survive the move unchanged — only the
presentation layer is rebuilt.

---

## T3 — Cost of D3 (flat, one message per image)

### T3.1 — 120 messages, and the stream is the queue

**Traded away:** the 3× channel-length reduction threads would have given.

**Why it is survivable:** with in-place updates (F4.3), a decided message visibly becomes
✅ or ❌, so **the stream reads as a work queue rather than an archive.** Ellie works
top-to-bottom; what's behind her is settled, what's ahead is pending. `/status` (D3.5) is
the recovery mechanism for when she doesn't finish in one sitting.

**Watch for:** whether in-place updating actually happens on every decision path. If a
decided message still looks undecided, the flat design collapses immediately — the stream
becomes an undifferentiated wall and there is no cheap way to navigate it. **In-place update
is not a polish item here; it is what makes D3 viable.**

---

### T3.2 — Comparison is sequential

**Traded away:** side-by-side comparison, which the contact sheet would have restored.
Ellie's judgement is comparative ("that one," "no, too staged") and she is now making it by
scrolling between adjacent messages.

**Partial mitigation, free:** ensure a product's candidates are **adjacent and ordered** in
the stream (see T3.3), so comparison is at least a short scroll rather than a search.

**Reversible cheaply:** if comparison proves hard, a contact-sheet message can be added
*above* each product's candidates without changing the data model. Unlike threading, this is
additive.

---

### T3.3 — Posting order becomes an engineering requirement

**The constraint:** generations complete asynchronously and out of order (F2.1). If we post
each image as it completes, a product's three candidates end up scattered through the
stream, interleaved with other products — and D3's entire usability argument depends on
adjacency.

**What this forces:** buffer per product, post its candidates together and in index order.
Meaning **posting is a separate paced stage from generation**, not a completion callback.
Combined with F4.8 (~1 msg/sec), posting a full drop is a ~2-minute background job.

---

### T3.4 — Notification flood — the sharpest un-mitigated risk

**The problem:** F4.9 — Slack has no sender-side silent post. Posting 120 messages into a
channel where a member has "All new messages" enabled produces **120 phone notifications**.

**Why this is serious and not cosmetic:** the single thing this design cannot survive is
Ellie muting the channel. If she mutes it, every push property that justified D2 over D1
evaporates, and we are left with a *worse* pull surface than the web app we rejected — one
she has to remember to visit, with no filtering. **A notification flood is the most likely
route to reproducing the exact failure of the tool they abandoned.**

**Proposed mitigation (recorded as a default, open to objection):** set the channel's
default notification preference to mentions-only, post the candidate stream without
mentions, and follow it with **one summary message that @-mentions Ellie** — "40 products,
120 shots ready, none decided yet." One ping per batch instead of 120. `/status` then serves
as her re-entry point.

---

### T3.5 — `/status` output grows with the batch

At drop scale `/status` returns 120 lines. Readable, but not pleasant. Filtering
(`/status pending`) is the obvious answer and is nearly free. Flagged rather than solved —
D3.6 defers the higher-level overview command, and this is the same question wearing a
different hat.

---

### T3.6 — Muting is the escape valve, and it is not free

Alexander's stated mitigation for the flood (T3.4) is that a member can simply mute the
channel. True, and reasonable — but the cost must be named.

**What muting costs:** it converts the channel from *push* to *pull*. A muted channel is one
Ellie has to remember to visit — which is precisely the behaviour that killed the tool they
abandoned (F3.5, A0.2), and precisely the property that justified choosing all-in-Slack (D2)
over a web app (D1) in the first place. **"She can mute it" and "it reaches her where she
already is" cannot both be load-bearing.**

**Why it is still survivable:** because the two can be reconciled *if* F4.12 holds. A muted
channel that still badges on @-mention gives us both properties at once:

- The 120 candidate messages post silently into a muted channel → no flood.
- **One batch-summary message @-mentions Ellie** → one ping, which still lands.
- `/status` (D3.5) is her re-entry point for anything unfinished.

**This makes F4.12 a day-one verification task, not a detail.** If a mute suppresses
mentions as well, we lose push entirely and need a different answer — most likely a DM to
Ellie from the bot (DMs notify regardless of channel mute), with the channel remaining the
shared record.

**The blind spot to record:** muting is a user-side action we cannot detect. We will not
know if Ellie has muted, and therefore will not know if the system has silently degraded to
pull. The observable proxy is latency — if time-to-first-decision on a batch starts
stretching, assume the notification path is broken before assuming she is busy.

---

## Road not taken — batch-parent message with images in its thread

**Considered and rejected at Round 1, Q1b.** *(Alexander's own alternative — recorded in
full because it is the closest runner-up to D3 and solves two of D3's three real problems.)*

**The design:** one message per batch posted to the channel — "40 products, 120 shots
ready" — with every candidate image message posted as a reply inside that single thread.

**What it solves, genuinely:**
- **Channel tidiness.** The channel gains one line per batch instead of 120 messages.
- **The notification flood (T3.4).** Per F4.11, thread replies notify only the parent author
  and thread participants; the bot is the parent author, so 120 posts notify nobody.
  This is a *structural* fix, where D3's answer (mute + @-mention) is a *configuration* fix
  that depends on unverified F4.12.

**Why it lost — one fact:** **Slack threading is single-level (F4.10).** If the images
occupy the thread, per-image discussion has nowhere to go. There is no second level to nest
into. The team would be forced back to top-level channel replies — losing the very tidiness
the design was chosen for — or into DMs, which reproduces today's core failure of decisions
living wherever the conversation happened (brief step 5).

**The judgement behind the rejection (D3.7):** Ellie is not a silo. The brief shows her
soliciting opinions before exercising her final word. A design that trades away the place
where "no, too staged" lands is buying tidiness with the collaboration that makes the
review meaningful. **Discussion beats tidiness; the flood is the accepted price.**

**A second, unstated cost of the rejected design:** a 120-message thread is *worse* to
navigate on mobile than a 120-message channel — thread views are narrower, don't support the
same jump-to-unread behaviour, and can't be scrolled past. It would have traded a scrolling
problem for a slightly worse scrolling problem in a smaller container.

**Would reverse it if:** F4.12 fails (mute kills mentions) *and* discussion volume in
practice turns out to be near-zero. Both would have to be true — either alone is not enough.

---

## T4 — Cost of D4/D5 (pipeline boundary, download-all, self-serve handoff)

### T4.1 — There are now TWO different meanings of "done", and they will collide

**The problem:** D4.1 defines pipeline-done as *generated, downloaded, stored*. The brief
(F3.2) defines request-done as *2–3 approved images, in the drive folder, on the product
page*. Both are legitimate. **Neither may be called "done" in anything a human reads.**

**Why this is not pedantry:** F1.1 established that the single thing nobody can answer today
is *which requests are done*. Shipping a `/status` that reports "done" while meaning "we
generated it" would reproduce the exact ambiguity the product exists to remove — and Maya,
whose entire ask is *"see where things stand without having to ask Ellie"* (F3.7d), is the
person most likely to misread it.

**Proposed vocabulary (recorded as a default, open to objection):**

| Stage | Word shown to humans | Means |
|---|---|---|
| Pipeline complete | `ready for review` | Generated, downloaded, stored, posted to Slack |
| Per image | `pending` / `approved` / `discarded` | Ellie's decision state (D3.5) |
| Request complete | `delivered` | Approved images have been exported for upload |

**"Done" is retired as a word.** It is the most overloaded token in this domain and it is
the one the customer already cannot answer.

---

### T4.2 — Download-all means storing images nobody wants. This is correct and cheap.

**Traded away:** storage efficiency. Roughly a third to two thirds of generated images will
be discarded, and we keep them all.

**The actual numbers.** Output is 2048px (F2.4); at JPEG that is ~0.5–1.5 MB per image.

| Scenario | Images | Storage |
|---|---|---|
| One 40-product drop × 3 candidates | 120 | ~60–180 MB |
| Full 300 catalog × 3 candidates | 900 | ~0.5–1.4 GB |

At object-storage rates this is cents per month. **The tradeoff is not close**, and D4.7
(hard-delete discarded images later) is correctly filed as non-urgent — it is housekeeping,
not cost control.

**The genuine cost is not storage, it is deletion risk.** Once discarded images are kept,
someone can retrieve one. If a discarded image can be fetched by the same commands that
fetch approved ones, we have rebuilt the wrong-`IMG_43xx` failure (F3.4) inside our own
system. **Discarded images must be unreachable through any handoff path** — retrievable only
by deliberate, separate action. That is a hard requirement, not a nicety.

---

### T4.3 — "A table, not a boolean" is the right instinct; an event log is the right shape

**Alexander's call (D4.6):** avoid a boolean flag on the image row; use a separate
`approvedImages` relation. The instinct — don't encode workflow state as a column you filter
on — is sound. Two problems with the literal version, and one refinement that fixes both:

1. **Three states, two tables' worth of information.** D3.5 requires
   *approved / pending / discarded*. An `approvedImages` table gives membership and
   non-membership — so "pending" and "discarded" become indistinguishable, which is exactly
   the distinction `/status` exists to show.
2. **No provenance.** F3.4's failure went unnoticed for three weeks with nobody able to say
   who chose what. D2.2/A2.3 introduce delegated approval rights, which makes *who decided*
   a real question rather than a theoretical one.

**Refinement: a `decisions` event log** — `(image_id, decision, actor_slack_id, decided_at)`.
Current state is the latest event per image; absence of any event is `pending`. This gives
all three states, full provenance for free, and **answers OQ-2 (undoing a decision) without
any extra mechanism** — a reversal is simply a later event, and the history of the reversal
survives. It is also still "query a table, not a boolean."

**Deferred to implementation as Alexander noted — but the shape is worth fixing now**,
because retrofitting provenance onto a membership table means losing every decision made
before the change.

---

### T4.4 — "Weekly" is ambiguous, and the wrong reading breaks the handoff

**The question D5.1 leaves open:** `getWeeklyFinalImages` filters on *which* timestamp?

- **Generation date** — wrong. Includes images generated this week but not yet approved, and
  excludes images generated last week and approved this week. The web person would receive
  un-approved files, which is the failure we are eliminating.
- **Approval date** — right. "What became final since I last uploaded" is the web person's
  actual question, and it maps onto their existing weekly rhythm (brief step 7).

**Recorded default: approval timestamp.** Note the pleasing consequence — a date-windowed
query solves A0.1 structurally. The reason the Drive folder cannot distinguish shipped from
unshipped is that it has no time axis; a query keyed on approval date has nothing else.

**Residual gap:** approvals landing *after* a pull are missed until the next window. Low
severity — a missed image ships next week, which is a delay, not the wrong-file error. But
worth naming rather than discovering.

---

### T4.5 — The date window may have quietly replaced `Confirm` (OQ-4)

D1.5 proposed a stage-closing `Confirm`, and I argued in Q2 that the web person needs
"this batch is done being decided" as distinct from "give me the files."

**D5.1 offers a different answer to the same problem: a time window instead of a gate.** The
web person asks "what was approved this week" and gets it; no one has to declare a batch
closed. This is arguably *better suited to this team* — it matches the weekly rhythm they
already have (brief step 7), requires no new ceremony, and cannot stall on someone
forgetting to press a button.

**What it gives up:** a definite "we have finished deciding this drop." For the 40-product
drop specifically — a launch with a date — someone may genuinely want to assert that. A
rolling window never asserts completeness, only recency.

**Recorded as resolved-by-substitution, flagged for confirmation.** If the window is the
answer, `Confirm` should be deleted from the design rather than left half-present.

---

### T4.6 — Drive as a descoped write-only mirror is defensible, but it must be honest in the ledger

D5.4/D5.5 keep Drive in the architecture and out of the build. That is a legitimate scope
call, and the reasoning is strong: **the mirror exists for human browsing and backwards
compatibility, never as an authority.** It also preserves a retreat path if the team's Drive
habit turns out to be immovable.

**The honesty requirement:** `APPROACH.md` must say the POC does not write to Drive, and must
say *why* — not merely list it under "next." The strongest version of the reasoning is that
**writing to Drive without the discipline of "never read as truth" would actively make
things worse**, by creating a second folder claiming authority alongside the first.

**What to watch after it ships:** whether anyone starts pulling from Drive instead of running
the command. That is the signal the mirror has become a source of truth by accident, which
is the failure mode the whole design is built to prevent.

---

## T5 — Cost of D6–D10

### T5.1 — Choosing quality over frugality, and the numbers that justify it

**The decision (D10.1):** `uni-1-max` at $0.1030/image rather than `uni-1` at $0.0434 —
**2.4× the unit cost**, deliberately.

**Alexander's reasoning:** *"$100 for a full 300-image catalog is not a budget that can kill
a company. If it is, we can simply swap out to uni-1."* Correct, and the numbers hold up:

| Scenario | `uni-1-max` | `uni-1` |
|---|---|---|
| One 40-product drop × 3 | $12.36 | $5.21 |
| Twelve monthly drops (a year) | $148.32 | $62.52 |
| One-time backfill of all 300 × 3 | $92.70 | $39.06 |
| **Year one, all in** | **~$241** | **~$102** |

**The $139 delta buys the integrity principle (D10.4).** Framed that way it is not close.
For comparison, this is a rounding error against a single freelance photographer engagement,
which is what it replaces.

**The second-order argument that matters more than the first:** at these prices the dominant
cost is not the API — it is **regeneration driven by rejection**. Every rejected batch costs
a round-trip of Ellie's attention, which is the genuinely scarce resource (A1.3). Buying
quality up front is cheaper even on pure economics, because it reduces the number of
attention round-trips.

**Watch for:** volume changing shape, not price. `uni-1-max` becomes worth revisiting if the
team starts generating 5–10 candidates per product rather than 3, or begins regenerating
aggressively — both multiply volume in a way the per-image price does not.

---

### T5.2 — Forced completeness (D8.3) trades Ellie's clicks for a guarantee

**Traded away:** bulk actions. A 120-image batch requires **120 individual decisions**
before anything can be retrieved. If Ellie wants only 40 of them, she presses Discard 80
times.

**Strongest case against:** this is real friction at exactly the moment the system is under
most load — the 40-product drop that is the first real test (F3.7). A tired reviewer
faced with 80 discards may start pressing Approve to make the list go away, which would be
worse than no guardrail at all.

**Why it is still right for now:** the rule is trivially explainable ("everything gets a
yes or a no"), has no edge cases, and the guarantee it buys is strong — **no set can ship
containing an image nobody looked at.** Complexity added later is cheap; a guarantee
retrofitted later is not.

**Signal that would reverse it:** batches sitting incomplete for days, or a visible cluster
of rapid identical actions in the decision log. **Note that D7.2's event log makes the
second signal detectable** — timestamps would show 80 discards in 40 seconds.

**The obvious future affordance:** a `discard remaining` command, deliberately deferred
(D8.5) rather than forgotten.

---

### T5.3 — The output CSV (D9) leaves three questions unanswered

1. **One column or three?** Three candidates per product, one appended column. Multiple URLs
   in a single cell is hostile in a spreadsheet; three columns is rigid if the candidate
   count ever changes. *Recommendation: one column per candidate, named by index, generated
   from the actual count.*
2. **What kind of URL?** Our storage must serve something durable. A signed URL with an
   expiry means the CSV rots in Maya's inbox — reproducing F2.3's problem one layer up. A
   permanent unguessable URL means anyone holding it can view the image forever.
   *Recommendation: permanent unguessable, since these are product photos destined for a
   public website — the confidentiality window is days, not years.*
3. **Is there a second CSV at `delivered`?** D9 emits at `ready for review`, so it records
   what was *generated*. Nobody has yet asked for a sheet recording what was *approved* —
   but F1.1 says the sheet's defining flaw is having nowhere to record outcomes, and this
   export is the natural place to fix that. *Flagged as OQ-11.*

---

### T5.4 — Batch-based retrieval replaces the team's weekly rhythm

**The change (D8.4):** the POC ships "get the latest batch," and weekly/monthly windows are
deferred. But brief step 7 says the web person uploads **roughly weekly**.

**What this actually does:** replaces a *calendar* cadence with an *event* cadence. The web
person stops asking "what's new this week" and starts responding to "batch complete."

**Why that is probably an improvement:** a batch is a meaningful unit — it corresponds to a
drop, a launch, a campaign — whereas a week is an arbitrary slice through work in progress.
It also composes with D8.2: a batch is retrievable exactly when it is finished, so there is
no window in which a partial set can be pulled.

**The residual risk:** if batches are large and infrequent (a 40-product drop, monthly), the
web person's weekly habit has nothing to feed it three weeks out of four. That is fine if
they adapt, and awkward if they don't. **Watch for:** the web person asking for a partial
pull before a batch completes — that is the signal D8.3's rigidity is biting the wrong
person.

---

### T5.5 — The integrity principle constrains the whole storage path

D10.4 is a product principle with sharp engineering teeth. To honour it:

- The image posted to Slack, the image in the store, and the image in the export zip must be
  **the same bytes** — no re-encoding to save space, no thumbnail substitution in the export,
  no format conversion.
- Any Slack-side image resizing is display-only and must never round-trip into storage.
- This is **assertable in a test** (checksum equality across the three paths), and it should
  be, because it is the kind of invariant that decays silently under later optimisation.

**What it costs:** rules out otherwise-sensible optimisations — storing a compressed variant,
serving WebP, generating thumbnails as the canonical asset. Cheap to accept now, expensive
to discover later.

---

## T6 — Cost of D11–D14

### T6.1 — Dual-write: two tables must move together

**The cost of D11:** approving writes to both `approvedImages` and the event log. If one
succeeds and the other fails, they diverge — and the divergence is silent.

**Mitigation:** wrap the pair in a transaction. Cheap and standard.

**Why the duplication is nonetheless safe:** the event log is the audit truth and
`approvedImages` is derived (D11.1), so the read model is **reconstructible by replay**. A
divergence is recoverable rather than fatal. This is the property that makes the pattern
worth its extra table — and it should be stated in `APPROACH.md`, because otherwise "we
store approvals twice" reads as an error rather than a design.

**What to watch:** whether anyone ever writes to `approvedImages` without logging the event.
That is the change that quietly converts a recoverable system into an unrecoverable one.

---

### T6.2 — Undo's blast radius is the real risk in D11.4

**The mechanism is clean; the cascade is not.** Deleting the `approvedImages` row is one
line. But approval may have side effects — the Drive push (D4.4), a future publish hook, an
already-downloaded export zip in someone's Slack. **Undo must reach all of them.**

**The failure this creates if incomplete:** an undone approval that leaves a file in Drive is
a stale wrong file, available for upload, with nobody aware. That is F3.4 *exactly*, rebuilt
by the mechanism intended to prevent it.

**Recorded as an invariant:** approval side effects must be enumerable and reversible, or
they must not exist. **Note this is another argument for D5.5** — not pushing to Drive in the
POC also means undo has nothing to chase.

**The genuinely unreachable case:** a zip already downloaded to someone's laptop cannot be
recalled. Undo can never be complete once files leave the system, which argues for undo
being *rare and early* rather than a routine affordance. Relevant to OQ-2.

---

### T6.3 — Three states, and the temptation to derive one of them

D11.2 rejects status-column filtering. But D3.5 needs three states, and only `approved` is
membership. Deriving `discarded` from the event log means "latest event per image" logic —
precisely the complexity D11 was chosen to avoid, reintroduced through the back door in
`/status`.

**Symmetric `discardedImages` avoids it entirely**: three states become three membership
checks, the completion check (D8.1) becomes two counts against a batch size without touching
the log, and the event log stays pure audit.

**What it costs:** a third table for what some would model as one column. Defensible here
because the column in question is exactly the one D11.2 rules out — and because the
completion check runs on every single button press, so keeping it a pair of counts rather
than a windowed aggregate is a real operational simplification at 120 images per batch.

---

### T6.4 — Two steps where a founder might expect one

**Traded away:** the drag-and-drop-and-magic demo. D14 makes the user upload, read a recap,
then press a button.

**Strongest case against:** it is more ceremony, and the video's most dramatic possible
moment — *drop CSV → images appear* — is given up.

**Why it wins anyway:** the two-step version demos nearly as well (*drop CSV → "40 rows, 16
shot ideas, 48 images, ≈$4.94" → one button → images appear*) and it is the version you
would actually be willing to point at 300 rows. **The recap is not friction; it is the
feature that makes the system safe to aim at a real catalog.** It is also the concrete thing
to show Maya when she asks about budget — a screenshot of the bill before it is incurred.

---

### T6.5 — Strict validation will reject a real customer's real file

D13.2 accepts only a conforming CSV. But F1's data is a human spreadsheet export, and the
brief is explicit: *"treat the file as what it is — a customer's data handoff, quirks
included."*

**The risk:** strictness that rejects the actual drop CSV next month over a renamed column
or a stray blank row, at which point the system's first real contact with production is a
refusal.

**The distinction that resolves it:** reject on *structure* (missing required columns, no
SKU, no photo URL); report-but-proceed on *content* (a blank shot idea, an odd price
format, a note nobody can parse). Structure is what makes the file unusable; content
quirks are the customer's normal. **The recap (D14.2) is the right place for everything in
the second category** — it tells them what is odd without refusing to work.

**What to watch:** the first ingest of next month's real drop. If it bounces, the guardrail
is calibrated wrong, and the failure will be read as the product being broken.

---

## T7 — Cost of D15–D18

### T7.1 — A manual gate can be forgotten

**Traded away:** the guarantee that a finished batch progresses. D15.2 makes a human
responsible for declaring completion, so a batch can sit fully-actioned and undelivered
because nobody pressed the button.

**Why it is still right:** the alternative — automatic side effects on last action — means
the Drive push fires the instant Ellie makes her 120th decision, with no chance to reconsider
and no window in which undo is cheap (T6.2). **Manual confirm is what buys the free-undo
window**, and that window is the mitigation for the design's sharpest irreversibility risk.

**Mitigations, both nearly free:** `/status` shows a batch as actioned-but-unconfirmed; the
confirm button is posted at the moment of auto-completion (D15), so it appears where she
already is rather than 120 messages up.

**Watch for:** batches sitting in actioned-but-unconfirmed. That is the specific state this
tradeoff creates, and the only one worth alerting on.

---

### T7.2 — Two completion concepts must not become two confusing statuses

D15 introduces `complete` (computed) alongside `delivered` (declared). Two states adjacent
in meaning and one letter apart in tone is a vocabulary hazard — and D6 exists precisely
because this domain has already been ruined once by an overloaded word.

**Recommended surface language, not internal names:**
`ready for review` → `reviewed — awaiting confirmation` → `delivered`.
The middle state should describe *what is needed next*, not *what has happened*. "Complete"
tells Ellie nothing; "awaiting your confirmation" tells her what to do.

---

### T7.3 — Rejecting LLM CSV repair trades tolerance for auditability

**Traded away:** the ability to accept a malformed file. A renamed column or a missing header
means rejection, where an LLM could have inferred intent.

**Why determinism wins here:** an LLM that silently restructures a customer's file introduces
an **unauditable transformation between what they sent and what we processed** — inside a
system whose entire purpose is eliminating "which file is the real one." The repair would
solve a small problem by reintroducing the category of the large one.

**What it costs in practice:** T6.5's risk stands — the first ingest of next month's real
drop may bounce. **D17.4's error-message quality is the whole mitigation**, which is why it
is written as a spec rather than left to taste.

---

### T7.4 — Deferring shot-idea proposals leaves the real bottleneck unsolved in v1

**The honest scope statement:** D18.1 automates the photographer. It does **not** automate
brief step 3 — Ellie reconstructing the wishlist from the sheet, Slack scrollback, and her
inbox. With 24 of 40 rows blank today (F1) and next month's drop likely arriving emptier
still (A1.2), **v1 accelerates the half of the process that was already possible and leaves
the half that stalls.**

**Why deferring is nonetheless defensible:**
- It is Maya's literal ask — *"make the shots people put in the sheet."*
- The system never spends money on an idea no human wrote, which is the strongest possible
  answer to *"don't burn our budget on stuff she'll reject."*
- It touches Ellie's creative judgement, the one thing she has never asked anyone to take.
  Getting adoption on the mechanical half first is the safer order.

**What must be said out loud in the scope ledger:** this is cut **by risk and sequencing,
not by value**. It is arguably the highest-value item in the "next" column, because the
bottleneck it addresses is the one that makes shot ideas accumulate at sixteen-per-several-
months across a 300-product catalog.

**The signal that it needs building:** the drop CSV arrives with most Shot Idea cells empty
and the recap reports "3 of 40 rows have shot ideas." At that moment v1 has almost nothing
to do, and the deferred feature becomes the product.

---

### T7.5 — Proposal review needs a surface, and Slack bounds it

If D18.3 is built, proposed shot ideas need human review before spending. Slack supports
this (see feasibility note in `Facts.md` F4.14), but with a ceiling:

- A modal with one pre-filled text input per blank row is editable and reviewable — **fine at
  24 rows, fine at 40, impossible at 300** (F4.1: 100 blocks per modal).
- The scale-safe alternative is coarser: post proposals as a list with a single
  *"accept all and generate"* button, and treat per-row editing as an escape hatch rather
  than the main path.

**Consequence:** the feature is naturally drop-shaped, not catalog-shaped. That is a
reasonable place to land — a 40-product drop is the stated use case (F3.7) — but it should
be a chosen boundary rather than a limit discovered at 300 rows.

---

## T8 — Cost of D19-revert, D20, D21

### T8.1 — Live writes trade audit purity for query simplicity

**The revert (D19):** membership tables are written during review, so `/status` reads plain
membership rather than deriving state from the log.

**What is given up:** the semantic cleanliness D19 briefly bought — `approvedImages` meaning
*"the record of what was delivered."* It now means *"what has been clicked so far,"* which
is a weaker guarantee for a table that the delivery path reads.

**Why the trade is right anyway:** `/status` runs constantly and is the navigation mechanism
for a 120-message stream (T3.1). Making the most-used query the most complex one is the wrong
place to spend complexity. And **D20's pointer restores the missing guarantee from the other
direction** — retrieval reads through `latest_delivered_batch`, so it cannot see a batch that
was never confirmed, regardless of what is sitting in `approvedImages`.

**The two decisions are load-bearing together.** Reverting D19 *without* D20's pointer would
mean retrieval could read a half-reviewed batch. Recorded so that if anyone later removes the
pointer as "unnecessary indirection," they know what it was protecting.

---

### T8.2 — A delivered batch that changes is the last unhandled irreversibility

Every other reversal path is now clean: undo before confirm is free (D15), side effects fire
only on confirm (D20.3), and the pointer means unconfirmed work is unreachable (D20.1).

**What remains:** a batch confirmed, zipped, downloaded — and then edited. The zip on the web
person's laptop is now wrong, and nothing in the system knows.

**Hard-freezing is the wrong answer** (Alexander: *"this seems unreasonable"*), because the
most likely reason to edit a delivered batch is that someone **noticed a mistake** — and a
system that forbids fixing a known error is worse than one that tolerates a stale copy.

**The proposed `delivered — modified since` flag is cheap and honest:** it does not prevent
the change, it just refuses to pretend the change was free. `/status` showing
*"Batch 3 — delivered, modified since. Re-confirm to update."* costs one boolean and one
line of copy, and it is the difference between a known-stale copy and F3.4.

**What cannot be fixed:** files already on someone's machine. This is the permanent floor of
the design, and it should be stated in `APPROACH.md` as such rather than implied to be
solved.

---

### T8.3 — Cutting Notes discards real signal, and that should be said plainly

**Traded away:** genuine information the customer wrote down. `pricey, needs to look premium`
is a real constraint and it is now ignored. So are three legitimate multi-product creative
requests that Ellie recorded months ago.

**Why it is still right:** measured, not argued — F5 shows 3 rows corrupted against 1–2
improved. **But "we ignore a column of your data" is a real cost**, and the strongest version
of the reasoning is not "Notes are junk" — it is that **Notes contain four different kinds of
instruction, and only a human currently knows which is which.** Passing them raw asks a
generator to disambiguate something the team never disambiguated.

**D21.4 converts the cut into a process fix**, which is what makes it defensible rather than
merely convenient: *"if it needs to be in the shot, it should be in Shot Idea."* That is a
contract the team can follow, and it costs them nothing they were not already doing.

**What to watch:** whether anyone keeps writing styling instructions into Notes after being
told. If they do, the column is load-bearing in their habits and the cut needs revisiting —
most likely by classifying Notes rather than by reading them raw.

**Explicitly named as seen-and-deferred:** the multi-product grouped shots
(`El: shoot with the mugs maybe`, `bathroom set w/ the towels?`, `holiday table story?`).
These need multiple source images composited into one scene — `type: "image"` with several
`image_ref`s rather than `image_edit` with one `source` (F2.2, F2.9) — plus a way to express
product grouping the CSV has no column for. **Ellie has already asked for something the
product cannot do**, and saying so is worth more than half-building it.

---

### T8.4 — Fixed inputs buy explainability

**The gain from D21.3:** when a shot comes back wrong, there are exactly four possible causes
— the Shot Idea, the source photo, a product attribute, or the prompt translation. That is a
debuggable surface. With Notes included it would have been five, one of which is free-text
that may contain a joke (`plant not included lol`).

**The cost:** the system cannot use context it can see. A human looking at the sheet would
use `pricey, needs to look premium`; the system will not. **That is a real capability gap and
it should sit in the scope ledger's "next" column**, not be quietly forgotten.

---

## T9 — Cost of D22–D24

### T9.1 — Immutable batches make corrections into small batches, which confuses retrieval

**The consequence of D22:** a mistake found after confirm is fixed by generating a **new
batch** containing only the affected rows.

**Where it collides with D20:** retrieval reads through `latest_delivered_batch`. So after
correcting one product, the pointer moves to a batch containing **one image**, and
`getLatestBatch` returns one file instead of the forty the web person expects.

**Three ways out, none free:**
1. **Fetch by explicit batch id** as well as "latest." Cheap; puts a small burden on the web
   person to know which batch they want — the exact burden the design removed.
2. **Fetch returns latest delivered, and correction batches are understood as deltas.**
   Requires the web person to interpret. Works if corrections are rare (A9.1).
3. **A correction batch inherits the batch it supersedes**, and retrieval returns the merged
   set. Cleanest for the user, most machinery, and it partially re-opens the mutability D22
   was chosen to avoid.

**Recorded unresolved (OQ-19).** Not urgent — it only bites when a post-confirm error occurs,
which A9.1 assumes is rare — but it is the direct cost of the freeze, and it should be a
chosen answer rather than a discovered surprise.

---

### T9.2 — The freeze trades recoverability for an unambiguous record

**Traded away:** the ability to fix a known error in place. If Ellie confirms and *then*
notices she approved the wrong shot, the system will not let her correct it — she must run a
new batch, and the wrong image remains permanently in batch 3's record.

**Strongest case against:** this is a system whose founding disaster (F3.4) was a wrong image
in circulation. Refusing to let someone fix a wrong image, in that specific system, needs
justification beyond "simpler."

**The justification that holds:** the *record* is frozen, but the *outcome* is not. A new
batch supersedes, the corrected image ships, and the history honestly shows both what was
delivered and what replaced it. **The alternative — editing batch 3 so it retroactively
contains the right image — makes the record lie about what the web person actually
downloaded.** For a team whose problem is nobody knowing which file is real, a truthful
history beats a tidy one.

**What D22.2 has to carry.** Because the freeze is irreversible, the confirm affordance is
now the single highest-stakes control in the product. It must say what it does before it does
it — *"This finalises batch 3. 27 approved, 93 discarded. Decisions cannot be changed after
this."* A bare "Confirm" button would be a trap.

---

### T9.3 — Showing the prompt costs scroll, and may cost the contract

**Against D23**, honestly stated:

- **Scroll cost.** 40–80 words between images, 120 times, in the workflow D3 optimised for
  passive scrolling. The `context`-block mitigation reduces but does not remove this.
- **Contract drift.** Ellie's deal is "write what you picture." Showing her the machine's
  translation invites her to start writing *for the machine* — which is the prompt-engineering
  job she never asked for, arriving through the back door. **Watch for Shot Ideas in the next
  CSV that read like prompts rather than like thoughts.** That would be the signal, and it
  would be a loss disguised as engagement.

**Against my own position, and why D23 wins:** transparency is what their last tool lacked
(A0.2), and a visible prompt is the fastest way for the team to learn what a good Shot Idea
produces. **Adoption is the binding constraint here, not elegance.**

---

### T9.4 — 3 candidates and "2–3 approved" are in tension

**The arithmetic.** F3.2 defines a completed request as **2–3 approved images**. D24.2
generates **2–3 candidates**. If Ellie rejects two of three, that product ends the batch with
**one** approved image — below the definition of done — and nothing in the design regenerates.

**How often this matters:** unknown, and it is exactly the number nobody can supply. At a 33%
rejection rate most products clear; at 50% many do not.

**The options, with real numbers** (40 products, `uni-1-max` at $0.1030):

| Candidates each | Images | Cost | Slack messages |
|---|---|---|---|
| 3 | 120 | $12.36 | 120 |
| 4 | 160 | $16.48 | 160 |
| 5 | 200 | $20.60 | 200 |

**Cost is not the constraint — Ellie's attention is.** Going to 4 candidates buys insurance
for $4 but adds 40 more images to review and 40 more messages to the flood (T3.4). That is
the genuine trade, and it is a review-load decision wearing a cost-decision costume.

**The alternative to over-generating: a regeneration path.** Products that end short get a
second, small batch. This is cheaper in attention but requires machinery that does not exist
yet, and interacts with D22's freeze and OQ-12.

**Unresolved — see Round 2, Q8.**

---

## T10 — Cost of D25–D27

### T10.1 — Regeneration is the first mechanism that spends money without a gate

**The hole it opens.** D14's recap gate was the answer to Maya's *"don't burn our budget"* —
nothing is spent until a human sees the bill. **D26 bypasses it entirely.** Every regenerate
press is another $0.1030, uncapped, invisible, and available on 120 messages at once.

**Scale of the risk, honestly:** a frustrated reviewer regenerating one stubborn product ten
times spends $1.03. Regenerating every image in a drop once over adds $12.36. **This is not
a financial threat** — but it *is* a hole in the story we tell Maya, and the story was the
point (A7.4: seeing the bill is what resolves the fear, not the size of the bill).

**Cheapest adequate answer:** the running batch cost is already computed for the recap
(D14/OQ-13). Show it on the batch summary and update it as regenerations accrue —
*"batch 3: 137 images, $14.11 spent."* Costs nothing, keeps the promise, and preserves the
property that spend is never invisible.

**What to watch:** a single product regenerated more than three or four times. That is not a
budget problem, it is a signal that **the Shot Idea itself is wrong** — and the useful
response is to say so, not to keep spending.

---

### T10.2 — Regeneration breaks the fixed-size batch that D8.1 depends on

**The collision.** D8.1's completion check is `count(approved) + count(discarded) == batch
size`. Regeneration produces a new image. If it is posted as an *additional* message, batch
size grows mid-review and the check chases a moving target; if it *replaces* the original,
batch size holds.

**Replacement is clearly right** — it also keeps the stream from growing under a reviewer
who is already scrolling 120 messages, and F4.3 (`chat.update`) makes editing the message in
place straightforward. The regenerated image returns the slot to `pending`, and the batch
simply cannot complete while a regeneration is in flight, which is correct behaviour.

**But replacement creates a naming problem that must not be waved through.** A4.4 fixed the
image label *as* the export filename. If `HG-002_morning-kitchen_01.jpg` silently becomes a
different picture after a regeneration, **the same filename refers to two different images at
two different times** — which is precisely the ambiguity this product exists to eliminate
(F3.4). **The filename must carry a version:**
`HG-002_morning-kitchen_01_v2.jpg`. Cheap now, and a genuine correctness bug if skipped.

---

### T10.3 — A third button changes the review from a decision into a workshop

**Traded away:** the tight loop D3 was designed for. Two buttons make review a **triage** —
yes or no, one pass, top to bottom. Three buttons make it an **editing session**, where any
image can pull the reviewer into a modal, a prompt rewrite, and a wait for a new generation.

**Strongest case against:** at 120 images, a reviewer who regenerates even 10% of them adds
twelve modal round-trips and twelve waits to a session that was supposed to be a scroll. The
mode-switch cost is larger than the button suggests.

**Why it is still right:** *"a one-time generation is never the correct option."* A pure
triage loop has no answer when all three candidates are wrong — and the only alternatives were
over-generating on a guessed rejection rate or shipping short. **Regeneration is the honest
answer; the workshop risk is the price.**

**Mitigation that preserves both modes:** keep regeneration genuinely optional and visually
subordinate. Approve and Discard are the primary path; regenerate is the escape hatch, not a
third equal choice. **It should read as "none of these work" rather than as "try again."**

**Watch for:** median regenerations per batch climbing. Low single digits means the escape
hatch is working; double digits means LLM-B's prompts are wrong and the fix belongs upstream.

---

### T10.4 — Retention is now load-bearing, and that is a new constraint

**D25.3 changes the status of stored discards.** Retention was previously a convenience with
a future cleanup task attached (D4.7). It is now **the only recovery path for a
post-delivery error** — so deletion is not deprioritised housekeeping, it is forbidden.

**What this costs:** unbounded storage growth. At ~1 MB per image and 3 candidates plus
regenerations across a 300-product catalog refreshed periodically, this is single-digit
gigabytes per year — genuinely nothing.

**The real cost is A5.5's hazard, permanently.** Every discarded image stays retrievable
forever, so the rule that *discarded images must be unreachable through any handoff path*
becomes a permanent invariant rather than a v1 nicety. **The recovery path and the safety
rule are in tension by design:** an engineer must be able to reach a discarded image; the
product must never hand one out. That is a defensible line, but it has to be an enforced one.

---

### T10.5 — Deferring regeneration leaves v1 with no answer to a bad generation

**The honest statement for the scope ledger:** v1 can produce three wrong images for a
product and offers nothing but "discard all three." The team's recourse is to fix the Shot
Idea and upload a new CSV — a full round trip through ingest, generation, and review for one
product.

**Why it is still the right cut:** the alternative was a third button that changes the review
interaction itself (T10.3), built before anyone knows the rejection rate it exists to
address (A10.4). **Shipping the loop and measuring is cheaper than shipping the fix and
guessing.**

**The signal that it needs building immediately:** first real batch, count how many products
end with fewer than two approvals. Low single digits means the deferral was right. Anything
higher and regeneration moves from "next" to "now" — and D26's mechanics are already worked
out and waiting.

---

## T11 — Cost of D30–D32 (architecture)

### T11.1 — Always-on beats serverless here, and the reason is demo-ability as much as fit

**Traded away:** scale-to-zero, and the one-command deploy of a serverless platform.

**Why always-on wins:** the pipeline is a long-running paced job (poll every 2–5s, post at
~1/sec). On serverless it becomes a chain of scheduled invocations — more moving parts, and
**each handoff is a place a batch can silently stall.** One process with a job table is less
machinery and far more legible in a walkthrough, which matters because the video is a
first-class deliverable and *"here is the pipeline, here is its state"* is a better story than
*"here are six functions and a cron."*

**What to watch:** a single process means a single point of failure. Acceptable at six users —
a restart resumes from the job table — but it is a real availability ceiling and should be
named rather than implied away.

---

### T11.2 — A job table is not a queue, and the difference will show up eventually

**Traded away:** the guarantees a real broker provides — visibility timeouts, dead-letter
queues, competing consumers, backpressure.

**Why it is right now:** Redis or SQS is correct at scale and overkill at six users. The job
table gives restart-safety, retry counts, and inspectability using a database already
required, and it makes pipeline state *queryable* rather than needing a separate dashboard.

**Where it breaks first:** more than one worker process. A job table without `SELECT … FOR
UPDATE SKIP LOCKED` will happily hand the same job to two workers. **Single-worker is a
correctness assumption, not just a deployment choice**, and if a second instance is ever
started it must be with that lock in place.

---

### T11.3 — Two copies of every image, deliberately

**The cost of D32:** bytes live in our object store *and* in Slack. Roughly 120–180 MB per
drop, duplicated.

**Why it is worth it:** the channel is the permanent record. Coupling 120 permanent messages
to a bucket we control means a rotated key or a lifecycle rule silently destroys the record
of what was reviewed. **Duplication is the price of the channel outliving our infrastructure**
— and storage is cents (T4.2).

**The subtlety for D10.4:** with two copies, "the approved image" must remain unambiguous.
Our object store stays canonical — it is what the checksum is computed on and what the zip
streams. **Slack's copy is a rendering, never a source.** If the two ever diverge, ours wins;
the invariant is asserted against ours.

---

### T11.4 — The one un-retired build risk

**F8.2 is the sharpest unknown in the plan.** D3.2 requires Approve/Discard buttons on every
image message; D32 makes those messages *file shares*; and the docs say
`files.completeUploadExternal` accepts *"structured rich text blocks"* without confirming
whether an `actions` block with buttons qualifies.

**If it does not, one of two things gives:** either bytes move back out of Slack (reverting
D32 to `image_url`, which was the original recommendation and remains a clean fallback), or
posting becomes two messages per image — which doubles the flood (T3.4) and breaks the
one-message-one-decision model D3 is built on.

**This must be tested on day one, before the pipeline is written.** It is cheap to test — one
upload, one message — and expensive to discover late, because it invalidates the posting
layer rather than a detail of it.

**Alongside it, two other day-one verifications** (both already logged): **F4.12** (does a
muted channel still badge on @-mention — T3.4's entire mitigation) and **F4.5** (do buttons
work in a posting-restricted channel — D2.1's entire premise). **Three facts, all cheap to
check, each capable of invalidating a load-bearing decision. They should be the first hour of
the build, not a discovery in hour nine.**

---

### T11.5 — The build order protects the loop and risks the stakeholder

**What the order optimises for:** a demonstrably working end-to-end loop — CSV in, images
out, decisions captured, files delivered. That is the right thing to protect, because a
partial loop demos as nothing at all.

**What it exposes:** `/status` sits last, so schedule pressure lands squarely on Maya's
requirement. The failure is asymmetric — Ellie's path (1–5) is fully protected, Maya's is
not.

**Why it is nonetheless defensible:** without steps 1–5 there is no product for `/status` to
report on. Sequencing has to protect the spine. **But the scope ledger must say which
stakeholder absorbs the risk**, rather than presenting the order as neutral.

**The signal to act on it:** reaching step 6 with meaningful time left. At that point the
crude-`/status`-at-step-4 mitigation has already been skipped, and building the real one
becomes the highest-value remaining work — ahead of any polish on steps 1–5.

---

## T12 — Cost of D34–D37 (closing decisions)

### T12.1 — Pass-through adds review load in exchange for a complete set

**Traded away:** Ellie's attention on images she has seen a thousand times. On the given
`catalog.csv`, D36 adds **24 unmodified white-background photos** to a review that would
otherwise be 48 images — a 50% increase in decisions for zero new visual information.

**What it buys:** a batch that delivers an image for **every** product, so the export zip is
complete and the web person pulls once. It also means the system does something useful when a
drop arrives nearly empty (A1.2) instead of sitting idle.

**Why it is still right:** D36.4's reasoning is the strong part — a blank Shot Idea *may be
intentional*, and a system that silently drops those rows makes an assumption on the team's
behalf. Passing them through makes the choice visible and confirmable.

**The pressure point at scale:** at 10× the catalog this compounds directly with F9.5 — every
un-styled product adds a decision. If most of a 3,000-product catalog has no shot idea, the
review is dominated by images nobody changed. **Auto-approving pass-throughs (OQ-26) is the
obvious relief valve, and it is exactly the kind of attention-side mitigation F9.5 says will
be needed first.**

---

### T12.2 — An editable system prompt is powerful and quietly makes results irreproducible

**The gain from D34.6:** brand voice becomes a maintained artefact the team controls, and it
is the natural home for the taste D21.2 removed when Notes were cut.

**The cost:** the moment the prompt is editable, **two images generated from the same Shot
Idea a month apart may differ for reasons invisible in the data.** "Why does this batch look
different?" becomes unanswerable without a prompt version on every image.

**Requirement, not a nicety:** store a prompt version ID per generated image. It is one column
now and unreconstructible later — the same shape of argument as filename versioning (T10.2)
and for the same underlying reason: **anything that can change must be identifiable, or the
record stops being trustworthy.**

**Second-order risk:** an editable prompt is a place a well-meaning edit degrades every
subsequent generation, with no test to catch it. Worth a "preview on one product before
saving" affordance whenever it is built.

---

### T12.3 — D35's approved-CSV is the only thing that repairs the source sheet

Every other part of this design routes *around* the spreadsheet — Slack for review, our store
for images, a zip for delivery. **D35 is the one artefact that writes back to the thing the
team actually lives in.**

**Why that matters more than its cost suggests:** F1.1 established that the sheet has nowhere
to record outcomes, which is the mechanical cause of *"nobody can tell you which of the
sixteen requests are done."* Fixing status inside our system helps Ellie and Maya; **fixing it
in the sheet helps everyone who never touches our system at all.**

**What to watch:** whether anyone actually pastes it back. If the CSV lands in Slack and is
never used, the sheet stays broken and the fix was theatre — and the honest response is to
reconsider live sheet sync, which the brief explicitly said nobody was asking for (F3.9).

---

## T13 — Cost of D39/D40

### T12.1 — The channel stops being browsable

**Traded away:** glanceability. Under D38 you could scroll the channel and see
the photographs. Now you see forty lines of text and have to open a thread to
see anything.

**Why it is right:** the channel's job changed from *showing* to *finding*.
Forty searchable lines beat forty screens of photographs on a phone, and the
reviewer is opening each product anyway in order to decide. The tap is not
overhead on the way to the work; it *is* the work.

**Watch for:** anyone asking "which ones look good" without opening threads.
That would mean triage-by-glance was load-bearing and we removed it.

---

### T12.2 — Two surfaces to keep coherent

**Traded away:** single-surface simplicity. The overview page and the Slack
channel now describe the same batch, and both must agree.

**What keeps them honest:** both read the same committed rows. The page holds no
cached state and counts nothing in memory, which is the same rule `/luma status`
follows. A disagreement between them would therefore be a bug in one query, not
drift between two systems.

**The predictable request:** someone will ask why they cannot approve from the
page. The answer is D40.2's reason, not laziness, and it should be given as
such.

---

### T12.3 — A shared link with no expiry

**Traded away:** any control over who sees a batch. The token authorises nobody
but reveals everything about the batch to anyone holding it.

**Why it is proportionate:** the page exposes product photographs bound for a
public website, and grants no action. OWASP's own framing is that unguessable
tokens are *defence in depth, not the defence* — which is exactly why the page
does not act. **If it could approve, this would be the wrong model.**

**The residual risk:** an unreleased drop is commercially sensitive before
launch, which is precisely when this link circulates. Low, not zero, and the
same risk already accepted for the generated-images CSV (A6.4).

---

### T12.4 — Polling costs requests to buy a failure mode

**Traded away:** elegance and a little bandwidth. A four-second poll on an open
page is ~15 requests a minute, against a stream that would cost one connection.

**What it buys:** a failure that announces itself. The research could find no
primary source on backgrounded SSE in mobile Safari, and the person most likely
to background it is the one the product is for. **A page that silently stops
updating looks finished** — and telling a reviewer a batch is complete when it
is not is worse than any amount of redundant polling.

**Reversible:** if the page is ever left open for long stretches and the request
volume matters, SSE with Railway's documented heartbeat-and-reconnect is the
upgrade. The reason to wait is evidence about the phone, not about the cost.

---

## T14 — Cost of D41–D43 (the write surface)

**T14.1 — Deciding now leaves Slack.** The reviewer taps a link and waits for a
page. On a phone on mobile data that is a second or two before the first
photograph appears, where the old thread buttons were instant. Accepted
because the thing being paid for is seeing three candidates at once, which is
the actual decision.

**T14.2 — Sign-in is a step that did not exist.** `/luma signin`, open the
link, then decide. It is once every 24 hours rather than once per decision,
and it is what makes revocation meaningful — but the first-time cost is real,
and it is why the read-only page tells a signed-out reader exactly which
command to run rather than just refusing.

**T14.3 — Two sources of write authority.** Slack's own channel membership no
longer governs who can act; `write_access` does. That is a second list to keep
in step with the first, and it can drift — someone removed from the workspace
keeps a row until Ellie revokes it. Accepted for v1 because the list is small
and the blast radius of a stale entry is bounded by the session lifetime;
noted as the obvious thing to wire to Slack's user directory later.

**T14.4 — The page polls.** Every open page hits `/api/review/:token` every
4 seconds while generating and every 15 afterwards. For a handful of reviewers
this is nothing; it is not a design that survives a hundred readers. The
revision check means a poll that finds nothing changed costs one query and no
render, which is what makes the always-on poll affordable at all.
