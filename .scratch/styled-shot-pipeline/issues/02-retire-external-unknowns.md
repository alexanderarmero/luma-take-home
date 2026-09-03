# 02: Retire the external unknowns

**What to build:** Written, tested answers to four questions about external platforms. Each of
the first three can invalidate a decision the review surface is built on, and discovering any
of them later means rebuilding the posting layer rather than adjusting it. The fourth replaces
a guess with a number.

This is a spike. It delivers answers, not behaviour — deliberately, because every ticket after
it is shaped by what it finds.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Answered: do interactive buttons work in a channel where top-level posting is restricted? (Decides whether the review channel can be restricted at all)
- [ ] Answered: does a direct mention still reach a member who has muted the channel? (Decides whether the one-mention-per-batch notification strategy works, or whether a direct message to the reviewer is needed instead)
- [ ] Answered: can interactive blocks carrying buttons be attached to a message that shares an uploaded file? (Decides whether image bytes live in Slack or are referenced from our storage — the two fallbacks are recorded in the approach documentation)
- [ ] Recorded: the account's real per-minute and concurrent-job generation ceilings, read from the rate-limit headers on one cheap generation
- [ ] Each answer is written down where the implementation tickets can find it, alongside which decision it confirms or overturns
- [ ] If any answer overturns a decision, the affected approach documentation is updated before the next ticket starts
