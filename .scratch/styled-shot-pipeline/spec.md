# Spec: Styled Shot Pipeline

Status: ready-for-agent

---

## Problem Statement

A six-person home-goods brand sells ~300 products through their own site. Every product has
exactly one photo: the product on a white background. They want **styled photos** — the
product in a real scene — because product pages convert better with them, social needs them,
and the Q4 campaign runs on them. Most products have never had one.

They cannot get them made fast enough to matter, and the process they do have loses track of
its own output:

- Requests are written into a **Shot Idea** column in a shared spreadsheet — sixteen of them
  right now, some months old. Others were a Slack message everyone approved and nobody wrote
  down.
- Two or three times a year, Ellie reconstructs the wishlist from the sheet, Slack scrollback
  and her inbox, and sends it to a freelance photographer. Candidates come back weeks later
  by email — some attached, some as links, once as a zip named `final_v2_REAL_final`.
- Ellie posts her favourites into Slack for opinions and her pick is the decision. **But the
  pick lives wherever the conversation happened** — a thread, or a reply buried in an email
  chain.
- Someone copies the winners into a shared Drive folder under whatever filename the camera
  gave them. Last year the web person shipped the wrong `IMG_43xx.jpg` to a product page and
  nobody noticed for three weeks.
- The web person uploads from that folder weekly, *"usually after asking in Slack which files
  are actually final."*

**Nobody can say which of the sixteen requests are done.** The spreadsheet has no column in
which doneness could be recorded, so the question is not merely unanswered — it is
unanswerable.

Two constraints bound any solution. Ellie: *"it has to work from my phone, and I don't want
to install anything new."* And the team already rejected the obvious answer — a
creative-automation tool with a dashboard that nobody logged into after week one.

## Solution

**A Slack app, and nothing else.** No dashboard, no web app, no login, no install.

The rejected tool failed because it required *pull* — someone had to remember to go there.
Slack is push, and it is already where the decision happens: the existing process routes
favourites into Slack for opinions. The design rule is therefore: **the work comes to Ellie,
and nothing new gets installed.**

The loop, from the team's point of view:

1. **Upload.** A slash command opens a modal; drop the catalog export in. It never touches
   the review channel.
2. **Recap.** The system validates the file and reports back — how many rows, how many have a
   Shot Idea, how many don't, how many images that means, **and what it will cost.** Nothing
   has been spent. One button starts the batch.
3. **Generate.** Each Shot Idea becomes two to three *distinct* prompts, each rendered against
   that product's own white-background photo. Rows with no Shot Idea have their original photo
   passed through untouched, for free.
4. **Review.** One Slack message per image: the picture, its filename, the prompt that made
   it, and Approve / Discard. Each message has its own thread, so *"no, too staged"* lands on
   the image it is about.
5. **Complete.** When every image has a yes or a no, the batch completes automatically and a
   confirm button appears.
6. **Deliver.** Confirming freezes the batch. The web person then runs one command and
   receives a zip — every file named for its SKU and shot idea. No asking Slack which ones
   are final.

Two catalog exports come back out: one recording what was **generated**, one recording what
was **approved**. The second is the artefact that repairs the source spreadsheet.

## User Stories

**Ellie — product content, reviews and approves**

1. As Ellie, I want to review styled shots on my phone without installing anything, so that adopting this costs me no new habits.
2. As Ellie, I want the shots to arrive in a Slack channel I already have, so that I do not have to remember to go anywhere.
3. As Ellie, I want to see each image full-size in the message itself, so that I can judge it without tapping into anything.
4. As Ellie, I want an Approve and a Discard button on every image, so that a decision is one tap.
5. As Ellie, I want to approve more than one candidate for the same product, so that a good pair both get used rather than forcing me to pick a single winner.
6. As Ellie, I want a decided image to visibly change to approved or discarded, so that scrolling shows me what I have already handled instead of an undifferentiated wall.
7. As Ellie, I want each image to have its own discussion thread, so that the team's opinions attach to the shot they are about.
8. As Ellie, I want to be able to ask which images I have not decided yet, so that I can resume a review I did not finish in one sitting.
9. As Ellie, I want the candidates for one product to appear together and in order, so that comparing them is a short scroll rather than a search.
10. As Ellie, I want to see the prompt that produced each image, so that I understand what the system did with my words.
11. As Ellie, I want a single notification when a batch is ready rather than one per image, so that a drop does not flood my phone.
12. As Ellie, I want to declare a review finished with one action, so that the team knows the set is settled.
13. As Ellie, I want to be told clearly that confirming cannot be undone, so that I am not surprised by a decision I cannot reverse.
14. As Ellie, I want the confirm control to appear when I finish rather than at the top of a long stream, so that I do not have to scroll back to find it.
15. As Ellie, I want my approval to be the decision, so that the process matches how it already works.
16. As Ellie, I want a blank Shot Idea to give me the plain product photo to approve, so that leaving one blank on purpose still produces something usable.

