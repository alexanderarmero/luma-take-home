# 12: Full status

**What to build:** The status command grows from counts into the founder's requirement and the
reviewer's re-entry point: what has been decided, what has not, where to find it, what it cost,
and which products came out short.

It serves three purposes at once. The reviewer uses it to resume a review she did not finish in
one sitting. The founder uses it to see where things stand without asking her — which is her
entire stated ask. And it is the recovery path for the one failure the completion rule creates:
a single un-actioned image silently holding up a whole batch.

**Blocked by:** 03, 09

**Status:** done (2026-09-05)

- [x] The command lists images by name with their state — pending, approved, or discarded
- [x] Each entry deep-links to its message, so an outstanding image is one tap away
- [x] The listing can be filtered to what is still pending
- [x] A batch that is fully actioned but not yet confirmed is reported as awaiting confirmation, described by what is needed next rather than by what has happened
- [x] The accrued cost of the batch is reported
- [x] Products that finished with fewer than two approved images are reported, so under-delivery is visible rather than silent
- [x] Output stays readable at drop scale rather than becoming an unbroken wall of entries
- [x] Counts are derived from committed state, never from in-memory counters, so the command cannot report work that did not happen
