# 05: One styled image, end to end

**What to build:** The tracer bullet. Pressing the Generate button produces one real styled
photograph in the review channel, showing the product from its own white-background photo
placed in a scene, labelled with its deterministic filename.

The Shot Idea text is passed to the image model as the prompt directly. Prompt quality is the
next ticket; this one proves the whole path — job row, submission, polling, download, checksum,
storage, upload, post — works against real services.

The per-image stage machine, one committed transaction per transition:

```
pending_submit → submitted → completed → stored → posted
```

`stored` means the bytes are in our object store with a recorded checksum. Nothing reaches
Slack before that.

Crash-safety belongs here rather than in a later hardening pass, because it is a correctness
property of the very first generation: the image API offers no idempotency key, so the job row
must commit before the request is submitted. A crash between acceptance and persistence
orphans one paid generation, which is the safe direction to fail.

**Blocked by:** 02, 03, 04

**Status:** ready-for-agent

- [ ] Pressing Generate creates a job row per candidate image, committed before any submission
- [ ] The generation request uses image editing with the product's own photo as the source, so the real product is preserved
- [ ] The job is polled until it reaches a terminal state, at a cadence the provider documents as safe
- [ ] On completion the bytes are downloaded, checksummed, and stored under a random object key
- [ ] The meaningful filename is carried as a content disposition rather than encoded in the object key, so the URL is unguessable and the downloaded file is still named correctly
- [ ] The image is posted to the review channel with its filename and Approve / Discard controls
- [ ] Bytes are never re-encoded between download and post
- [ ] Retryable failures are retried with backoff; terminal failures stop and are surfaced rather than retried
- [ ] A refusal is correctly identified as either a per-minute limit or a concurrency limit, and honours the wait the provider asks for
- [ ] Killing the service mid-flight and restarting it resumes the job from its last committed stage
- [ ] An expired output link is recovered by re-polling rather than treated as a lost image
- [ ] Tests drive the flow through the real inbound entry points with the external collaborators substituted at one composition root, against a real database