**Maya — founder, wants visibility and budget control**

17. As Maya, I want to see how far along a batch is without asking Ellie, so that I am not blocked on one person for a status answer.
18. As Maya, I want to see what a batch will cost before it runs, so that I am not afraid of spending money on work that will be rejected.
19. As Maya, I want to see what a batch has actually cost, so that spend is never invisible.
20. As Maya, I want to know which products finished without enough approved shots, so that I can tell whether the drop is genuinely ready.
21. As Maya, I want a catalog export listing the generated images, so that the sheet reflects what was made.
22. As Maya, I want a catalog export listing the approved images, so that the sheet can finally record which requests are done.
23. As Maya, I want to upload next month's export the same way as this month's, so that the system is reusable rather than a one-off.
24. As Maya, I want to launch a forty-product drop with styled shots, so that the first real test is the drop itself.
25. As Maya, I want the generated shots to look like our brand, so that they do not read as generic stock photography.

**The web person — publishes to the site**

26. As the web person, I want to fetch the approved images myself with one command, so that I do not have to ask anyone which files are final.
27. As the web person, I want every file named for its SKU and shot idea, so that I can tell at a glance what I am uploading.
28. As the web person, I want to receive only approved images, so that I cannot accidentally ship one that was rejected.
29. As the web person, I want to receive only batches someone has confirmed, so that I cannot pull a half-reviewed set.
30. As the web person, I want a pass-through image to be distinguishable from a styled one by its filename, so that I never have to guess whether a photo was modified.
31. As the web person, I want the file I upload to be exactly the file that was approved, so that nothing has been re-rendered or substituted in between.

**The team — participates in the decision**

32. As a team member, I want to comment on a specific shot, so that my opinion is attached to the right image.
33. As a team member, I want the review channel to stay free of unrelated chatter, so that scrolling it remains a viable way to review.
34. As a team member, I want to see what was approved without asking, so that the decision is visible rather than private.

**Whoever runs a batch**

35. As the person uploading, I want a malformed file rejected with a message naming what was expected and what was found, so that I can fix it without an engineer.
36. As the person uploading, I want content quirks tolerated rather than rejected, so that a real spreadsheet export does not bounce over a blank cell.
37. As the person uploading, I want validation to happen before any spending, so that a bad file costs nothing.
38. As the person uploading, I want to be told how many rows have no Shot Idea, so that I know what the batch will and will not style.

**Operating the system**

39. As an operator, I want a batch interrupted mid-run to resume where it stopped, so that a restart costs time rather than work.
40. As an operator, I want generation failures classified into retryable and terminal, so that the system retries what can succeed and stops burning attempts on what cannot.
41. As an operator, I want rate limits discovered and respected at runtime, so that the system adapts rather than depending on a configured guess.
42. As an operator, I want every image kept, including discarded ones, so that a post-delivery correction is recoverable by hand.
43. As an operator, I want the image model to be a configuration value, so that a cost change is a config edit rather than a code change.
44. As an operator, I want to know what the pipeline is doing right now by querying it, so that diagnosing a stall does not require reading logs.

## Implementation Decisions

### Surface

- **Slack is the entire product surface.** No web application is built. Every interaction —
  ingest, review, decision, confirmation, retrieval, status — happens in Slack.
- **Slack is the interface, never the datastore.** Approval state lives in our own database;
  the channel renders it. Losing Slack would lose the interface and no decisions.
- **A dedicated review channel with top-level posting restricted, thread replies open.**
  Restriction keeps the review stream scannable; open threads preserve the discussion the
  existing process depends on.
- **Identity comes from Slack.** Interaction payloads carry the acting user, so approval
  rights are enforced server-side against a configured Slack user ID. No sessions, no magic
  links, no auth system.

### Ingest

- Ingest is a **slash command that opens a modal** carrying a file input restricted to CSV.
  The file never enters the review channel.
