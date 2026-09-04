# 04: CSV ingest — modal, validation, and a recap that costs nothing

**What to build:** A slash command opens a modal with a file input restricted to CSV. Dropping
the catalog export in produces a message in the channel reporting how many rows were found,
how many carry a Shot Idea, how many do not, how many images that implies, and what it will
cost — with a button to start the batch.

Nothing is generated and nothing is spent. This is the answer to the founder's worry about
burning budget on work that will be rejected: not a smaller bill, but seeing the bill first.

**Blocked by:** 01, 03

**Status:** done (2026-09-04)

- [x] A slash command opens a modal carrying instructions and a file input restricted to CSV
- [x] The modal opens immediately on the command, before any validation work
- [x] The uploaded file is parsed and a batch is created with an identifier at upload time
- [x] Structural problems are rejected with a message naming what was expected, what was found, and what to change — readable by someone who is not an engineer
- [x] Content quirks (a blank cell, an unusual price format, an unparseable note) are reported and accepted, not rejected
- [x] The recap reports total rows, rows with a Shot Idea, rows without, the resulting image count, and the estimated cost
- [x] The recap carries a button that starts generation
- [x] Uploading makes zero generation calls and incurs zero cost
- [x] The CSV never appears in the review channel
