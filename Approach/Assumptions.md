# Assumptions

Things I could not verify and chose to proceed on anyway. Each one names the question I
*would* have asked the team, the assumption taken instead, and what it changed about the
build. This file is the raw material for the deliverable `ASSUMPTIONS.md`.

Status key: `HELD` = currently operating on it · `RETIRED` = superseded or disproven

---

## A0 — Carried in from `notes.md` (pre-Round-1, author: Alexander)

**A0.1 — The weekly site upload is manual and unindexed.** `HELD`
> *Question I'd ask:* How does the web person know which files in the Drive folder are new
> this week versus already live?

There is no standardised filename and no record of what shipped, so there is no way to tell
used from unused images. Used images are probably *not* deleted (they may be reused), so the
folder accumulates forever and the weekly upload means sifting the entire all-time pile.
Error-prone by construction — this is the mechanism behind the wrong-`IMG_43xx` incident (F3.4).

*Changes:* makes deterministic filenames + a per-batch manifest load-bearing, not cosmetic.

**A0.2 — The dashboard tool failed for organisational reasons, not scale reasons.** `HELD`
> *Question I'd ask:* Who besides Ellie ever had a login to the tool you trialled?

Ellie drives this delivery and is averse to new software. Nothing was delegated, so nobody
else had a reason to log in, so Ellie gatekept the process by default and there was no
visibility around it. This *looks* like an unscalable process but the constraint is
organisational, not technical.

*Changes:* the fix is to make the output visible-by-default rather than to build a better
dashboard. Push beats pull.

**A0.3 — The return medium must be simultaneously mobile-friendly, shareable, and
non-gatekept.** `HELD`
> *Question I'd ask:* Where would you actually look for this — Slack, email, or a link?

Whatever surface we pick has to satisfy all three at once. If it's Slack it must be a
public channel; if email, others must be CC'd; if a bot, it must be queryable; if a web
page, it needs either public access or shared credentials.

*Changes:* rules out any surface where Ellie is the only party with access.

---

## A1 — Established during fact-finding (pre-Round-1)

**A1.1 — Next month's 40-product drop CSV will have the same 9 columns.** `HELD`
> *Question I'd ask:* Is the drop export coming out of the same sheet template?

README says "a fresh CSV (same columns, new products, new photo URLs)." Taking that at face
value, but building the ingest to *validate and report* rather than assume, since the file
is a human spreadsheet export.

**A1.2 — Most rows in the drop CSV will have a blank Shot Idea.** `HELD`
> *Question I'd ask:* Has anyone written shot ideas for the 40 drop products yet?

16 shot ideas accumulated across months for ~300 products. There is no reason to think 40
brand-new products arrive with 40 shot ideas already written. **If true, shot-idea authoring
is itself a bottleneck, and a system that only acts on written ideas stalls in exactly the
same place the current process does.** TODO - revisit.

**A1.3 — Maya's budget fear is anchored on photographer economics, not API economics.** `HELD`
> *Question I'd ask:* What number were you picturing when you said "burn our budget"?

Her only prior for "a batch of product photos" costs hundreds to thousands of dollars and
takes weeks. Per F2.4 the real number is $5–$12 for the whole drop. The fear is real; the
magnitude is wrong.

*Changes:* Argues for making cost **visible** rather than building a gate to control it.

**A1.4 — We have no write access to their website.** `HELD`
> *Question I'd ask:* How does the web person actually publish — a CMS, Shopify, hand-coded?

Never mentioned in the brief. "On the product page" is therefore the one step of F3.2 we
cannot close. The last mile stays human.

**A1.5 — "2–3 approved images" means 2–3 *distinct usable options per shot idea*,** not
2–3 required approvals. `HELD`
> *Question I'd ask:* When you say 2–3 images, is that variety for one idea or several ideas?

---

## A2 — Arising from the surface decision (Round 1 Q1, as revised to D2)

**A2.1 — Opening a link from Slack does not violate Ellie's "don't install anything."** `RETIRED`
> *Retired at Round 1 Q1 revision.* D1 depended on this; D2 (all-in-Slack) does not need it
> to be true. **Retiring a load-bearing unverifiable assumption is the strongest single
> argument for the revised design** — we went from betting on an interpretation of Ellie's
> words to not needing an interpretation at all.

**A2.2 — The team shares one Slack workspace with a channel this can post into.** `HELD`
Implied by F3.1 and brief step 5. Reviewers get in via a workspace invite (F3.8).

