# 11: Catalog exports

**What to build:** Two catalog exports come back out. One is emitted when a batch becomes ready
for review, appending viewable links for the images that were generated. One is emitted on
confirmation, recording which images were approved.

Every other part of this system routes around the spreadsheet. These are the only artefacts
that write back to the thing the team actually lives in — and the reason nobody can currently
say which requests are done is that the sheet has nowhere to record it.

**Blocked by:** 07, 09

**Status:** ready-for-agent

- [ ] When a batch becomes ready for review, a CSV is produced containing the original rows plus viewable links to the generated images
- [ ] It is produced only after the images are stored, so no link in it can be dead on arrival
- [ ] Image links are permanent and unguessable, so the file does not rot in an inbox
- [ ] On confirmation, a CSV is produced recording which images were approved
- [ ] Both are shared into the channel
- [ ] A product with several approved images is represented without cramming multiple links into one cell
- [ ] Neither export exposes a discarded image
