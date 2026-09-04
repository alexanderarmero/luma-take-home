# 02: Retire the external unknowns

**What to build:** Written, tested answers to four questions about external platforms. Each of
the first three can invalidate a decision the review surface is built on, and discovering any
of them later means rebuilding the posting layer rather than adjusting it. The fourth replaces
a guess with a number.

This is a spike. It delivers answers, not behaviour — deliberately, because every ticket after
it is shaped by what it finds.

**Blocked by:** 01

**Status:** done (2026-09-04)

- [x] Answered: **YES** — do interactive buttons work in a channel where top-level posting is restricted? (Decides whether the review channel can be restricted at all)
- [x] Answered: **YES, it badges** — does a direct mention still reach a member who has muted the channel? (Decides whether the one-mention-per-batch notification strategy works, or whether a direct message to the reviewer is needed instead)
- [x] Answered: **YES** — can interactive blocks carrying buttons be attached to a message that shares an uploaded file? (Decides whether image bytes live in Slack or are referenced from our storage — the two fallbacks are recorded in the approach documentation)
- [ ] Recorded (outstanding): the account's real per-minute and concurrent-job generation ceilings, read from the rate-limit headers on one cheap generation
- [x] Each answer is written down where the implementation tickets can find it, alongside which decision it confirms or overturns
- [x] No answer overturned a decision —, the affected approach documentation is updated before the next ticket starts

## Outcome

All three passed. **No decision was overturned**, so D2.1 (restricted review channel),
T3.4/T3.6 (one summary mention into a quiet stream) and D3.2 + D32 (image bytes in Slack,
one message per decision) all stand as designed. Every specified fallback is unnecessary.

Still outstanding: the rate-limit ceiling, which needs one paid generation and is better
folded into ticket 05 where the first real generation happens anyway.