**A2.3 — Ellie's taste remains the decision even when others are granted rights.** `HELD`
> *Strengthened by D2.2:* v1 hardcodes Ellie's user ID as the only approver, which matches
> F3.3 exactly. The contradiction only appears once rights are delegated.
> *Question I'd ask:* If someone else approves a shot, is that final, or does Ellie still
> have the last word?

F3.3 says Ellie's pick is the decision and there is no other approval step. D1.4 grants
others approve/discard rights, which formally contradicts that. Assuming the intent is
**shared triage, single confirmation** — others can move images along, but the stage-closing
`Confirm` (D1.5) stays with Ellie. See OQ-1.

**A2.4 — Six people means concurrency is rare but not impossible.** `HELD`
Two approvers on one batch will happen occasionally, not constantly. Justifies a simple
answer (last-write-wins, visible to both) over locking. See T1.3.

---

## Open questions (raised, not yet settled)

Recorded here rather than in a fifth file — flagged to Alexander for override.

- **OQ-1 — Who may press `Confirm`?** Only Ellie, or anyone with approve rights? F3.3 argues
  for Ellie alone; D1.4's permission model implies it could be delegated. Blocks the role
  model. *(Raised Q1.)*
- **OQ-2 — What happens to a `Confirm`ed batch that turns out to be wrong?** Reopen, or
  supersede with a new run? Their current process has no undo, and their named failure
  (F3.4) is a confident wrong answer that stood for three weeks. *(Raised Q1.)*
- **OQ-3 — Which slash commands actually earn their place?** D1.1 calls for "a series"; T1.2
  identifies them as the first thing to cut. Needs a ranked list, not a wishlist.
  *(Raised Q1.)*

---

## A3 — Arising from D2 (all-in-Slack, Round 1 Q1 revision)

**A3.1 — Scrolling is an acceptable review method at drop scale.** `HELD — AT RISK`
> *Question I'd ask Ellie:* When 40 products come back with 3 shots each, would you rather
> scroll through all of them, or be handed only the ones you haven't decided yet?

This is the assumption D2 rests on and the one Alexander explicitly flagged as the main
concern. **Consciously accepted with a named pivot** (T2.1). Not a blind spot — a bet with
a stop-loss.

**A3.2 — A posting-restricted channel is acceptable to a team that currently uses Slack
for discussion.** `HELD — CONTESTED`
> *Question I'd ask:* If the shots channel were read-only, where would "no, too staged" go?

Directly in tension with brief step 5. See T2.4 and OQ-5.

**A3.3 — Installing a Slack app is an acceptable "new thing" even though Ellie said no new
installs.** `HELD`
> *Question I'd ask:* Does adding an app to the workspace count as installing something?

Reading F3.6 as a constraint on *her phone and her habits*. A workspace app install is an
admin action performed once by someone else, and appears to Ellie as a new channel — not a
new tool. Note this is a *weaker* version of retired A2.1: we still assume something about
her tolerance, but only that a new channel is acceptable, which the brief supports since
Slack channels are already how this team works (F3.1).

**A3.4 — The zip export (D2.3) is an acceptable substitute for "in the drive folder."** `HELD`
> *Question I'd ask the web person:* Would you rather pull a zip from Slack, or keep going
> to the Drive folder?

F3.2 defines done as including the Drive folder. D2.3 delivers a zip in Slack instead.
Justified by A0.1 and brief step 7 — the folder has *already* failed as a source of truth,
since the web person already asks Slack which files are final. **This partially pre-answers
Q2**, which will now be about whether anything is written to Drive at all.

---

## Open questions — updated

- **OQ-1 — Who may press `Confirm` / approve?** *Partially settled by D2.2:* Ellie's user ID
  hardcoded in v1. Still open: what happens when rights are delegated (A2.3). *(Q1.)*
- **OQ-2 — What happens to a finalised batch that turns out to be wrong?** Still open. *(Q1.)*
- **OQ-3 — Which slash commands earn their place?** D2 names four
  (permissions, export, weekly/monthly fetch, CSV upload). T2.1 adds a fifth
  (`/…status` — pending work) which may be the most valuable of all, since it serves Ellie's
  navigation problem and Maya's transparency need with one mechanism. Needs ranking. *(Q1.)*
- **OQ-4 — Does a stage-closing `Confirm` (old D1.5) survive into D2,** or does `/…export`
  (D2.3) absorb it? These are different: Confirm asserts *"this batch is done deciding,"*
  export asserts *"give me the files."* The web person needs the former. *(Q1 revision.)*
- **OQ-5 — Read-only channel vs. keeping the discussion.** Restricting posting delivers the
  tidiness D2.1 needs but removes brief step 5's opinion-gathering. Thread replies may
  resolve it. Blocks channel layout. *(Q1 revision.)*
