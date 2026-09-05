# Research: an HTML review surface, in place of Slack-native approval

Scope note up front: this is research only. No code changed. Every claim below is
either sourced to a primary doc (URL given) or flagged explicitly as inference /
unverified. This document does not re-argue whether the pivot is a good idea —
that's D2/D38 and their tradeoffs in `Decisions.md` / `Tradeoffs.md`. It answers
whether it's *buildable*, and what it costs.

## Summary — nothing here blocks the pivot

No primary source rules this out. The three things worth flagging up front:

1. **Slack unfurling needs no scopes and no code.** A bot posting a link to our
   own domain gets Slack's default, automatic Open-Graph-based preview —
   "classic unfurling" — with zero setup. The `links:read`/`links:write` +
   `link_shared`/`chat.unfurl` machinery is only for *overriding* that preview
   after the fact, and it explicitly does not fire for a message the app itself
   posted. This is good news: it removes an entire subsystem the pivot might
   otherwise have needed. See Q1.
2. **Railway's HTTP proxy caps every plain HTTP request/response at 15 minutes**
   (5 minutes if no bytes move), which is a real constraint on SSE but is
   *documented and has a documented workaround* (heartbeat + reconnect on a
   timer). WebSockets are exempt from this cap outright. See Q2.
3. **Mobile Safari's behavior toward a backgrounded/locked SSE connection is
   not documented anywhere I could find in Apple's or MDN's primary sources.**
   This is the one real unknown, and it's the one that matters most given
   Ellie's phone-first usage (`APPROACH.md`, `Assumptions.md` A2.1). It has to
   be tested on a real device, not assumed. See Q2 and "Open questions."

Everything else — schema changes, code that's already surface-agnostic, Hono's
library support — is concrete and low-risk. It's real work, not a blocker.

---

## Q1 — Slack link unfurling

**What happens by default, no setup at all.** Slack's own docs describe two
distinct mechanisms:

- **"Classic link unfurling is the default treatment for links posted in
  Slack. When a link is spotted, Slack crawls it and provides a preview,"**
  reading Open Graph and Twitter/X Card metadata: *"Slack crawls the URL,
  looks for common OpenGraph and X (formerly known as Twitter) Card metadata,
  and renders some micro-approximation of the content."* Critically: **"By
  default, we unfurl all links in messages posted by users and Slack
  apps."** — [docs.slack.dev/messaging/unfurling-links-in-messages](https://docs.slack.dev/messaging/unfurling-links-in-messages/)

  This directly answers the question: **a bot's own message gets the same
  automatic OG-based preview a human-pasted link would.** No app configuration,
  no scope, no event handler. Just put `<meta property="og:title">`,
  `og:description`, and `og:image` on the review page and Slack will render
  them.

