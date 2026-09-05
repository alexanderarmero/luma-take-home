# 13: Retry a failed or rejected shot

**What to build:** *(not yet specified — needs a grilling session first)*

A way to get another attempt at a shot without re-running the whole catalog.
Today v1 has no answer to a bad generation: if all three candidates for a
product are wrong, or one is content-moderated and never arrives, the only
recourse is to fix the Shot Idea in the spreadsheet and upload the whole file
again. That is a full round trip through ingest, generation and review for one
product.

**Initial idea:** a Retry button, alongside Approve and Discard.

**Blocked by:** v1 being delivered. This is deliberately *after* the first real
batch, not before — see below.

**Status:** needs-triage

---

## Why this is deferred rather than missing

Regeneration was designed in full during the original design session and cut on
purpose. The reasoning is worth keeping, because it decides *when* to build
this rather than *whether*:

- A third button changes the review from a **triage** — yes or no, one pass,
  top to bottom — into an **editing session**, where any image can pull the
  reviewer into a modal, a prompt rewrite, and a wait. At 120 images, even a
  10% retry rate adds a dozen round trips to what was meant to be a scroll.
  That is a change to the core interaction, not an addition to it.
- The rejection rate that would justify it is **unknown**. Nobody could supply
  it during design, and one real batch will. Shipping the loop and measuring is
  cheaper than shipping the fix and guessing.

**The signal that it has become urgent:** count how many products finish a real
batch with fewer than two approved shots. Low single digits means the deferral
was right. Anything higher and this moves from "next" to "now".

## What already exists to build on

Do not start from a blank page. The design session settled the mechanics and
the reasoning is recorded:

- **`Approach/Decisions.md` → D26** — regeneration with an editable prompt,
  specified in full and marked DEFERRED. Includes why it does not violate the
  integrity principle: regeneration happens *before* approval, so the image
  that ships is still the image that was approved.
- **`Approach/Tradeoffs.md` → T10.1–T10.3** — the costs. T10.1 is the sharpest:
  regeneration is the first mechanism that spends money without passing the
  ingest recap's gate. Financially trivial, but it is a hole in the promise
  made to Maya, and the promise was the point.
- **`Approach/Assumptions.md` → OQ-20 … OQ-23** — four mechanics parked rather
  than resolved:
  - **OQ-20** replace the image in place, or append a new one?
  - **OQ-21** if replaced, the filename must version (`…_01_v2.jpg`) or the
    same name means two different images at two different times — which is the
    failure this product exists to prevent, reproduced inside our own system.
  - **OQ-22** is retrying capped, and is the running spend visible?
  - **OQ-23** can an *approved* image be retried? It must not be, or the
    integrity guarantee has a hole.

## Open questions for the grilling session

Beyond the four above:

1. Is Retry a **third button** on every image, or a command aimed at a product
   that came up short? The second keeps the review a triage.
2. Does retrying **edit the prompt**, or re-roll the same one? Editing needs
   the prompt to be visible and mutable; re-rolling is one tap.
3. What is the honest signal that a Shot Idea — rather than the generation — is
   the problem? Repeated retries on one product mean the *idea* is wrong, and
   the useful response is to say so rather than keep spending.
4. Does this interact with the batch completion gate? A retried image is no
   longer settled, so a `complete` batch would re-open. Does that reverse the
   `ready for review` announcement?

## Acceptance criteria

*(To be written after the grilling session. Recording them now would be
guessing at a design that has not been made.)*