- **OQ-6 — Row limit vs. batching for large CSVs.** D2.5 leaves this to testing. Note that
  at 300 rows it stops being a formatting question and becomes "what should we generate at
  all," which belongs to Q4/Q5. *(Q1 revision.)*

---

## A4 — Arising from D3 (flat message stream, Round 1 Q1b)

**A4.1 — Approve and Discard are independent per-image judgements, not a pick-one choice.** `HELD`
> *Question I'd ask:* When three shots come back for one product, are you picking your
> favourite, or keeping every one that's good enough to use?

F3.2 defines done as **2–3 approved images** per shot idea, and A1.5 read that as variety
options rather than required approvals. So approving one candidate must **not**
auto-discard its siblings — she can approve two of three. This matches flat messages
naturally (each message carries its own independent decision) and is one more argument for
D3 over a radio-button contact sheet.

**A4.2 — Ellie reviews in roughly stream order and may not finish in one sitting.** `HELD`
Implied by her described workflow. Justifies both in-place updates (T3.1) and `/status` as
a re-entry point rather than a reporting feature.

**A4.3 — Channel notification preferences can be set to mentions-only.** `HELD — VERIFY`
Load-bearing for the T3.4 mitigation. If it turns out members can't be defaulted to
mentions-only, the flood risk needs a different answer.

**A4.4 — The image label and the export filename are the same string.** `HELD`
Proceeding on this unless overruled. It collapses a translation step where the wrong file
could be substituted — the mechanism behind F3.4.

---

## Open questions — updated (post Q1b)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-2** — Undoing a finalised batch. *(Open.)*
- **OQ-3** — Slash command ranking. *Partially settled:* `/status` (D3.5) is in and is
  ranked highly, serving both Ellie's navigation and Maya's transparency. Permissions,
  export, and weekly/monthly fetch still need ordering against build time.
- **OQ-4** — Does a stage-closing `Confirm` survive into D2/D3, or does `/…export` absorb
  it? **Now folded into Q2.**
- **~~OQ-5~~** — **SETTLED by D3.4:** top-level posting restricted, thread replies open.
- **OQ-6** — Row limit vs. batching for large CSVs. *(Open — belongs to Q4.)*
- **OQ-7 — Notification volume.** T3.4. Default mitigation proposed; needs confirmation and
  early verification against a real workspace. *(Raised Q1b.)*
- **OQ-8 — `/status` filtering at scale.** T3.5. *(Raised Q1b.)*

**A4.5 — Per-image discussion actually happens and is worth protecting.** `HELD`
> *Question I'd ask:* When you post favourites for opinions, does the team reply much — or
> is it mostly you deciding and them agreeing?

Brief step 5 shows real back-and-forth ("that one," "no, too staged"), so this is
well-evidenced rather than speculative. **It is nonetheless the assumption that decided D3
over the batch-parent design** (see Road not taken), so it is worth naming: if discussion
volume turns out to be near-zero in practice, the tidier rejected design becomes correct
and the flood was a price paid for nothing.

**A4.6 — Ellie will not mute the channel, or will still receive @-mentions if she does.** `HELD — VERIFY`
Depends on F4.12. See T3.6. Unverified and unobservable — we cannot detect a mute. The
proxy signal is time-to-first-decision stretching on a batch.

---

## A5 — Arising from D4/D5 (pipeline boundary and handoff, Round 1 Q2)

**A5.1 — Approval conversations can outlast one hour, and often will.** `HELD`
> *Question I'd ask:* When you post shots for opinions, how long until you've decided —
> minutes, or does it sit until tomorrow?

Brief step 5 describes a back-and-forth, and Ellie "runs half of everything else." Assuming
decisions routinely take longer than the 60-minute Luma URL lifetime (F2.3). **This is the
assumption that makes download-all mandatory rather than merely convenient** — and note it
is cheap to be wrong about, since download-all costs almost nothing (T4.2) while the
opposite error loses paid-for assets permanently.

**A5.2 — The web person will run a Slack command rather than open Drive.** `HELD`
> *Question I'd ask them:* Would you rather type one command in Slack, or keep browsing the
> Drive folder?

The only genuine behaviour change in the design (D5.1). Supported by brief step 7 — they
already break out of Drive to ask Slack what is final, so Slack is already in their loop;
we are replacing a question to a human with a query to a bot.

**A5.3 — Nobody needs historical images often enough to justify building browse.** `HELD`
Alexander's note: in principle an engineer could query the store, or someone could scroll
Slack. Accepted as adequate for the POC. **Watch for:** if this proves wrong, the pressure
will show up as people going to the Drive mirror instead — the exact accident T4.6 warns of.