- **Custom unfurling** (overriding what Slack shows) requires the app to
  register up to five domains under "App unfurl domains" in Event
  Subscriptions, subscribe to `link_shared`, and respond with `chat.unfurl`.
  Two scopes are required: **`links:read`** ("lets your app read specific
  links that are posted in Slack") and **`links:write`** ("gives your app
  permission to unfurl content associated with links," i.e. what
  `chat.unfurl` needs) —
  [docs.slack.dev/reference/scopes/links.read](https://docs.slack.dev/reference/scopes/links.read/),
  [docs.slack.dev/reference/scopes/links.write](https://docs.slack.dev/reference/scopes/links.write/).
  Domain changes here **"require re-installation of your Slack app"** —
  [unfurling-links-in-messages](https://docs.slack.dev/messaging/unfurling-links-in-messages/).

- **Own-message exclusion, confirmed for the event path specifically:**
  *"Apps will also not receive `link_shared` events for their own
  messages."* — same source. This only affects the *custom* unfurl path
  (which we don't need); classic unfurling still applies to the app's own
  posts per the "unfurl all links... posted by users and Slack apps" line
  above.

**Conclusion for the design:** don't build the `link_shared`/`chat.unfurl`
machinery at all. It exists to *override* Slack's own crawl of a URL (e.g. a
GitHub PR bot showing a custom card instead of GitHub's actual OG tags); it
is not required to get a preview in the first place, and it wouldn't even
fire for our own bot's message if we tried. Ship OG tags on the review page
and rely on classic unfurling. **This is a scope reduction versus what the
original prompt hypothesized**, not new complexity.

One thing not stated anywhere I found: whether classic unfurling requires the
URL to be publicly fetchable by Slack's crawler with no auth (it must — a
crawler can't complete an OAuth-gated login), which is consistent with Q4's
unguessable-URL model rather than a login wall.

---

## Q2 — Live updates to an HTML page

| | Polling (`fetch`) | SSE (`EventSource`) | WebSockets |
|---|---|---|---|
| Browser support | Universal | "Well established... available across browsers since January 2020" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)) | "Stable and has good browser and server support" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)) |
| Auto-reconnect | N/A (each poll is independent) | Built in: **"if the connection between the client and server closes, the connection is restarted"** by the browser ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)) | **Not automatic.** MDN documents no auto-reconnect; Railway's guide is explicit: **"WebSockets do not auto-reconnect. Implement a reconnection wrapper on the client"** ([docs.railway.com/guides/sse-vs-websockets](https://docs.railway.com/guides/sse-vs-websockets)) |
| Per-domain connection cap | N/A | On HTTP/1.1 only: capped at **6 open connections per browser per domain**, "marked as 'Won't fix' in Chrome and Firefox"; over HTTP/2 the cap becomes a negotiated stream count, "defaults to 100" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)) | Separate connection, not subject to the SSE cap |
| Directionality | Client-initiated request/response | Server→client only — the client "cannot send data back over the same connection" ([Railway](https://docs.railway.com/guides/sse-vs-websockets)) | Bidirectional; supports binary frames ([Railway](https://docs.railway.com/guides/sse-vs-websockets)) |
| Proxy friendliness | Best — plain HTTP | Good — "works through most HTTP proxies without extra configuration since it uses standard HTTP" ([Railway](https://docs.railway.com/guides/sse-vs-websockets)) | Weaker — "require[s] an HTTP/1.1 upgrade, which some proxies and load balancers may not support" ([Railway](https://docs.railway.com/guides/sse-vs-websockets)) |

**Railway's specific, documented position** (primary source — Railway's own
guide, not a forum post):

- **SSE runs over a plain HTTP response, so Railway's normal request limits
  apply**: *"SSE connections work via standard HTTP responses, so Railway's
  request limits apply: up to 15 minutes with keep-alive heartbeats, closed
  after 5 minutes with no data transferred."* Their documented mitigation:
  *"Send a heartbeat (such as an SSE comment line) at least every 5 minutes,
  and reconnect when a stream outlives the 15-minute cap."* —
  [docs.railway.com/guides/sse-vs-websockets](https://docs.railway.com/guides/sse-vs-websockets)
- **WebSockets are exempt from that cap:** *"WebSocket connections on Railway
  are exempt from inactivity timeouts and can stay open indefinitely,"* though
  *"connections can still drop for other reasons, such as deploys or network
  interruptions"* —
  [docs.railway.com/guides/socketio](https://docs.railway.com/guides/socketio)
- Railway's own recommendation, stated as a rule of thumb: **SSE for
  "AI/LLM token streaming, live dashboards, notification feeds, and any
  scenario where the server pushes data and the client only listens"** —
  which is exactly this use case (a viewer watches generation progress, never
  sends anything back over the channel) — **WebSockets for "chat
  applications, multiplayer games, collaborative editors... where both client
  and server send messages frequently"** —
  [docs.railway.com/guides/sse-vs-websockets](https://docs.railway.com/guides/sse-vs-websockets).
  By Railway's own framing, **SSE is the better fit for this feature**, not
  WebSockets — the review page only ever needs to *receive* "image N is
  ready," never send anything over that channel (approve/discard clicks are
  ordinary POSTs regardless of which live-update mechanism is chosen).

**Mobile Safari specifically — not found.** Neither MDN's SSE page nor its
WebSocket page documents backgrounding/lock-screen/tab-suspension behavior.
A web search surfaced a related WebKit background-throttling *control* API
shipping in Safari 17 (iOS 17/macOS 14), but I could not find an
Apple/WebKit primary source stating what specifically happens to an open
`EventSource` when Mobile Safari is backgrounded or the screen locks. Treat
this as **unverified — must be tested on a real iPhone**, not assumed. This
is the single most consequential unknown for this design given Ellie is
phone-first (`Assumptions.md` A2.1, `APPROACH.md` "What I'm building, and
why").

**Practical reading:** plain polling every few seconds is the simplest thing
that reliably works on every platform including a backgrounded phone browser
(a poll just resumes when the tab wakes), at the cost of some wasted requests
and up-to-N-second staleness. SSE is a real upgrade for the *desktop/active-tab*
case, is well within Railway's documented limits if heartbeats and reconnects
are implemented per Railway's own guide, but its mobile-backgrounded behavior
is an open question, not a documented fact. WebSockets solve the proxy-timeout
problem outright but add reconnection logic Railway explicitly says is on the
application, and are the wrong shape for a receive-only feed per Railway's own
guidance above.

---

## Q3 — Hono's support for each

| Need | Hono support | Source |
|---|---|---|
| Serving HTML | `hono/html` — *"The html Helper lets you write HTML in JavaScript template literal with a tag named `html`"*; values are auto-escaped, and `raw()` opts out ("Using `raw()`, the content will be rendered as is. You have to escape these strings by yourself.") | [hono.dev/docs/helpers/html](https://hono.dev/docs/helpers/html) |
| SSE | `hono/streaming` → `streamSSE(c, async (stream) => { ... })`. Exposes `stream.writeSSE({ data, event, id })`, `stream.sleep(ms)`, `stream.aborted`, and `stream.onAbort(() => {...})` for disconnect handling. Documented caveat: **"If the callback function of the streaming helper throws an error, the `onError` event of Hono will not be triggered"** because the stream has already started — error handling has to live inside the callback, not in Hono's normal error middleware. Also: **"If you are developing an application for Cloudflare Workers, streaming may not work well on Wrangler"** (irrelevant here — this app runs on Railway as a Node service, not Workers) | [hono.dev/docs/helpers/streaming](https://hono.dev/docs/helpers/streaming) |
| WebSockets | A `hono/ws`-style helper exists per-runtime: *"Currently Cloudflare Workers / Pages, Deno, Bun, and Node.js adapters are available."* For Node.js specifically (this app's runtime, via `@hono/node-server` per `package.json`): *"install `ws` and, if you use TypeScript, `@types/ws`,"* then *"create a `WebSocketServer` with `{ noServer: true }` and pass it to `serve()` via the `websocket` option."* The docs note the older `@hono/node-ws` package **"is deprecated"** in favor of this built-into-`@hono/node-server` path. | [hono.dev/docs/helpers/websocket](https://hono.dev/docs/helpers/websocket) |

**Read on this app specifically:** all three are first-party-supported on the
exact stack already in use (`hono@4.6.14`, `@hono/node-server@1.13.7`, per
`package.json`). SSE is a drop-in addition — one new route using
`streamSSE`. WebSockets would need one new dependency (`ws`) plus wiring the
`WebSocketServer` into the existing `serve()` call in `src/server.ts`
(unverified from docs whether that composes cleanly with the existing Hono
app export — would need a short spike, not a redesign).

---

## Q4 — Stateless, no-login access via an unguessable link

**Unguessable identifiers as an access mechanism — OWASP's own framing is
"defense in depth, not the defense":**

> *"In some cases, using more complex identifiers like GUIDs can make it
> practically impossible for attackers to guess valid values."* But:
> *"even with complex identifiers, access control checks are essential. If
> attackers obtain URLs for unauthorized objects, the application should
> still block their access attempts."*
> — [OWASP IDOR Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)

For this use case that caveat is largely academic — there's no second tier of
"unauthorized" data behind the link; the batch review link *is* the
authorization for that batch, by design (comparable to how the current
`/img/:id` route already works — see D31.2/D31.4 in `Decisions.md`, which
already established this exact pattern: **"Objects are keyed by a random ULID,
giving the permanent unguessable URL A6.4 requires."** The web review surface
would be the same idea one level up: a random token per batch instead of per
image.

**Entropy requirement, from the closest applicable primary source (OWASP's
session-identifier guidance, which is the standard reference for
"how random is random enough" even though this isn't literally a cookie
session):**

> *"Session identifiers must have at least 64 bits of entropy to prevent
> brute-force session guessing attacks."* ... *"A strong CSPRNG
> (Cryptographically Secure Pseudorandom Number Generator) must be used to
> generate session IDs."*
> — [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

A 128-bit random token (a UUIDv4/ULID or `crypto.randomUUID()`, already the
project's idiom per D31.2) clears this by a wide margin. **HMAC-signed tokens
are not documented anywhere I found as necessary for this shape** — a signed
token buys tamper-evidence for a token that *encodes* claims (e.g. "batch=41,
role=approver, exp=..."); a bare random token looked up against a
server-side table (batch ID ↔ token) doesn't need that, since the server is
the source of truth either way. This is my inference, not an OWASP
statement — no primary source directly addresses bare-random-token vs.
HMAC-token for this exact "capability URL" pattern.

**Why the token must not double as the whole security model, and why it's
fine here anyway:** the same session-management source is unambiguous that
putting sensitive identifiers in a URL is broadly discouraged, because:

> *"the usage of specific session ID exchange mechanisms, such as those where
> the ID is included in the URL, might disclose the session ID (in web links
> and logs, web browser history and bookmarks, the Referer header or search
> engines)"* and can *"facilitate other attacks, such as the manipulation of
> the ID or session fixation attacks."*
> — [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

And OWASP's dedicated page on the general pattern lists the concrete leak
surfaces: *"The parameter values ... will be exposed in the following
locations when using HTTP or HTTPS: Referer Header, Web Logs, Shared Systems,
Browser History, Browser Cache, Shoulder Surfing,"* adding that *"simply
using HTTPS does not resolve this vulnerability"* because internal parties
can still read server logs —
[OWASP: Information exposure through query strings in URL](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url).

**How this actually lands on the design:** those are real risks for a
*session/authentication* token protecting a login. They matter much less here
because (a) there's no separate authenticated account behind the link to
steal — the token *is* the whole grant, scoped to one batch, with no ability
to pivot to other batches or to Ellie's Slack identity; (b) the batch is
already, by design, ephemeral and non-secret-adjacent — it's product photos,
not PII or financial data; and (c) `Decisions.md`/`Tradeoffs.md` already
accepted the identical shape for `/img/:id` (D31.2). The residual, concrete
risk worth naming: **Slack's own link-preview crawler (Q1) will itself fetch
the URL** to generate the OG preview, and that fetch, plus the link sitting
forever in Slack's own message history and search index, are both
*additional* copies of the token beyond the browser-history/log risk OWASP
names. That's a consequence of combining Q1 and Q4, not something either
source states directly — flagging it as my own inference.

**On per-viewer identity — this is the part with no primary-source answer.**
Nothing in OWASP's guidance or Slack's docs addresses *distinguishing
who* is holding a shared link (needed if more than Ellie should be able to
approve, per `Decisions.md` D37/D2.2's future permissions command). Three
options, none blessed by a spec, only inferred from general web-platform
practice:

- **One token per batch, no per-viewer identity** — simplest, matches D37
  (Ellie-only approval) exactly, but "who approved this" (an audit
  requirement already built into `decision_events.actor`, `src/db/migrations.ts`
  line ~85) would have to come from a name typed into a form or a second,
  short-lived cookie set on first visit — pure inference, not sourced.
  Getting `payload.user.id` for free the way Slack currently provides it (D2's
  "identity is free" argument) goes away entirely; this is the real cost of
  the pivot, not the storage schema.
  - **A cookie set on first visit** could disambiguate repeat visits from the same
  browser, but is exactly the "auto-saved shared state" cost `Tradeoffs.md`
  T1.3 already named as real engineering work when D1 (the original web-app
  design) was considered, and is not addressed by either OWASP source above.

---

## Q5 — Postgres/schema impact

Read directly from `src/db/migrations.ts` and `src/db/repository.ts`.

**What the current schema already gives, unchanged:**

- `batches`, `images`, `approved_images`, `discarded_images`,
  `decision_events`, `image_jobs`, `batch_rows` — all of this is
  presentation-agnostic. A batch, a product's candidate images, and the
  approve/discard/pending state derived from table membership
  (`batchCounts`, `src/db/repository.ts:158`) don't know or care that Slack
  is the thing rendering them. `recordDecision`
  (`src/db/repository.ts:128`) already writes to `approved_images` /
  `discarded_images` / `decision_events` keyed by `imageId` and an `actor`
  string — a web button's POST would call the exact same function with a
  different `actor`.
- The `/img/:id` route (`src/slack/app.ts:163`) and the S3 object store
  (`src/storage/s3.ts`) are already exactly the "serve an image via an
  unguessable key" mechanism a review page would use for `<img src>` tags —
  no change needed there at all.

**What's missing, concretely:**

1. **A batch-level share token.** No column anywhere stores a per-batch
   secret. Needs a new column, e.g. `batches.review_token text unique`
   (or a small `batch_tokens` table if more than one link per batch is ever
   wanted — e.g. separate tokens for Ellie vs. a future second approver).
   Generated once per batch, at the point currently in `src/slack/app.ts:265`
   where `startGeneration` is kicked off, and included in the one Slack
   message the pivot proposes to post instead of the current per-product
   messages.
2. **Per-viewer identity has no home.** `approved_images.actor` and
   `discarded_images.actor` (`src/db/migrations.ts`, table `approved_images`/
   `discarded_images`) currently store Slack's `user.id`
   (`payload.user?.id`, `src/slack/app.ts:245`), which the web page cannot
   produce for free (Q4). If the design stays "Ellie only" (D37), `actor`
   could just be a fixed literal for the token holder — cheap, but throws away
   the audit trail's meaning the moment a second person gets a link. If more
   than one person needs distinguishable identity, that's a new mechanism
   entirely (see Q4) — not a column, a feature.
3. **`images.message_ts` becomes dead weight for its stated purpose, but not
   fully dead.** The column comment in `src/db/migrations.ts`
   (migration `0003_image_message_ts`) is explicit about why it exists:
   *"Recorded so a decided image can be rewritten in place. Without it the
   stream is an archive of undifferentiated candidates rather than a work
   queue."* That entire justification — rewriting a Slack message in place
   so scrollback shows outcomes — evaporates if approval no longer happens by
   scrolling Slack. `markProductPosted` (`src/db/repository.ts:614`), which
   writes this column today when a product's message is posted
   (`src/generation/worker.ts`, the `"stored"` case), would keep writing it
   only because the pivot still needs to post *one* summary link message to
   Slack (Q1) — but nothing would ever read `message_ts` back to *update*
   that message, since the live state now lives on the web page, not in the
   Slack message. **Recommendation: keep the column (removing it is a
   migration for no benefit, and it costs nothing sitting unused per D7's
   "storage is cheap" precedent already used for `discardedImages`), but
   its read path disappears.**
4. **A "batch is still generating" signal for the loading state.** The pivot
   wants "a live loading state while generation is still running." The data
   for this already exists — `image_jobs.state`
   (`src/db/migrations.ts`, table `image_jobs`) and `batches.state`
   (`uploaded → generating → ready_for_review → complete → delivered`) are
   exactly what `buildStatusSummary` (`src/status/status.ts`) already reads
   for `/luma status`. **No new column is needed here** — only a new query
   path (SSE push or poll response) that reads the same rows `/status`
   already reads, shaped as JSON instead of a Slack text string.
5. **What does NOT need to change:** `batch_rows`, `image_jobs`,
   `decision_events`, the `delivered_pointer` singleton, and the export/zip
   path (D5, D35) — none of this cares what rendered the approve/discard
   click that produced the rows it reads.

---

## Q6 — What survives the pivot, file by file

**Fully surface-agnostic — no change:**

- `src/generation/generator.ts`, `src/generation/worker.ts` (the state
  machine in `runOnce`/`drain`), `src/generation/loop.ts` (`tick`,
  `startWorkerLoop`) — the entire generate → poll → download → store pipeline
  neither knows nor cares who reviews the output. The one Slack-coupled line
  in `worker.ts` is the `"stored"` case's call to `deps.slack.postMessage`
  (`src/generation/worker.ts:~150`) — see below.
- `src/storage/s3.ts`, `src/storage/memory.ts`, `src/storage/store.ts` — the
  `ObjectStore` interface and its S3 implementation are already
  presentation-agnostic (D31).
- `src/db/repository.ts`, `src/db/migrations.ts`, `src/db/client.ts`,
  `src/db/postgres.ts` — all of it, per Q5, modulo the additive changes
  listed there. Nothing here needs to be *removed* for the pivot.
- `src/catalog/ingest.ts`, `src/catalog/parse.ts`, `src/catalog/recap.ts` —
  CSV ingest, validation, and the pre-spend recap are upstream of any review
  surface entirely; D13.3 keeps ingest in Slack regardless of what the pivot
  does to the *review* step, since the two are independent decisions.
- `src/generation/estimate.ts`, `src/pricing.ts`, `src/generation/filename.ts`
  — cost estimation and deterministic naming don't reference a rendering
  surface.
- `src/status/status.ts` — `buildStatusSummary` reads exactly the rows the
  web page's loading state would also read (Q5 point 4); the pivot's own
  brief keeps `/luma status` working in Slack, so this file is untouched.

**Slack-coupled — this is what actually gets rebuilt:**

- `src/generation/message.ts` (`buildProductMessage`) — this whole file *is*
  the Slack-native review UI: Block Kit `image`/`actions`/`context` blocks,
  one message per product. Its replacement is HTML markup for the review
  page, not a Block Kit payload. The failure-reason copy
  (`FAILURE_REASONS`) and the pass-through-vs-styled distinction it encodes
  are still needed conceptually — just rendered differently.
- `src/slack/app.ts` — three things here are Slack-specific and would be
  replaced or added to: (a) the `/slack/interactions` handling of
  `APPROVE_ACTION_ID`/`DISCARD_ACTION_ID` clicks (not yet wired up in the
  current code — see below — but the button `action_id`s are already defined
  in `message.ts` and exported through `worker.ts`) becomes a plain HTTP POST
  handler on the review page's domain instead of a Slack block-actions
  payload; (b) the `GENERATE_ACTION_ID` handler's `postMessage` call
  (`src/slack/app.ts:270`) that currently narrates progress into the channel
  would instead post the **one** link message the pivot describes; (c) the
  `/img/:id` route (`src/slack/app.ts:163`) stays exactly as-is — it's
  already surface-agnostic (Q5).
  - **Worth noting as a build-order fact, not a pivot cost:** grepping the
    repo shows `APPROVE_ACTION_ID`/`DISCARD_ACTION_ID` are defined and used to
    build buttons (`src/generation/message.ts`) but **there is no handler for
    them yet in `src/slack/app.ts`'s interactions switch** — approve/discard
    recording isn't wired up in Slack today either. Per the build order in
    `Decisions.md` D33, this is step 6, not yet reached. This means the
    pivot doesn't have to *undo* a working Slack approval flow — there isn't
    one yet to undo.
- `src/generation/worker.ts`'s `"stored"` case — currently calls
  `buildProductMessage` + `deps.slack.postMessage` per product
  (`src/generation/worker.ts:~150-165`). Under the pivot this step would stop
  posting to Slack per-product; the "post to Slack" step moves to a single
  batch-level event (first image ready is irrelevant; only "batch has a share
  link" matters) fired once, outside this per-product loop.
- `src/slack/client.ts` — remains, but its surface shrinks: it would still
  need `postMessage` (for the one link message and `/luma status`) and
  `openView` (for CSV upload, per D13.3), but the message-building
  it currently supports for per-image Block Kit (buttons, image blocks) goes
  away with `message.ts`.

**Net read:** the pipeline (ingest → generate → store) and the data layer
are essentially untouched — this matches `APPROACH.md`'s own claim about the
named pivot: *"the expensive half of the system (pipeline, storage, prompts,
ingest) survives that move untouched."* What's rebuilt is `message.ts`
(→ HTML), the review-decision handler in `app.ts` (→ plain HTTP endpoints
instead of Slack interaction payloads), and the per-product Slack posting in
`worker.ts` (→ a single link post + whatever push mechanism feeds the web
page's live state, per Q2).

---

## What this would cost

**Schema (additive, no destructive migration needed):**

- New column: `batches.review_token` (or a small `batch_tokens` table) —
  random, ≥128-bit, generated at batch-start (`src/slack/app.ts` around the
  `GENERATE_ACTION_ID` handler, `line 265`).
- Decide and implement an `actor` value for web-originated decisions in
  `recordDecision` (`src/db/repository.ts:128`) — trivial if staying
  Ellie-only (D37), a real feature if not (Q4/Q5).
- `images.message_ts` (`src/db/migrations.ts`, `0003_image_message_ts`)
  keeps being written (still needed for the one link-carrying message, if
  that message itself gets updated) but its "rewrite in place" read path
  goes unused — leave the column, note the dead read path.
- No changes needed to `batch_rows`, `image_jobs`, `decision_events`,
  `delivered_pointer`, or any existing index.

**Code:**

- New: an HTML review page (`hono/html`, per Q3) with OG tags for Slack's
  classic unfurl (Q1) — served from a new route, e.g.
  `GET /review/:token`.
- New: a live-update route — `streamSSE` (`hono/streaming`, Q3) is the
  better-fitting primitive per Railway's own SSE-vs-WebSockets framing (Q2),
  with a heartbeat and a client-side reconnect-at-15-minutes per Railway's
  documented limits; a polling fallback is the safe default given the
  undocumented mobile-Safari-backgrounding behavior (Q2).
- New: plain HTTP POST endpoints for approve/discard, replacing the
  Slack-block-actions path that (per Q6) was never finished anyway.
- Rewrite: `src/generation/message.ts` → HTML rendering instead of Block Kit.
- Trim: `src/generation/worker.ts`'s per-product `postMessage` call and
  `src/slack/app.ts`'s per-product interaction handling both shrink to "post
  one link, once."
- Unchanged: everything under `src/generation/{generator,loop}.ts`,
  `src/storage/`, `src/catalog/`, `src/db/{migrations,repository,client,
  postgres}.ts`, `src/status/status.ts`, `src/pricing.ts`,
  `src/generation/{estimate,filename}.ts`.

---

## Open questions the research could not settle

1. **Mobile Safari + backgrounded/locked-screen SSE.** No primary source
   (MDN, WebKit, or Apple Developer docs) documents what happens to an open
   `EventSource` connection when Mobile Safari is backgrounded or the device
   locks. This has to be verified empirically on a real iPhone before relying
   on SSE for the "live" part of the loading state; the fallback of plain
   polling sidesteps the question entirely at the cost of being less
   "live." Given Ellie is phone-first, this is the single highest-priority
   thing to test before committing to SSE over polling.
2. **HMAC-signed tokens vs. bare random tokens for the batch link.** No OWASP
   page directly addresses this specific "capability URL" pattern (as
   opposed to session cookies or IDOR-style object IDs). My reasoning above
   (a bare random token looked up server-side is sufficient because the
   server remains the authority) is inference, not a documented position.
3. **Whether `serve()`'s `websocket` option (Hono's Node WebSocket path)
   composes cleanly with this app's existing `Hono` app export and deferred-
   task model in `src/server.ts`.** The docs show the wiring in isolation;
   I did not find a primary source discussing it alongside a pre-existing
   Hono app instance the way this codebase structures `createApp`
   (`src/slack/app.ts:63`) separately from wherever `serve()` is called. This
   is moot if SSE is chosen over WebSockets (Q2's recommendation), but would
   need a short spike if WebSockets were chosen instead.
4. **`chat.unfurl` rate limits.** Not stated on the page I could find. Moot
   given Q1's conclusion that classic (crawler-based) unfurling is sufficient
   and `chat.unfurl` isn't needed at all — but worth knowing if the design
   ever wants a *custom* preview (e.g. showing live approved/pending counts
   inside the Slack preview itself, which would require the custom path).
5. **Exact behavior of Slack's crawler fetching a token-bearing URL** — e.g.
   whether it identifies itself with a distinguishable user agent, whether it
   respects `noindex`/robots directives, or whether the fetched page is cached
   by Slack in a way that could serve a stale preview after the batch
   completes. Not covered in the unfurling doc I read; would matter for
   deciding whether the OG-tag response for a completed vs. in-progress batch
   needs to be identical regardless of token state.