- **Validation is deterministic. No language model parses or repairs the file.** A silent
  restructuring between what the customer sent and what was processed would reintroduce the
  category of ambiguity this product exists to remove.
- **Structure is enforced; content quirks are tolerated.** Missing required columns are a
  rejection. A blank cell, an odd price format, or an unparseable note is reported, not
  refused.
- **Errors must name what was expected, what was found, and what to change.** The reader is
  not an engineer.
- Upload **never generates**. It validates and returns a recap — row count, how many rows
  carry a Shot Idea, how many do not, the resulting image count, and the estimated cost. A
  button on the recap starts the batch.

### Batches

- **One upload is one batch**, identified by a simple incrementing integer assigned at upload
  time.
- **A separate pointer records the latest delivered batch.** Retrieval reads through the
  pointer, never through "highest batch id" — so a batch that was uploaded but never
  generated, or generated but never confirmed, is structurally unreachable by the web person.
- A batch **completes automatically** once every image in it has been actioned. Completion is
  a computed fact: the count of approved plus the count of discarded equals the batch size.
- **Confirmation is manual and separate.** Completion means *"everything has been decided"*;
  confirmation means *"I am finished, publish it."* Only a human can assert the second.
- **A confirmed batch is immutable.** No further approvals, discards or reversals. Corrections
  are a new batch, not an edit — the record is frozen, the outcome is not.

### Generation

- Generation uses image editing with the product's own white-background photo as the source,
  so the real product is preserved rather than re-imagined.
- **Each candidate gets its own distinct prompt** — deliberately divergent readings of the
  same Shot Idea — rather than repeated samples of one prompt. Comparison is only meaningful
  if the options genuinely differ.
- **Two to three candidates per product.**
- **All output is square.** One aspect ratio for now; multi-format output would compete with
  creative variety for the same candidate slots.
- **The higher-quality image model is used from the start**, and the model is a configuration
  value so cost pressure has a one-line answer.
- **A blank Shot Idea passes the original photo through**, unmodified and at zero cost,
  following the identical path — downloaded, stored, named, posted, reviewed. A blank may be
  intentional, and a batch that covers every product delivers a complete set.

### Prompt translation

- A language model translates each human Shot Idea into generation prompts. Shot Ideas are
  written as what a person pictures, not as instructions to an image model.
- **The stable system prefix carries the brand's own aesthetic, derived from the catalog
  itself** — its palette and materials — together with the team's existing Shot Ideas as tone
  calibration. This prefix is identical across every product in a batch and is cached.
- **The output shape is forced with structured outputs**, not with assistant prefill.
- **The `Notes` column is not read.** Measured against the catalog, feeding raw notes into
  prompts corrupts roughly twice as many rows as it improves — the column mixes styling
  constraints, scheduling flags and multi-product requests that a single-product generator
  cannot interpret. The rule instead: *if it needs to be in the shot, it goes in Shot Idea.*

### Review presentation

- **One top-level message per candidate image**, not a thread per product and not a contact
  sheet. Threads reduce scrolling but raise viewing cost; a deliberate tap repeated a hundred
  times is worse than a longer passive scroll on a phone.
- Each message carries the image, its **deterministic filename**, the prompt that produced it,
  and Approve / Discard controls. A pass-through message states plainly that the photo is the
  original and no shot idea was given.
- **Messages are updated in place on decision**, so the stream reads as a work queue rather
  than an archive.
- **A product's candidates are posted adjacently and in index order.** Because generations
  complete out of order, posting is a separate paced stage from generation, buffered per
  product.
- **A single summary message mentions the reviewer**; the candidate stream is posted without
  mentions, so a batch is one notification rather than a hundred.
- **Image bytes are uploaded into Slack** rather than referenced from our storage, so the
  channel — the permanent record — does not break if our storage does.

### State model

- **No status column on the images relation.** Decision state is membership: an approved
  relation and a discarded relation. Approved means present in one, discarded means present
  in the other, pending means present in neither.
- **An append-only event log records every action** with the acting user and a timestamp. It
  is audit and provenance only; nothing operational reads it. Membership can be rebuilt from
  it.
- Changing a decision moves the row between relations. Because no downstream effect fires
  before confirmation, **reversal before confirming has no blast radius.**

### Pipeline

- **A single always-on service** hosts the Slack endpoints and runs the pipeline worker. The
  pipeline is inherently long-running and paced; a serverless decomposition would turn it into
  a chain of scheduled invocations, each a place a batch can silently stall.