**A5.4 — "Weekly" means approval-dated, not generation-dated.** `HELD`
Recorded default per T4.4. Cheap to change now, expensive after the web person builds a
mental model around it.

**A5.5 — Discarded images must never be reachable by a handoff command.** `HELD`
A consequence of download-all (D4.2). If a discarded image can be retrieved by the same path
as an approved one, we have rebuilt F3.4 inside our own system. Treated as a hard
requirement rather than an assumption, but recorded here because it is easy to violate
accidentally when everything lives in one bucket.

---

## Open questions — updated (post Q2)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-2** — Undoing a decision. **Resolved in shape by T4.3** — a decisions event log makes
  reversal a later event, for free. Still open: whether reversal is exposed in the UI at all.
- **OQ-3** — Slash command ranking. Now six candidates: `/status`, permissions,
  weekly fetch, monthly fetch, CSV upload, export. Needs ordering against build time.
- **OQ-4** — Stage-closing `Confirm`. **Probably resolved by substitution** — D5.1's date
  window replaces the gate (T4.5). **Needs an explicit yes: delete `Confirm`, or keep both?**
- **OQ-6** — Row limit vs. batching for large CSVs. *(Open — Q4.)*
- **OQ-7** — Notification volume / mute behaviour. F4.12 verification. *(Open.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-9 — The updated CSV export is still unaddressed.** Alexander's own `notes.md`
  requires *"should also put the images created into the sheet,"* and the brief allows
  *"an updated export at the end is fine"* (F3.9). **D5 delivers a zip; it does not deliver
  an updated sheet.** These are different artefacts for different people — the zip is for the
  web person, the sheet is for Maya and the catalog itself. Also note F1.1: the sheet has no
  status column, so an updated export means *adding* columns, not filling them.
  *(Raised Q2.)*
- **OQ-10 — Vocabulary.** T4.1's proposed `ready for review` / `pending` / `approved` /
  `discarded` / `delivered`, with "done" retired. Needs confirmation. *(Raised Q2.)*

---

## A6 — Arising from D6–D10 (Round 1, Q2 follow-up and Q3)

**A6.1 — A 40-product launch is a large, infrequent event.** `HELD — CONTESTED BY THE BRIEF`
> *Question I'd ask Maya:* Is a 40-product drop a once-a-year thing, or roughly how you
> launch every month?

Alexander's assumption when accepting `uni-1-max` pricing. **Note the brief pushes the other
way:** "New exports will keep coming — the drop is next month" (F3.9-adjacent), and
`notes.md` records "there will be a csv every month." **The conclusion survives either
reading** — twelve monthly drops at `uni-1-max` is $148/year (T5.1) — but the assumption
should be corrected rather than relied on, because it is the stated basis for the cost call.

**A6.2 — Cost spikes will be noticed in time to react.** `HELD`
D10.2 makes the model a config switch, which is the right hedge. But nothing yet *watches*
spend. The reaction depends on someone checking Luma's dashboard. A per-batch cost line in
the Slack summary would make it self-reporting for nearly no effort — and it doubles as the
answer to Maya's budget anxiety (A1.3), which is presentational value at near-zero cost.

**A6.3 — Ellie will action every image rather than abandon a batch.** `HELD — AT RISK`
Required by D8.3. The risk is not refusal but degradation: rubber-stamping to clear the
list. See T5.2. **Detectable** via decision-log timestamps (D7.2).

**A6.4 — Generated-image URLs in the output CSV can be permanent and unguessable.** `HELD`
> *Question I'd ask:* Is there anything sensitive about unreleased product shots being
> viewable by anyone holding a link?

These are product photos destined for a public site, so the confidentiality window is short.
Assuming a permanent unguessable URL beats a signed URL that expires and leaves Maya holding
a dead spreadsheet. **Note the tension:** an unreleased drop is commercially sensitive
*before* launch, which is exactly when this CSV circulates. Low risk, not zero.

**A6.5 — Every image in a batch belongs to exactly one batch, and batch membership is
fixed at generation.** `HELD`
Required for D8.1's completion check to terminate. Consequence: a re-generated or added
image either joins the existing batch (re-opening a `complete` batch) or forms a new one.
Not yet decided — see OQ-12.

---

## Open questions — updated (post Q3)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-2** — Undo. Shape resolved by D7.2 (a later event). Still open: exposed in the UI?
- **OQ-3** — Slash command ranking. `/status` has risen further — D8.1 makes it the recovery
  mechanism for a batch blocked by one un-actioned image. *(Open.)*
- **~~OQ-4~~** — **SETTLED by D8: `Confirm` is deleted**, replaced by automatic completion.
- **OQ-6** — CSV size guard. *(Open — Q4.)*
- **OQ-7** — Mute/notification behaviour, F4.12 verification. *(Open.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **~~OQ-9~~** — **SETTLED by D9.**
- **~~OQ-10~~** — **SETTLED by D6.**
- **OQ-11 — Is there a second CSV at `delivered`,** recording what was *approved* rather
  than what was generated? F1.1 says the sheet's defining flaw is having nowhere to record
  outcomes, and this is the natural place to fix it. *(Raised Q3.)*
- **OQ-12 — What happens to a `complete` batch when an image is re-generated or added?**
  Re-open it, or start a new batch? A6.5. *(Raised Q3.)*
- **OQ-13 — Should the Slack batch summary carry a cost line?** A6.2 — near-zero effort,
  directly addresses Maya's stated budget fear, and makes spend self-reporting. *(Raised Q3.)*

---

## A7 — Arising from D11–D14 (Round 1, Q3 follow-up and Q4)

**A7.1 — Undo is rare and early, not a routine affordance.** `HELD`
> *Question I'd ask:* How often do you change your mind after saying yes to a shot?

D11.4 makes undo a deletion. Once files have left the system (a downloaded zip, a Drive
mirror), undo cannot reach them (T6.2). Assuming reversals happen during review rather than
after delivery. **If wrong, the design needs a recall mechanism, which is materially harder
than a delete.**

**A7.2 — One CSV upload corresponds to one meaningful batch of work.** `HELD`
D12.1 ties `batch_id` to upload. Assumes the team's natural unit is "a file we sent over,"
which matches Maya's behaviour in the brief. Breaks if they habitually upload the same
catalog repeatedly to generate different subsets — then batches become an artefact of file
handling rather than of work.

**A7.3 — The drop CSV will conform to the expected structure.** `HELD — AT RISK`
> *Question I'd ask:* Is the drop export coming out of the same sheet, with the same column
> headers, or does someone rebuild it?

D13.2 enforces strict structural validation. A1.1 already assumed same columns based on the
README. **The risk is that the first real contact with production data is a rejection**
(T6.5). Mitigated by splitting structural rejection from content warnings.

**A7.4 — Seeing the bill before spending is what actually resolves Maya's budget fear.** `HELD`
Not seeing a smaller bill. D14's recap gate costs almost nothing and addresses the concern
that the Q3 economics could not — the numbers proved the fear was unfounded, but a proof is
not a reassurance. **This assumption is why a gate I argued against in Q3 is now in the
design: the justification is psychological, not economic, and it is free.**

---

## Open questions — updated (post Q4)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-2** — Undo exposure in the UI. Sharpened by T6.2: undo cannot reach files that have
  left the system, which argues for it being rare and early. *(Open.)*
- **OQ-3** — Slash command ranking. Now: ingest (D13), generate-trigger (D14),
  `/status`, get-latest-batch, permissions. *(Open.)*
- **OQ-7** — Mute/notification behaviour, F4.12. *(Open — day-one verification.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-11** — A second CSV at `delivered`, recording what was approved. *(Open.)*
- **OQ-12** — Re-generated images and `complete` batches. *(Open.)*
- **~~OQ-13~~** — **SETTLED by D14:** cost estimate goes in the ingest recap.
- **~~OQ-6~~** — **SETTLED by D14:** the recap-then-button gate replaces any row cap.
- **OQ-14 — Symmetric `discardedImages` table?** T6.3. Needed to keep all three states as
  membership rather than deriving one from the event log. *(Raised Q4.)*
- **OQ-15 — Does "latest batch" mean latest batch, or latest batch with content?** D12
  allows empty batches from an upload that never generated. *(Raised Q4.)*

---

## A8 — Arising from D15–D18 (Round 1, Q5 and follow-ups)

**A8.1 — Someone will press confirm.** `HELD`
D15.2 makes progress depend on a human action after 120 decisions have already been made —
the point of maximum review fatigue. Mitigated by posting the button at auto-completion
rather than in the intro message, and by `/status` surfacing the
actioned-but-unconfirmed state. **Watch for batches parked there.**

**A8.2 — The team's existing 16 shot ideas are a usable style corpus.** `HELD`
Underpins D18.4. They are short, consistent in voice, and cover six categories (F1.5) — a
small but coherent few-shot set. **The refinement that matters:** they live in the *current*
catalog, not in next month's drop, so proposals must draw on historical shot ideas across
batches or the generic fallback (D18.5) fires exactly when the feature is most needed.

**A8.3 — Proposed shot ideas will read as drafts, not decisions.** `HELD — AT RISK`
> *Question I'd ask Ellie:* If the system suggested a shot idea, would that feel like help
> or like being overruled?

The one place this design touches her creative judgement. Framing is load-bearing: a
proposal she edits is assistance; a proposal that generates unless she objects is a
replacement. **This assumption is a large part of why D18 is deferred rather than built
first** — getting adoption on the mechanical half is the safer order.

**A8.4 — Rejecting a malformed CSV is acceptable because the error will be actionable.** `HELD`
Rests entirely on D17.4 being met. If the error message is poor, T6.5's risk lands at full
force on the first real production file.

---

## Open questions — updated (post Q5)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-2** — Undo exposure in the UI. **Sharpened by D15:** free before confirm, expensive
  after — so the natural answer is "undo exists, but only before confirm." *(Near-settled.)*
- **OQ-3** — Slash command ranking. Now six: ingest, generate-trigger, `/status`,
  get-latest-batch, `confirm-review-done`, permissions. *(Open.)*
- **OQ-7** — Mute/notification behaviour, F4.12. *(Open — day-one verification.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-11** — A second CSV at `delivered`, recording what was approved. *(Open.)*
- **OQ-12** — Re-generated images and `complete` batches. *(Open.)*
- **~~OQ-14~~** — **SETTLED by D16:** `discardedImages` is being built.
- **OQ-15** — "Latest batch" vs "latest batch with content." *(Open.)*
- **OQ-16 — Does `confirm-review-done` gate retrieval, or only side effects?** With Drive
  descoped (D5.5), confirm has no observable effect in the POC unless it gates the zip.
  Cleanest resolution: confirm is the transition to `delivered`, and `delivered` gates
  retrieval — which revises D8.2. **Needs a decision; an invisible button should not be
  built.** *(Raised at T6.2 follow-up.)*

---

## A9 — Arising from D19-revert, D20, D21 (Round 1, close of Q6)

**A9.1 — Editing a delivered batch is rare, and usually means fixing a spotted error.** `HELD`
> *Question I'd ask:* Once you've said a batch is finished, how often do you go back?

Underpins rejecting a hard freeze (D20 / T8.2). If instead it is common, the
`delivered — modified since` flag becomes noise rather than signal.

**A9.2 — The team will accept the "put it in Shot Idea" contract.** `HELD`
> *Question I'd ask Ellie:* If we told you the Shot Idea box is the only thing the AI reads,
> would you use it that way — or would you keep jotting in Notes?

D21.4 turns a scope cut into a process rule, which only works if they follow it. **Watch
for:** styling instructions continuing to appear in Notes. That is the signal the cut needs
revisiting via classification rather than exclusion.

**A9.3 — Product attributes are useful prompt inputs.** `HELD`
D21.3 includes name, category, colour/finish, material. `Terracotta` and `Stoneware` are
genuinely descriptive; `Sage Cream` and `Ochre Clay Terracotta` are multi-value fields with
no delimiter (F1) and may confuse as easily as help. **Worth testing early on a real
generation rather than assuming.**

---

## Open questions — updated (close of Round 1)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **~~OQ-2~~** — **SETTLED by D15 + D19-revert:** undo is a row move, free before confirm.
- **OQ-3** — Slash command ranking against build time. *(Open — Round 2.)*
- **OQ-7** — Mute/notification behaviour, F4.12. *(Open — day-one verification.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-11** — A second CSV at `delivered`, recording what was approved. *(Open.)*
- **OQ-12** — Re-generated images and `complete` batches. *(Open.)*
- **~~OQ-15~~** — **SETTLED by D20.1:** the pointer means unconfirmed batches are unreachable.
- **~~OQ-16~~** — **SETTLED by D20.**
- **OQ-17 — A delivered batch that is subsequently changed.** Proposed
  `delivered — modified since` flag plus re-confirm (T8.2). *(Raised at close of Round 1.)*
- **OQ-18 — "If blank it should default to something" — default what?** If it means a blank
  Shot Idea gets an invented one, that re-introduces LLM-A which D18 cut. **Proceeding on
  D18.1: blank Shot Idea = not generated.** *(Raised at close of Round 1.)*

---

## A10 — Arising from D22–D24 (Round 2, Q7)

**A10.1 — Post-confirm errors are rare enough that "run a new batch" is an acceptable remedy.** `HELD`
Underpins D22. If wrong, the freeze converts a small mistake into a full re-run and the team
will start delaying confirmation to keep their options open — which would stall delivery, the
opposite of the intent. **Watch for:** batches sitting actioned-but-unconfirmed (already the
watch signal from T7.1, now doubly meaningful).

**A10.2 — Seeing the prompt will teach good Shot Ideas rather than train prompt-writing.** `HELD — AT RISK`
> *Question I'd ask Ellie:* If you could see exactly what the AI was told, would you start
> writing your ideas differently?

D23's justification. The risk is the same mechanism running backwards: she starts authoring
prompts instead of pictures, taking on the job the product exists to remove. **Detectable** —
next month's Shot Ideas would read like prompts rather than like `holiday morning, gift-y`.

**A10.3 — Three distinct interpretations of a Shot Idea are genuinely distinguishable.** `HELD`
D24.1 assumes LLM-B can produce three readings that differ meaningfully while staying
faithful. Unverified. **Cheap to test early**, and it should be tested before the demo — if
the three come back near-identical, the comparative review D3 was designed for has nothing to
compare.

**A10.4 — A rejection rate low enough that 3 candidates usually yield 2 approvals.** `HELD — UNVERIFIED`
Required for D24.2 to satisfy F3.2. Nobody can supply this number and it is the single most
load-bearing unknown about review behaviour. See T9.4 and Q8.

---

## Open questions — updated (Round 2, post Q7)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-3** — Command surface ranking against build time. *(Open.)*
- **OQ-7** — Mute/notification behaviour, F4.12. *(Open — day-one verification.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-11** — A second CSV at `delivered`. *(Open.)*
- **OQ-12** — Regeneration and batch membership. **Now urgent — folded into Q8.**
- **~~OQ-17~~** — **SETTLED by D22:** frozen, explicitly, no editing.
- **OQ-18** — "Default something" for blank Shot Ideas. Proceeding on D18.1 (not generated).
- **OQ-19 — Correction batches confuse `getLatestBatch`.** T9.1. Direct cost of D22's
  freeze. *(Raised Round 2, Q7.)*

---

## A11 — Arising from D25–D27 (Round 2, Q8)

**A11.1 — Post-delivery corrections are rare enough to justify routing them to an engineer.** `HELD`
D25.2 makes the remedy a tech request. Acceptable at their scale and cadence, and deliberately
uncomfortable so the frequency is visible. **Watch for:** more than one tech request per
batch — that is the evidence D25.4 asks for before loosening.

**A11.2 — Regeneration will be used as an escape hatch, not as a default loop.** `HELD — AT RISK`
> *Question I'd ask Ellie:* When a shot is close but not right, would you tweak it — or just
> say no and move on?

Underpins T10.3. If she regenerates habitually, the review turns from a scroll into a
workshop and the 120-image batch becomes unmanageable. **Detectable** — median regenerations
per batch is a one-line query against the event log.

**A11.3 — Editing a prompt is something Ellie will actually want to do.** `HELD — CONTESTED`
D26.2 hands her the machine's prompt to rewrite. This is the same tension as A10.2: it is
either useful control or the prompt-engineering job she never asked for, depending on how it
feels in her hand. **The framing in T10.3 is the mitigation** — regenerate must read as
*"none of these work"*, not as *"tune this."*

**A11.4 — `1:1` is adequate for product pages, social, and campaign use.** `HELD`
D27. Square crops predictably and is the safest single choice, but it is nobody's *ideal*
ratio for a product page hero or a story format. Accepted as a v1 simplification; the brief
names three destinations with genuinely different shapes.

---

## Open questions — updated (Round 2, post Q8)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-3** — Command surface ranking against build time. *(Open.)*
- **OQ-7** — Mute/notification behaviour, F4.12. *(Open — day-one verification.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-11** — A second CSV at `delivered`. *(Open.)*
- **OQ-12** — **Now answered in principle by D26** (regeneration replaces in place, batch size
  fixed). Mechanics open below.
- **OQ-18** — "Default something" for blank Shot Ideas. Proceeding on D18.1.
- **~~OQ-19~~** — **SETTLED by D25:** tech request, deliberate friction.
- **OQ-20 — Does a regenerated image replace the original in place, or append?** T10.2
  argues strongly for replace. *(Raised Q8.)*
- **OQ-21 — Filename versioning.** If regeneration replaces in place, the label/filename must
  version (`…_01_v2.jpg`) or the same name refers to two different images — F3.4 in miniature.
  *(Raised Q8.)*
- **OQ-22 — Is regeneration capped, and is spend surfaced?** T10.1 — the first mechanism that
  spends without passing D14's gate. *(Raised Q8.)*
- **OQ-23 — Can an approved image be regenerated?** Should be blocked, or approval must be
  cleared first. Otherwise D10.4's integrity guarantee has a hole. *(Raised Q8.)*

---

## A12 — Arising from D30–D32 (architecture)

**A12.1 — A single worker process is sufficient, and only one will ever run.** `HELD`
T11.2. A job table without row-level locking is only safe with one consumer. **This is a
correctness assumption disguised as a deployment detail** — if a platform ever autoscales the
service to two instances, jobs will double-execute and images will double-post.

**A12.2 — Mid-batch interruption is a slowness event, not a data-loss event.** `HELD`
Justified by F7.1 (expired URLs are re-pollable) plus D30.5 (intent written before spend).
The residual loss is F7.5's orphaned generation at $0.1030. **Alexander's framing accepted:
the 1-hour window only matters if the system is broken *and* the outage outlasts it — an edge
case worth knowing about, not designing around.**

**A12.3 — Slack will accept buttons on a file-share message.** `HELD — UNVERIFIED, LOAD-BEARING`
F8.2. D3.2 and D32 both depend on it. Fallbacks exist (F8.2) but each costs a decision
already made. **Day-one verification.**

**A12.4 — Serving images through the app is acceptable bandwidth-wise.** `HELD`
D31.4 routes image bytes through the always-on service rather than a public bucket or CDN, in
exchange for `Content-Disposition` filename control. Fine at this volume; the first thing to
move behind a CDN if it ever matters.

---

## Open questions — updated (Round 2, post Q12)

- **OQ-1** — Delegated approval rights vs. Ellie's final word. *(Open.)*
- **OQ-3** — Command surface and build-order ranking. *(Open — next.)*
- **OQ-7** — F4.12 mute/mention behaviour. *(Open — day-one verification.)*
- **OQ-8** — `/status` filtering at scale. *(Open.)*
- **OQ-11** — A second CSV at `delivered`. *(Open.)*
- **OQ-18** — "Default something" for blank Shot Ideas. Proceeding on D18.1.
- **OQ-24 — F8.2: do buttons work on a file-share message?** *(Raised Q12 — day-one
  verification, load-bearing for D3.2 and D32.)*

---

## A13 — Arising from D34–D37 (closing decisions)

**A13.1 — The brand aesthetic is recoverable from the CSV's own columns.** `HELD`
D34.3. Colour/Finish and Material across 40 rows describe a coherent identity (muted earth
tones, natural materials, handmade home goods). **Verifiable in the first generation** — if
shots come back looking generic, the prefix is not carrying enough.

**A13.2 — A blank Shot Idea may be intentional.** `HELD`
> *Question I'd ask:* When a row has no shot idea, does that mean "not yet" or "the plain
> photo is fine"?

D36.4. **This is a genuinely ambiguous signal and the design now treats it as meaningful
rather than as absence.** If it is really just an oversight, D36 spends Ellie's attention on
24 non-decisions per batch (T12.1).

**A13.3 — Pass-through images are worth a human decision.** `HELD — CONTESTED`
Recommended in OQ-26 for consistency and to preserve D8's guarantee. Contestable: they are
already the live product photo. This is the first place to relax if review load becomes the
binding constraint (F9.5).

**A13.4 — The approved-CSV will actually be pasted back into the master sheet.** `HELD — AT RISK`
D35's entire value rests on this. Nothing enforces it and nobody was asked. **Watch for:**
whether anyone uses it. If not, the sheet stays broken and the fix was theatre.

---

## Open questions — final state

**Settled across the session:** OQ-2, OQ-4, OQ-9, OQ-10, OQ-13, OQ-14, OQ-15, OQ-16, OQ-17,
OQ-19, OQ-1, OQ-3, OQ-6, OQ-11, OQ-18, OQ-5, OQ-12.

**Remaining — day-one verifications (facts, not decisions):**
- **OQ-7 / F4.12** — does a muted channel still badge on @-mention? Decides whether T3.4's
  flood mitigation works at all.
- **F4.5** — do buttons work in a posting-restricted channel? Decides D2.1.
- **OQ-24 / F8.2** — do buttons work on a file-share message? Decides D3.2 + D32 together.

**Remaining — deferred by choice, with reasoning recorded:**
- **OQ-8** — `/status` filtering at scale. Deferred with `/status` itself (D33).
- **OQ-20 – OQ-23** — regeneration mechanics. Parked with D26 (D28).
- **OQ-25 — prompt versioning**, required if D34.6's editable system prompt is built (T12.2).
- **OQ-26 — are pass-through images reviewed or auto-approved?** Recommendation: reviewed.
  First thing to relax under review-load pressure (T12.1, F9.5).
