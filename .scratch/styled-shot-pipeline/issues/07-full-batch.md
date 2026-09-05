# 07: A whole batch

**What to build:** An entire catalog export runs. Every row with a Shot Idea gets its
candidates; every row without gets its original photo passed through untouched and free. The
channel fills with a reviewable stream and the reviewer is notified once, not a hundred times.

Generations complete out of order, so posting is a separate paced stage from generation:
candidates are buffered per product and posted together, in order. Adjacency is what makes the
stream reviewable at all.

Resilience at batch scale belongs here: a batch interrupted halfway must resume, and the
submitter must discover the account's real ceilings rather than depend on a configured guess.

**Blocked by:** 06

**Status:** done (2026-09-04)

- [x] Every row carrying a Shot Idea is generated; the batch runs to completion unattended
- [x] A row with a blank Shot Idea has its original photo downloaded, stored, named and posted with no generation call and no cost
- [x] A pass-through message states plainly that the photo is the original and no shot idea was given, rather than showing an empty prompt
- [x] A pass-through filename is distinguishable from a styled one, so the web person never has to guess whether a photo was modified
- [x] A product's candidates appear adjacently and in index order regardless of the order in which they completed
- [x] Posting is paced to stay within the messaging limit and does not stall the pipeline
- [x] A single summary message mentions the reviewer; the candidate stream posts without mentions
- [x] The summary reports the batch's image count and cost
- [x] Killing the service mid-batch and restarting it resumes the batch and finishes it, with no image submitted twice outside the documented crash window
- [x] Concurrency and per-minute ceilings are read from response headers and respected adaptively, starting conservative