- **A job table in the database, not a queue service.** It supplies restart-safety, retry
  counts and inspectability from infrastructure already required, and makes *"what is the
  pipeline doing"* a query.
- **One job row per candidate image**, so recovery resumes at image granularity.
- **Intent is written before money is spent.** The job row commits before the generation
  request is submitted, because the image API offers no idempotency key. A crash between
  acceptance and persistence orphans one paid generation — the safe direction to fail.

  The per-image stage machine, one committed transaction per transition:

  ```
  pending_submit → submitted → completed → stored → posted
  ```

  `stored` means the bytes are in our object store with a recorded checksum; nothing is posted
  to Slack before that.

- **Retry classification is taken from the provider's documented taxonomy**, not invented.
  Rate limiting, upstream unavailability, ingestion failures, internal model errors and
  missing outputs are retryable; content moderation, oversized or corrupt inputs, invalid
  requests and exhausted funds are terminal.
- **Rate limiting is adaptive.** The concurrency and per-minute ceilings are not published;
  the submitter starts conservative, reads the remaining-quota header from each successful
  submission, and backs off on refusal, distinguishing a per-minute limit from a concurrency
  limit by the response body.
- **Generated image URLs expire in an hour but are recoverable** by re-polling, so an outage
  outlasting the window costs time, not paid work.

### Storage and naming

- **Objects live in S3-compatible storage behind a configurable endpoint**, so the provider is
  a provisioning choice rather than a code choice.
- **Objects are keyed by a random identifier**, giving a permanent unguessable URL; **the
  meaningful filename is served as a content disposition.** The URL is unguessable and the
  downloaded file is still named correctly — these are different fields, not a compromise.
- **Downloaded once, checksummed, stored, never re-encoded.** One canonical object per image.
- **The filename shown in Slack is the filename delivered in the export.** One identifier end
  to end, with no translation step in which a substitution could occur.
- **Discarded images are retained indefinitely.** They are the only recovery path for a
  post-delivery correction, given that batches are frozen.

### Delivery

- A command returns the latest delivered batch as a **zip of the approved images**, named
  deterministically.
- **Discarded images must be unreachable through any retrieval path.** An engineer must be
  able to reach one by hand; the product must never hand one out.
- **Two catalog exports.** One is emitted when a batch becomes ready for review, appending
  viewable URLs for the generated images. One is emitted on confirmation, recording what was
  approved — the artefact that lets the source spreadsheet finally record doneness.

### Vocabulary

The word **"done"** is not used in anything a human reads; it is the one question the team
currently cannot answer, and it is overloaded. The states are:

`ready for review` → `pending` / `approved` / `discarded` (per image) → `complete` (all
actioned) → `delivered` (confirmed).

## Testing Decisions

### What makes a good test here

A good test **drives the system from its real entry points and asserts on what it did to the
outside world** — what was asked of the image API, what was posted to Slack, what bytes were
stored, and what state the database now holds. It never reaches inside to patch an internal
module, and it never asserts on the shape of an intermediate value that a refactor should be
free to change.

### The seam

**One substitution boundary, at the outbound port layer**, exercised from the highest inbound
point.

- **Drive** through the HTTP application using a test client (slash commands, view
  submissions, interaction payloads) and by ticking the pipeline worker. Routing, signature
  verification, validation, prompt assembly, the state machine and all database access run for
  real.
- **Substitute** four collaborators together at a single composition root: the image
  generation client, the Slack client, the object store, and the prompt writer. Tests
  construct the application with fakes rather than patching modules.
- **Do not substitute the database.** Tests run against a real instance. Several invariants
  *are* queries — retrieval through the delivered pointer, completion as two counts against a
  batch size, decision state as membership — and faking the database would fake exactly the
  things worth asserting.

This is the highest available seam and the fewest possible substitution points. There is no
prior art in this repository; it is greenfield.

### Scenarios to cover

- Upload of a well-formed export produces a recap with correct counts and cost, and makes
  **zero generation calls**.
- Upload of a structurally invalid export is rejected with a message naming the missing
  columns; content quirks are reported and accepted.
- Pressing generate creates one job per candidate, submits the expected number of requests,
  and posts candidates **adjacent and in index order** despite completions arriving out of
  order.
- A row with a blank Shot Idea is stored and posted with the original photo and **no
  generation call is made**.
