# Facts

Verified, checkable statements about the brief, the data, and the Luma API.
No opinions here — anything I inferred lives in `Assumptions.md`.

Established: 2026-09-02 (pre-Round-1 fact-finding)

---

## F1 — The handoff data (`data/catalog.csv`)

| Property | Value |
|---|---|
| Rows | 40 products (a sample of their ~300) |
| Columns | `SKU, Product Name, Category, Color / Finish, Material, Price, Photo, Shot Idea, Notes` |
| Rows with a Shot Idea | **16** (matches README's "sixteen in the sheet right now") |
| Rows with a blank Shot Idea | **24** |
| Duplicate SKUs | 0 |
| SKU range | `HG-001` → `HG-045`, gaps at 7, 15, 23, 31, 39 |
| Categories | Ceramics 9, Kitchen 8, Decor 8, Bath 6, Glassware 5, Textiles 4 |
| Price format | String with leading `$` (e.g. `$48`) — not a number |

**F1.1 — There is no status column.** Nothing in the handoff can record that a request is
done. This is the mechanical cause of the README's "nobody can tell you today which of the
sixteen requests are done."

**F1.2 — All 40 `Photo` URLs resolve.** Verified with `curl`: every one returns
HTTP 200, `image/jpeg`, 450–750 KB. Host is
`take-home-service.lumalabs-ext.workers.dev`. No broken-link handling needed for this file.

**F1.3 — The `Notes` column carries four distinct kinds of signal**, undifferentiated:

| Kind | Examples |
|---|---|
| Prompt constraint | `El: smoke glass photographs badly, careful` · `pricey, needs to look premium` · `came out too shiny in last shoot` |
| Priority signal | `El: bestseller, do this one first` · `top seller, gets reordered constantly` · `gift set, big for Q4 last yr` |
| Multi-product shot request | `El: shoot with the mugs maybe` · `bathroom set w/ the towels?` · `holiday table story?` |
| Data-quality flag | `discontinued after spring?` · `photo slightly underexposed?` |

**F1.4 — Four rows have Notes but no Shot Idea:** HG-022, HG-032, HG-033, HG-043.

**F1.5 — The 16 rows with Shot Ideas:**
HG-002, 005, 008, 009, 010, 011, 012, 016, 020, 021, 025, 027, 034, 041, 042, 044.

---

## F2 — The Luma Agents API

Base URL `https://agents.lumalabs.ai/v1`. Auth: `Authorization: Bearer $LUMA_AGENTS_API_KEY`.
Key is present in gitignored `.env.local`. SDK `luma-agents@0.1.2` is already in `node_modules`.

**F2.1 — Async job model.** `POST /v1/generations` returns immediately with a job ID.
Poll `GET /v1/generations/{id}`. State: `queued | processing | completed | failed`.

**F2.2 — `type: "image_edit"` + `source: {url}` is the core mechanic.** Their
white-background photo goes in as `source`, a styled scene comes out, the product is
preserved. This maps 1:1 onto the customer's problem.

**F2.3 — Output URLs are presigned and expire in 1 hour.** A Luma URL cannot be stored as
the durable answer. Persisting the bytes ourselves is mandatory, not a nicety.

**F2.4 — Per-image pricing (all output at 2048px / 2K):**

| Task | `uni-1` | `uni-1-max` |
|---|---|---|
| Text to image | $0.0404 | $0.1000 |
| **Image edit (image→image)** | **$0.0434** | **$0.1030** |
| Image reference (1 image) | $0.0434 | $0.1030 |
| Each extra reference image | +$0.0030 | +$0.0030 |

Derived totals for `image_edit`:

| Scenario | `uni-1` | `uni-1-max` |
|---|---|---|
| 40-product drop × 3 candidates (120 images) | **$5.21** | **$12.36** |
| Full 300 catalog × 3 candidates (900 images) | **$39.06** | **$92.70** |

**F2.5 — Failures are typed**, via `failure_code`:
`content_moderated`, `generation_failed`, `budget_exhausted`, `output_not_found`,
`image_too_large`, `unsupported_format`, `corrupt_input`, `invalid_request`, `rate_limited`.

**F2.6 — Two independent rate limits on POST**, both scoped per *client* (not per key):
requests-per-minute (60s sliding window) and max concurrent non-terminal jobs. Either one
breaching returns HTTP 429; tell them apart by the `detail` body field
(`"Rate limit exceeded"` vs `"Too many concurrent jobs"`). `Retry-After` header is present
on both. Actual allowance values are only visible in Luma's dashboard — **unknown to us**.

**F2.7 — Polling is explicitly cheap.** `GET /v1/generations/{id}` is not in the POST rate
bucket. Docs recommend 2–5 second intervals.

**F2.8 — `source.generation_id` chains an edit off a prior completed generation** owned by
the same client. Enables a "regenerate this one, but warmer" path without re-uploading.

**F2.9 — `aspect_ratio` options:** `3:1, 2:1, 16:9, 3:2, 1:1, 2:3, 9:16, 1:2, 1:3`.
`image_ref` accepts up to 8 refs on `image_edit` (source occupies a slot), 9 on `image`.
`output_format`: `png | jpeg`. Optional `user_id` for per-end-user usage attribution.

**F2.10 — Luma's LLM inference is a separate product we do NOT have a key for.**
Different base URL (`inference.lumalabs.ai`), separate key system, provisioned via sales.
Any shot-idea→prompt translation must therefore run on another provider. `.env.example`
lists `ANTHROPIC_API_KEY` and states reviewers "will supply real keys when reviewing."

**F2.11 — There is no staging/sandbox environment.** Experiments cost real money.

---

## F3 — What the brief itself fixes

- **F3.1** — Their entire toolkit is Google Docs/Sheets, Slack, and Gmail.
- **F3.2** — "Done" for a request = **2–3 approved images matching the shot idea, in the
  Drive folder, on the product page.**
- **F3.3** — Ellie's pick is the decision. There is no other approval step.
- **F3.4** — The named production incident: the web person shipped the wrong
  `IMG_43xx.jpg` to a product page and nobody noticed for three weeks.
- **F3.5** — The rejected prior tool was a creative-automation product with "a beautiful
  dashboard." Nobody logged in after week one.
- **F3.6** — Ellie's stated constraint, verbatim: "it has to work from my phone, and I
  don't want to install anything new."
- **F3.7** — Maya's four asks: (a) AI makes the shots in the sheet, (b) Ellie approves on
  her phone, (c) don't burn budget on stuff she'll reject, (d) Maya sees status without
  asking Ellie. Plus: a 40-product drop next month as the first real test.
- **F3.8** — README explicitly sanctions "a Slack workspace invite" as a valid way for
  reviewers to get into the product.
- **F3.9** — No live sheet sync is expected. "An updated export at the end is fine."
- **F3.10** — The product must be **deployed**, and the video must demo the deployed
  thing, not localhost.

---

## F4 — Slack platform constraints (added Round 1, Q1 revision)

Verification status is marked per item. Anything `[VERIFY]` is a confident claim from prior
knowledge that must be confirmed against a real workspace during the build, not assumed.

**F4.1 — Block Kit messages cap at 50 blocks.** `[CONFIRMED — api.slack.com/block-kit/interactivity]`
Modals and Home tabs cap at 100. This is the hard ceiling on how much can live in one post,
and it is why batching (10–20 per message) is a real constraint, not a preference.

**F4.2 — Interaction payloads identify the clicking user.** `[CONFIRMED]`
Every button click delivers the Slack user ID of whoever clicked. **Identity is free.**
No magic links, no sessions, no password reset flow, no auth to build at all — a
hardcoded `U…` user ID for Ellie is enforceable server-side on arrival.

**F4.3 — Posted messages can be edited in place** via `chat.update`, and interaction
responses can rewrite the originating message. `[VERIFY]`
This is the mechanism that lets a candidate post visibly become "✅ approved by Ellie"
rather than leaving an undecided-looking message in the scrollback forever.

**F4.4 — Slack image blocks need a URL Slack's servers can fetch, or an uploaded file.** `[VERIFY]`
Combined with **F2.3 (Luma presigned URLs expire in 1 hour)**, posting a raw Luma URL into
Slack produces a channel full of broken images by the next morning. Images must be
persisted by us and served from our own storage, or uploaded to Slack as files. **The
all-in-Slack design does not remove the storage requirement — it makes it more urgent,
because the channel is now the permanent record and broken images are permanent damage.**

**F4.5 — Channel posting restrictions and interactivity are separate mechanisms.** `[CONFIRMED — 2026-09-04, ticket 02 probe 1]`
Restricting who can post to a channel governs *messages*. Clicking a Block Kit button is an
*interaction*, not a message, so buttons are expected to remain functional in a
posting-restricted channel. **This must be verified early — the entire read-only-channel
plan depends on it.** Note the second-order effect: restricting posting also suppresses the
human discussion that is currently step 5 of their process (see OQ-5).

**F4.6 — Free Slack workspaces limit visible history.** `[VERIFY — believed 90 days]`
Relevant only if the channel is treated as the system of record. It must not be (see D2.6).

**F4.7 — `chat.getPermalink` returns a stable deep link to any posted message.** `[VERIFY]`
Tapping it on mobile opens Slack directly at that message. This is what makes a `/status`
list actionable rather than merely informative.

**F4.8 — `chat.postMessage` is rate-limited to roughly 1 message per second per channel,**
with short bursts tolerated. `[VERIFY]`
At 40 products × 3 candidates = 120 messages, a full drop takes **~2 minutes to post** even
with generation already complete. Not a blocker, but it means posting is a paced background
job, not a loop.

**F4.9 — Slack has no per-message "silent post" flag.** `[VERIFY]`
Notification volume is controlled by the *recipient's* per-channel preference, not by the
sender. Posting 120 messages into a channel where a member has "All new messages" set
produces 120 phone notifications. See T3.4 — this is the sharpest un-mitigated risk in the
flat-message design.

**F4.10 — Slack threading is single-level. There are no nested threads.** `[CONFIRMED — slack.com/help "Use threads to organize discussions"]`
A thread hangs off a channel message; a thread reply cannot itself have a thread. **This is
the fact that kills the batch-parent design** (see Road not taken): if candidate images
occupy the thread level, per-image discussion has nowhere left to go.

**F4.11 — Thread replies do not notify channel members by default.** `[VERIFY]`
Only the parent-message author and users who joined the thread (or who tick "also send to
channel") are notified. In a batch-parent design the bot is the parent author, so posting
120 images into a thread would notify essentially nobody — which is exactly why that design
solves the flood.

**F4.12 — Muting a channel suppresses its notifications and unread badge, but a direct
@-mention still badges.** `[CONFIRMED — 2026-09-04, ticket 02 probe 2]`
Verified in a real workspace: with the review channel muted, a message mentioning the
approver still produced a badge.

**This is the load-bearing one.** It means the flood mitigation works exactly as designed:
the 120-message candidate stream posts quietly into a muted channel, and **one** summary
message @-mentions Ellie. One ping per batch instead of 120, with push preserved.
**T3.4 and T3.6 stand; the bot-DM fallback is not needed.**

**F4.13 — Slack modals accept file uploads via the `file_input` block element.** `[CONFIRMED — docs.slack.dev/reference/block-kit/block-elements/file-input-element]`
- Must sit inside an `input` block.
- `filetypes` restricts accepted extensions (e.g. `["csv"]`) — **convenience only; server-side
  validation is still required**, per Slack's own note.
- `max_files` 1–10, defaults to 10. Set to 1.
- Requires the **`files:read`** scope. **100 MB file size limit.**
- The uploaded file arrives in the `view_submission` payload, keyed by `action_id`.

**Consequence:** a slash-command-opens-modal ingest flow (D13) is fully supported. The CSV
never has to be dropped into the channel, so ingest does not pollute the review stream.

**F4.14 — Feasibility of a multi-step ingest flow in Slack.** `[CONFIRMED from F4.1, F4.13]`
Answering the question raised at Q5:

- **Step 1 — upload:** slash command → modal with `file_input` restricted to `.csv` (F4.13).
- **Step 2 — recap:** a channel or ephemeral message carrying validation results and
  **multiple action buttons** in one `actions` block (e.g. *Generate* and *Propose ideas for
  the 24 blanks*). Fully supported.
- **Step 3 — proposal review (if built):** a modal with one pre-filled `plain_text_input`
  per blank row. **Bounded by the 100-block modal ceiling (F4.1)** — comfortable at 24 or 40
  rows, impossible at 300.

**Conclusion: the two-step flow is feasible as specified. The three-step proposal-review flow
is feasible at drop scale only**, which matches the stated use case but should be a chosen
boundary, not a surprise. See T7.5.

---

## F5 — What the `Notes` column would actually contribute (measured, not estimated)

Computed against `data/catalog.csv` under D18.1 (generate only rows with a Shot Idea).

- **16 rows will be generated.** Of those, **9 have a Note.**
- Classifying those 9 Notes by what they would do **inside a generation prompt**:

| # | SKU | Product | Note | Effect in a prompt |
|---|---|---|---|---|
| 1 | HG-016 | Cutting Board | `pricey, needs to look premium` | ✅ **Genuine constraint** |
| 2 | HG-041 | Ribbed Tumbler Set | `El: smoke glass photographs badly, careful` | ⚠️ **Constraint, but needs interpretation** — a warning about photography, not a scene description |
| 3 | HG-002 | Stoneware Mug | `El: bestseller, do this one first` | ⭕ Noise — scheduling, not styling |
| 4 | HG-005 | Serving Bowl | `top seller, gets reordered constantly` | ⭕ Noise |
| 5 | HG-010 | Espresso Cup Set | `gift set, big for Q4 last yr` | ⭕ Noise |
| 6 | HG-021 | Spice Jar Set | `stocking stuffer push` | ⭕ Noise |
| 7 | HG-011 | Woven Throw Blanket | `El: shoot with the mugs maybe` | ❌ **Actively harmful** |
| 8 | HG-034 | Soap Dispenser | `bathroom set w/ the towels?` | ❌ **Actively harmful** |
| 9 | HG-044 | Wine Glass Set | `holiday table story?` | ❌ **Actively harmful** |

**Tally across the 16 rows that will be generated:**

| Outcome | Rows | Share |
|---|---|---|
| Prompt improved | 1–2 | 6–12% |
| No effect (noise) | 4 | 25% |
| **Prompt corrupted** | **3** | **19%** |
| No Note at all | 7 | 44% |

**The concrete failure.** HG-011 is a *Woven Throw Blanket*, shot idea `draped over a reading
chair`, note `El: shoot with the mugs maybe`. Passed into a prompt, that plausibly produces
**mugs in a blanket photograph** — a wrong image, generated confidently, that Ellie must
catch by eye. HG-034 and HG-044 fail the same way.

**Conclusion: feeding raw Notes into prompts corrupts more rows than it improves,
by roughly 2:1.** The multi-product requests are the problem — they are legitimate creative
instructions that happen to be *incomprehensible to a single-product generator*.

---

## F6 — Slack timing constraints that shape the architecture

**F6.1 — Slash commands and interaction payloads must be acknowledged within 3 seconds.** `[VERIFY]`
Slack shows the user an error past that. **Any real work — generation, CSV parsing, zipping —
must happen after the ack, not before it.** This forces an async architecture regardless of
what else is chosen.

**F6.2 — `trigger_id` expires ~3 seconds after the interaction.** `[VERIFY]`
A modal (`views.open`) must be opened within that window. So the D13 ingest flow must open
its modal *immediately* on the slash command, before any validation work.

**F6.3 — The app needs a publicly reachable HTTPS endpoint.** `[CONFIRMED by design]`
Slash commands, interactivity payloads, and `view_submission` are all inbound webhooks. This
rules out anything that cannot accept public POSTs, and means the deploy target is not a
free choice.

**Combined consequence:** the pipeline (generate → poll → download → store → post, paced at
~1 msg/sec per F4.8) is **long-running background work** that must survive process restarts.
Its state has to live in the database, not in memory.

---

## F7 — Failure taxonomy and recovery (added at the architecture deep-dive)

**F7.1 — ⭐ The 1-hour presigned URL expiry is RECOVERABLE, not a hard deadline.** `[CONFIRMED — docs.agents.lumalabs.ai/guides/error-handling]`
> *"Re-poll if needed — If you need the image again after expiry, call GET to get a new URL."*

**This materially changes the risk profile.** If our process is down for three hours mid-batch,
no paid image is lost — every generation can be re-polled for a fresh URL on recovery. The
expiry is a *caching* rule, not a deadline: don't store the URL, do store the bytes.

Luma's own stated rules: save images to your own storage as soon as the generation completes;
never cache the URL; never expose it to end users (they break in an hour — serve from your
own storage). **All three are already satisfied by D4.2 + D9.1.**

*Unknown, worth verifying:* how long Luma retains a generation record. Re-polling works
"after expiry" but the retention horizon is unstated.

**F7.2 — Synchronous errors on `POST /v1/generations`:**

| Status | Meaning | Retryable |
|---|---|---|
| 201 | Created | — |
| 400 | Invalid parameters | **No** — fix request |
| 401 | Bad/missing/revoked/expired key | **No** |
| 402 | Insufficient balance | **No** — add funds |
| 403 | Client suspended | **No** |
| 413 | Input media too large | **No** — resize |
| 422 | Bad parameter combo or bad media | **No** |
| 429 | Rate limited (RPM *or* concurrent) | **Yes** — honour `Retry-After` |
| 502 | Upstream unavailable (incl. `source: fetch proxy unavailable`) | **Yes** — 5–10s backoff |
| 503 | Image ingestion unavailable | **Yes** — retry, or send base64 instead of URL |

**Note 502/503 are live risks for us specifically**, because D21.3 passes the customer's
photo as `source: {url}` — so Luma must fetch `take-home-service.lumalabs-ext.workers.dev`
on our behalf. Base64 is the documented fallback (F2.9 allows `data` + `media_type`).

**F7.3 — Asynchronous `failure_code` taxonomy** (discovered while polling):

| `failure_code` | Retryable | Handling |
|---|---|---|
| `content_moderated` | **No** | Prompt/input violated policy — must change the prompt |
| `generation_failed` | **Yes** | Internal model error — retry same request |
| `budget_exhausted` | **No** | Out of funds |
| `output_not_found` | **Yes** | Retry same request |
| `image_too_large` | **No** | Resize input |
| `unsupported_format` | **No** | Convert input |
| `corrupt_input` | **No** | Replace input |
| `invalid_request` | **No** | Fix parameters |
| `rate_limited` | **Yes** | Upstream throttle — backoff |

**F7.4 — Every response carries `X-Request-Id`.** Log it on every error; it is what Luma
support needs to trace an issue.

**F7.5 — ⚠️ There is NO idempotency key on `POST /v1/generations`.** `[CONFIRMED from SDK params]`
`GenerationCreateParams` accepts `prompt, aspect_ratio, image_ref, model, output_format,
source, style, type, user_id, web_search` — nothing for request deduplication. **A crash
between "Luma accepted the request" and "we persisted the generation id" produces an orphaned,
paid-for generation we can never poll.** Cost: $0.1030 each. This is the one unavoidable
money-losing failure mode, and it is the safe direction to fail in.

**F7.6 — `user_id` is available for attribution.** Free-form opaque identifier forwarded
upstream and used in per-end-user usage breakdowns. Setting it to our internal image or batch
ID costs nothing and gives a reconciliation handle against Luma's own records — the closest
thing available to a defence against F7.5's orphans.

---

## F8 — Slack file upload mechanics (added at the storage decision)

**F8.1 — `files.upload` is deprecated. The current flow is three calls.** `[CONFIRMED — docs.slack.dev/messaging/working-with-files]`
1. `files.getUploadURLExternal` (`filename`, `length`) → returns an upload URL and file ID
2. `POST` the bytes to that URL
3. `files.completeUploadExternal` (`files: [{id, title}]`, `channel_id`) → shares it

**Consequence:** ~3 API calls per image. At 120 images that is ~360 calls per batch, versus
120 for a plain `chat.postMessage`. Slack scans uploads for malware, so larger files take
longer to become available.

**F8.2 — ⭐ `files.completeUploadExternal` accepts a `blocks` parameter.** `[CONFIRMED — docs.slack.dev/reference/methods/files.completeUploadExternal]`
> *"blocks — A JSON-based array of structured rich text blocks... **If the `initial_comment`
> field is provided, the `blocks` field is ignored.**"*

**This is what makes uploading bytes compatible with D3.2** (Approve/Discard buttons on every
image message). Without it, a file share and an interactive message would be two separate
posts and the one-message-per-image design would break.

**✅ `[CONFIRMED — 2026-09-04, ticket 02 probe 3]`** An `actions` block carrying buttons does
render on a file-share message. Verified with a real catalog photo (~500 KB), the same path
ticket 05 will use.

**D3.2 and D32 both stand.** Image bytes live in Slack, each image is one message carrying
its own decision, and the channel does not depend on our storage staying alive.

**The fallback ladder is not needed and is retained only for the record:** upload privately
then post an `image` block against `permalink_public`; or revert to `image_url` pointing at
our own storage.

**F8.3 — `files.completeUploadExternal` is Tier 4 rate-limited: 100+ per minute.**
More generous than `chat.postMessage` (~1/sec, F4.8). Posting throughput is bounded by
whichever call is used to create the message.

**F8.4 — `thread_ts` is supported on `files.completeUploadExternal`**, so a file can be posted
as a thread reply if ever needed.

**F8.5 — Note for day one: the real rate limits can be discovered for about four cents.**
F2.6 says RPM and concurrency values live only in Luma's dashboard, but `X-RateLimit-Limit`
is returned on every successful POST (201). **A single `uni-1` text-to-image generation costs
$0.0404** and returns the header — validating auth, the SDK, and the rate ceiling in one
cheap call. Worth doing before writing the throttling logic against a guess.

---

## F9 — LLM-B model, and the unit economics the brief asks for

**F9.1 — Current Claude models and pricing** `[CONFIRMED — claude-api skill, cached 2026-06-24]`

| Model | ID | Context | Input $/1M | Output $/1M |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | 1M | $5.00 | $25.00 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $3.00 | $15.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1.00 | $5.00 |

**F9.2 — API shape facts that affect LLM-B's implementation:**
- **Assistant prefill is removed** on Opus 5 / Sonnet 5 / the 4.6+ family — returns 400.
  Use **structured outputs** (`output_config: {format: {...}}`) to force the shape, not prefill.
- The deprecated `output_format` parameter is replaced by `output_config: {format: {...}}`.
- `budget_tokens` is **removed** on Opus 5 (400). Use `thinking: {type: "adaptive"}` and
  `output_config: {effort: …}`.
- **Prompt caching is a prefix match**, minimum ~1024 tokens, and is verified via
  `usage.cache_read_input_tokens`. Any byte change in the prefix invalidates everything after.

**F9.3 — LLM-B cost model.** Per product: a stable system prompt plus the team's own shot
ideas as a few-shot style corpus (~1,500 tokens, cacheable), the product row (~100 tokens,
volatile), and 3 distinct prompts out (~400 tokens).

| Scale | LLM-B uncached | LLM-B with prefix caching |
|---|---|---|
| 40-product drop | $0.72 | **$0.45** |
| Full 300 catalog | $5.40 | **$3.38** |
| 10× catalog (3,000) | $54.00 | **$33.75** |

**LLM-B is ~3.5% of a batch's cost.** Image generation dominates completely. The stable
system+few-shot prefix is exactly the shape prompt caching is designed for (40 calls in quick
succession over an identical prefix).

**F9.4 — ⭐ UNIT ECONOMICS (for `APPROACH.md`).** Assuming ~2.5 of 3 candidates approved:

| Scale | Images | Image cost | LLM-B | **Total** | Approved | **$/approved image** |
|---|---|---|---|---|---|---|
| One 40-product drop | 120 | $12.36 | $0.45 | **$12.81** | ~100 | **$0.128** |
| Full 300 catalog | 900 | $92.70 | $3.38 | **$96.07** | ~750 | **$0.128** |
| 10× catalog (3,000) | 9,000 | $927.00 | $33.75 | **$960.75** | ~7,500 | **$0.128** |

**~13 cents per approved image, and it does not change with scale.** For comparison, the
freelance photographer this replaces costs orders of magnitude more and takes weeks (brief
steps 3–4).

**F9.5 — ⭐ WHAT ACTUALLY BREAKS AT 10× — and it is not the money.**

| Scale | Cost | **Human review load** |
|---|---|---|
| 40-product drop | $12.81 | 120 decisions ≈ **6 minutes** |
| Full 300 catalog | $96.07 | 900 decisions ≈ **45 minutes** |
| 10× catalog | $960.75 | 9,000 decisions ≈ **7.5 hours of continuous tapping** |

**Cost scales linearly and stays trivial. Human review does not scale at all.** At 10× the
catalog, one person approving every image individually (D8.3's forced completeness) is a full
working day of uninterrupted button-pressing — and D3's flat message stream would be 9,000
messages long.

**This is the honest answer to "what breaks first under pressure": Ellie does.** Not the API,
not the database, not the rate limits. Every architectural choice in this design is cheap to
scale; the single human in the approval path is not. The mitigations that matter at 10× are
all attention-side — bulk actions, sampling-based approval, auto-approving high-confidence
shots, or delegating rights (OQ-1) — and **none of them are in v1.**

---

## F10 — Ticket 02 outcome (2026-09-04)

All three platform verifications **passed**. Run via `/luma verify` against the deployed
service, in the real workspace, with the review channel configured as designed.

| Fact | Question | Result | Decision affected |
|---|---|---|---|
| **F4.5** | Buttons in a posting-restricted channel? | ✅ works | **D2.1 stands** |
| **F4.12** | Mention badges a muted channel? | ✅ badges | **T3.4 / T3.6 stand** |
| **F8.2** | Blocks on a file-share message? | ✅ renders | **D3.2 + D32 stand** |

**No decision was overturned.** Every fallback that had been specified against these
failing — approval moving off the channel, a bot DM replacing channel mentions, image bytes
reverting to storage references with two messages per image — is now unnecessary, and is kept
only as a record of what would have happened.

**Why this mattered more than three checkmarks suggests.** These were the three
`[VERIFY]` items capable of invalidating the *posting layer* rather than a detail of it.
Discovering any of them at ticket 07 would have meant rebuilding tickets 05, 07 and 08 on a
different shape. The cost of finding out was one slash command; the cost of not finding out
was most of the build.
