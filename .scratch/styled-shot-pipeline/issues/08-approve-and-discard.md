# 08: Approve and Discard

**What to build:** The buttons work. Tapping Approve or Discard records the decision, and the
message visibly changes so the stream reads as a work queue rather than an undifferentiated
archive of candidates.

Approving one candidate does not discard its siblings — a completed request is two to three
approved images, so keeping two of three is a normal outcome, not a conflict.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Approving moves the image into the approved relation; discarding moves it into the discarded relation
- [ ] Changing a decision moves the row between relations, transactionally, and both moves are recorded
- [ ] Every action appends an event carrying the acting user and a timestamp
- [ ] The message is updated in place so a decided image visibly reads as approved or discarded
- [ ] Approving one candidate leaves its siblings untouched
- [ ] A user without approval rights has their action rejected and is told why
- [ ] Approval rights are enforced server-side against the acting user reported by the platform, not against anything the client sends
- [ ] Discussion in an image's thread is unaffected by decisions on it