- Approving and discarding move rows between the membership relations and update the message
  in place.
- A batch completes automatically on the final action and the confirm control is posted at
  that moment.
- Confirming advances the delivered pointer, marks the batch delivered, and causes any
  subsequent decision attempt to be rejected.
- A user without approval rights has their decision rejected.
- Retrieval returns exactly the approved set of the latest delivered batch, with the expected
  filenames, and **no discarded image is reachable**.
- Retrieval before confirmation returns the previous delivered batch, never the batch in
  progress.
- The worker is interrupted mid-batch and restarted: it resumes, and no image is submitted
  twice except in the documented crash window.
- Retryable failures are retried with backoff; terminal failures stop and surface. A refusal
  is distinguished as a per-minute limit or a concurrency limit by the response body.
- **Byte identity:** the object stored, the bytes uploaded to Slack, and the file in the
  export share one checksum.
- Products finishing with fewer than two approved images are reported.

### Verification the tests cannot do

Three platform behaviours must be confirmed against a real Slack workspace before the
implementation is trusted, because each invalidates a decision if false: whether interactive
buttons work in a channel with posting restricted; whether a direct mention still reaches a
member who has muted the channel; and whether interactive blocks can be attached to a message
that shares an uploaded file. These are manual checks, not automated tests, and they come
first.

## Out of Scope

- **Publishing to the product page.** There is no write access to their site and the brief
  never describes how publishing works. The last mile stays human.
- **Writing to the shared Drive folder.** The folder is the defect, not the destination — no
  naming convention, no index, no way to distinguish shipped from unshipped, and the web
  person already breaks out of it to ask Slack what is final. Writing to it would create a
  second place claiming to know what is final, inside a system whose defining problem is
  disagreement about what is final. Retained in the architecture as a write-only mirror; not
  built.
- **Regeneration.** Fully designed and deliberately deferred: a third control changes review
  from a triage pass into an editing session, and the rejection rate that would justify it is
  unknown until a real batch supplies it.
- **Language-model-authored Shot Ideas for blank rows.** Cut on time.
- **Multi-product grouped shots.** The team has already asked for these — shooting a blanket
  with the mugs, a bathroom set with the towels. They need several source images composited
  into one scene and a grouping concept the export has no column for.
- **A permissions management command.** Approval rights are a single configured Slack user ID.
- **Multi-format output** at several aspect ratios for different destinations.
- **Live spreadsheet synchronisation.** Nobody asked for it; exports are the interface.
- **Bulk actions of any kind.** Every image is actioned individually, which is what guarantees
  no set ships containing an image nobody looked at.

## Further Notes

**Build order matters, because the risk is front-loaded.** The three platform verifications
above, a cheap probe to read the real rate-limit ceiling, and a deployed skeleton come first —
each is minutes of work and each can invalidate a load-bearing decision. Discovering any of
them late invalidates the posting layer rather than a detail of it.

**The status command is scheduled last and that is the known risk.** It serves three purposes:
the reviewer's re-entry into a long stream, recovery when a single un-actioned image blocks a
batch, and the founder's entire stated requirement — seeing where things stand without asking.
**If it is cut for time, one of the two named stakeholders gets nothing.** A crude version
built early — counts grouped by state over a schema that already exists — doubles as developer
observability while the rest is built and grows into the real feature for free.

**What this does not solve.** It automates the photographer. It does not automate the
reconstruction of the wishlist — the part where someone works out what to shoot in the first
place. With twenty-four of forty rows blank today and next month's drop likely emptier still,
the deferred Shot Idea proposal is cut by risk and sequencing, **not by value.** The signal
that it has become urgent: an upload recap reporting that three of forty rows have a Shot
Idea.

**What breaks first under pressure is the reviewer, not the system.** Cost is roughly thirteen
cents per approved image and does not change with scale. Review does not scale at all: a
forty-product drop is about a hundred and twenty decisions, six minutes; ten times the catalog
is nine thousand decisions, seven and a half hours of continuous tapping, in a channel nine
thousand messages long. Every architectural choice here is cheap to scale. The single human in
the approval path is not, and the mitigations that would matter — bulk actions, sampling,
auto-approving pass-throughs, delegated rights — are all deliberately absent from this scope.

**The full reasoning trail**, including every verified fact, every assumption with the question
it replaced, all superseded decisions, and the three rejected designs, is in the repository's
approach documentation.
