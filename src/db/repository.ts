import { randomBytes, randomUUID } from "node:crypto";
import type { SqlClient } from "./client.js";

export type Decision = "approve" | "discard";
export type ImageKind = "styled" | "pass_through";

export interface Batch {
  id: number;
  sourceFilename: string;
  state: string;
}

export interface Image {
  id: string;
  batchId: number;
  sku: string;
  slot: number;
  filename: string;
}

export interface NewImage {
  sku: string;
  productName: string;
  slot: number;
  kind: ImageKind;
  filename: string;
  prompt?: string | null;
}

export interface BatchCounts {
  total: number;
  approved: number;
  discarded: number;
  pending: number;
}

export interface DecisionEvent {
  decision: Decision;
  actor: string;
  createdAt: Date;
}

export async function createBatch(
  db: SqlClient,
  input: { sourceFilename: string },
): Promise<Batch> {
  const { rows } = await db.query<{ id: string; source_filename: string; state: string }>(
    `insert into batches (source_filename) values ($1)
     returning id, source_filename, state`,
    [input.sourceFilename],
  );
  const row = rows[0]!;
  return {
    id: Number(row.id),
    sourceFilename: row.source_filename,
    state: row.state,
  };
}

export async function addImages(
  db: SqlClient,
  batchId: number,
  images: NewImage[],
): Promise<Image[]> {
  // One transaction for the whole batch. A partial insert would leave the
  // batch reporting a total lower than the catalog, and completion
  // (approved + discarded == total) would then be reached against a truncated
  // set — so a half-ingested batch could be confirmed and delivered as whole.
  return db.transaction(async (tx) => {
    const created: Image[] = [];

    for (const image of images) {
      const id = randomUUID();
      await tx.query(
        `insert into images (id, batch_id, sku, product_name, slot, kind, filename, prompt)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          batchId,
          image.sku,
          image.productName,
          image.slot,
          image.kind,
          image.filename,
          image.prompt ?? null,
        ],
      );
      // Every image gets a job row up front: the pipeline resumes by scanning
      // rows in non-terminal states, so an image with no row is invisible to
      // it. A pass-through starts at 'pending_fetch' because its output is the
      // customer's original photo — it must never reach the paid submission
      // path, which is what makes the recap's "free" promise true.
      await tx.query(
        `insert into image_jobs (image_id, batch_id, state) values ($1, $2, $3)`,
        [
          id,
          batchId,
          image.kind === "pass_through" ? "pending_fetch" : "pending_submit",
        ],
      );
      created.push({
        id,
        batchId,
        sku: image.sku,
        slot: image.slot,
        filename: image.filename,
      });
    }

    return created;
  });
}

/**
 * Records a decision as membership.
 *
 * The whole sequence runs in one transaction so an image can never be observed
 * in both relations, and the event is written alongside so the audit log can
 * never disagree with the state it describes.
 *
 * `batch_id` is derived from the image rather than accepted from the caller.
 * A Slack interaction payload carries the batch in its action value, and one
 * stale payload filing a decision under the wrong batch would make
 * `batchCounts` over-count one batch, under-count another, and report a
 * negative pending figure. The safest parameter is the one that cannot be
 * passed.
 */
export async function recordDecision(
  db: SqlClient,
  input: { imageId: string; decision: Decision; actor: string },
): Promise<void> {
  const { imageId, decision, actor } = input;
  const target = decision === "approve" ? "approved_images" : "discarded_images";
  const other = decision === "approve" ? "discarded_images" : "approved_images";

  await db.transaction(async (tx) => {
    await tx.query(`delete from ${other} where image_id = $1`, [imageId]);
    await tx.query(
      `insert into ${target} (image_id, batch_id, actor)
       select id, batch_id, $2 from images where id = $1
       on conflict (image_id) do nothing`,
      [imageId, actor],
    );
    await tx.query(
      `insert into decision_events (image_id, batch_id, decision, actor)
       select id, batch_id, $2, $3 from images where id = $1`,
      [imageId, decision, actor],
    );
  });
}

/**
 * Counts by state, derived entirely from membership.
 *
 * Pending is "in neither relation" rather than a stored value, so it cannot
 * drift out of step with the decisions themselves.
 */
export async function batchCounts(
  db: SqlClient,
  batchId: number,
): Promise<BatchCounts> {
  const { rows } = await db.query<{
    total: string;
    approved: string;
    discarded: string;
  }>(
    `select
       (select count(*) from images           where batch_id = $1) as total,
       (select count(*) from approved_images  where batch_id = $1) as approved,
       (select count(*) from discarded_images where batch_id = $1) as discarded`,
    [batchId],
  );

  const row = rows[0]!;
  const total = Number(row.total);
  const approved = Number(row.approved);
  const discarded = Number(row.discarded);

  return { total, approved, discarded, pending: total - approved - discarded };
}

export async function listDecisionEvents(
  db: SqlClient,
  imageId: string,
): Promise<DecisionEvent[]> {
  const { rows } = await db.query<{
    decision: Decision;
    actor: string;
    created_at: Date;
  }>(
    `select decision, actor, created_at from decision_events
     where image_id = $1 order by id asc`,
    [imageId],
  );
  return rows.map((r) => ({
    decision: r.decision,
    actor: r.actor,
    createdAt: r.created_at,
  }));
}

/** Advances the pointer. Only ever called on a human confirmation. */
export async function setDeliveredBatch(
  db: SqlClient,
  batchId: number,
): Promise<void> {
  await db.query(
    `update delivered_pointer set batch_id = $1, updated_at = now() where only_row`,
    [batchId],
  );
}

export async function getDeliveredBatchId(
  db: SqlClient,
): Promise<number | null> {
  const { rows } = await db.query<{ batch_id: string | null }>(
    `select batch_id from delivered_pointer where only_row`,
  );
  const value = rows[0]?.batch_id;
  return value == null ? null : Number(value);
}

export async function getLatestBatch(db: SqlClient): Promise<Batch | null> {
  const { rows } = await db.query<{
    id: string;
    source_filename: string;
    state: string;
  }>(
    `select id, source_filename, state from batches order by id desc limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceFilename: row.source_filename,
    state: row.state,
  };
}

export interface BatchRow {
  sku: string;
  productName: string;
  category: string;
  colour: string;
  material: string;
  price: string;
  photoUrl: string;
  shotIdea: string | null;
}

/** Stores the parsed catalog so the batch no longer depends on the upload. */
export async function addBatchRows(
  db: SqlClient,
  batchId: number,
  rows: BatchRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, row] of rows.entries()) {
      await tx.query(
        `insert into batch_rows
           (batch_id, row_index, sku, product_name, category, colour, material, price, photo_url, shot_idea)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          batchId,
          index,
          row.sku,
          row.productName,
          row.category,
          row.colour,
          row.material,
          row.price,
          row.photoUrl,
          row.shotIdea,
        ],
      );
    }
  });
}

export async function getBatchRows(
  db: SqlClient,
  batchId: number,
): Promise<BatchRow[]> {
  const { rows } = await db.query<{
    sku: string;
    product_name: string;
    category: string;
    colour: string;
    material: string;
    price: string;
    photo_url: string;
    shot_idea: string | null;
  }>(
    `select sku, product_name, category, colour, material, price, photo_url, shot_idea
     from batch_rows where batch_id = $1 order by row_index asc`,
    [batchId],
  );

  return rows.map((r) => ({
    sku: r.sku,
    productName: r.product_name,
    category: r.category,
    colour: r.colour,
    material: r.material,
    price: r.price,
    photoUrl: r.photo_url,
    shotIdea: r.shot_idea,
  }));
}

export type JobState =
  | "pending_submit"
  | "pending_fetch"
  | "submitted"
  | "completed"
  | "stored"
  | "posted"
  | "failed";

export interface PipelineJob {
  imageId: string;
  batchId: number;
  state: JobState;
  generationId: string | null;
  attempts: number;
  sku: string;
  slot: number;
  filename: string;
  prompt: string | null;
  kind: ImageKind;
  objectKey: string | null;
  /** The product's own white-background photo, from the ingested catalog. */
  sourceUrl: string;
}

/**
 * The next job needing work.
 *
 * Single-worker by design (see the deployment assumption): there is no
 * `for update skip locked` here, so a second concurrent worker would
 * double-execute. If the service is ever scaled past one instance, that lock
 * has to arrive with it.
 */
export interface RegenerationTarget {
  batchId: number;
  sku: string;
  productName: string;
  shotIdea: string | null;
  /** Null until the product's set has been posted. */
  messageTs: string | null;
  /** The prompt the original candidate was made from, to edit rather than retype. */
  prompt: string | null;
  frozen: boolean;
}

/** Everything needed to decide whether a photo may be regenerated, in one read. */
export async function getRegenerationTarget(
  db: SqlClient,
  imageId: string,
): Promise<RegenerationTarget | null> {
  const { rows } = await db.query<{
    batch_id: string;
    sku: string;
    product_name: string;
    shot_idea: string | null;
    message_ts: string | null;
    prompt: string | null;
    state: string;
  }>(
    `select i.batch_id, i.sku, i.product_name, r.shot_idea, r.message_ts,
            i.prompt, b.state
       from images i
       join batch_rows r on r.batch_id = i.batch_id and r.sku = i.sku
       join batches b    on b.id = i.batch_id
      where i.id = $1`,
    [imageId],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    batchId: Number(row.batch_id),
    sku: row.sku,
    productName: row.product_name,
    shotIdea: row.shot_idea,
    messageTs: row.message_ts,
    prompt: row.prompt,
    frozen: row.state === "delivered",
  };
}

/**
 * Adds one more candidate to a product, at the end.
 *
 * Appended, never substituted. A regeneration is a new opinion about a shot,
 * not a correction of the record — the photo it was asked from stays exactly
 * where it was, decided or not. That is the same rule that makes an approved
 * image byte-identical forever.
 */
export async function addRegeneratedImage(
  db: SqlClient,
  input: {
    batchId: number;
    sku: string;
    productName: string;
    prompt: string;
    /** Named by the caller, because naming a file is not the database's job. */
    filenameFor: (slot: number) => string;
  },
): Promise<{ imageId: string; slot: number; filename: string }> {
  return db.transaction(async (tx) => {
    // The product's own row is locked first, so two people pressing Regenerate
    // at once cannot read the same max slot and collide on (batch, sku, slot).
    // The lock has to be on a real row — `for update` is not allowed on an
    // aggregate.
    await tx.query(
      `select 1 from batch_rows where batch_id = $1 and sku = $2 for update`,
      [input.batchId, input.sku],
    );

    const { rows } = await tx.query<{ next: number }>(
      `select coalesce(max(slot), 0) + 1 as next
         from images
        where batch_id = $1 and sku = $2`,
      [input.batchId, input.sku],
    );
    const slot = Number(rows[0]?.next ?? 1);

    const id = randomUUID();
    const filename = input.filenameFor(slot);

    await tx.query(
      `insert into images (id, batch_id, sku, product_name, slot, kind, filename, prompt)
       values ($1, $2, $3, $4, $5, 'styled', $6, $7)`,
      [id, input.batchId, input.sku, input.productName, slot, filename, input.prompt],
    );
    await tx.query(
      `insert into image_jobs (image_id, batch_id, state)
       values ($1, $2, 'pending_submit')`,
      [id, input.batchId],
    );

    return { imageId: id, slot, filename };
  });
}

/** The thread a product's photographs were posted into, if they have been. */
export async function getProductThread(
  db: SqlClient,
  batchId: number,
  sku: string,
): Promise<{ messageTs: string | null }> {
  const { rows } = await db.query<{ message_ts: string | null }>(
    `select message_ts from batch_rows where batch_id = $1 and sku = $2`,
    [batchId, sku],
  );
  return { messageTs: rows[0]?.message_ts ?? null };
}

export async function claimNextJob(
  db: SqlClient,
  batchId?: number,
  /**
   * Images to skip this pass — typically ones whose generation is still
   * running. Without this the loop re-polls the same job forever and never
   * reaches the work behind it.
   */
  excludeImageIds: string[] = [],
): Promise<PipelineJob | null> {
  const params: unknown[] = [];
  let nextParam = 1;
  if (batchId !== undefined) params.push(batchId);
  if (excludeImageIds.length > 0) params.push(excludeImageIds);

  const { rows } = await db.query<{
    image_id: string;
    batch_id: string;
    state: JobState;
    generation_id: string | null;
    attempts: number;
    sku: string;
    slot: number;
    filename: string;
    prompt: string | null;
    kind: ImageKind;
    object_key: string | null;
    photo_url: string;
  }>(
    `select j.image_id, j.batch_id, j.state, j.generation_id, j.attempts,
            i.sku, i.slot, i.filename, i.prompt, i.kind, i.object_key,
            r.photo_url
       from image_jobs j
       join images i     on i.id = j.image_id
       join batch_rows r on r.batch_id = i.batch_id and r.sku = i.sku
      where j.state not in ('posted', 'failed')
        -- A stored image waits for its siblings. Posting whichever candidate
        -- finished first scatters a product's shots through the stream, and
        -- adjacency is what makes a scrolled channel reviewable at all.
        --
        -- "Settled", not "succeeded": a sibling that failed is finished too,
        -- so one moderated candidate cannot hold the other two hostage.
        and (
          j.state <> 'stored'
          or not exists (
            select 1
              from image_jobs sj
              join images si on si.id = sj.image_id
             where sj.batch_id = j.batch_id
               and si.sku = i.sku
               and sj.state not in ('stored', 'posted', 'failed')
          )
        )
        ${batchId === undefined ? "" : `and j.batch_id = $${nextParam++}`}
        ${excludeImageIds.length === 0 ? "" : `and j.image_id <> all($${nextParam++}::uuid[])`}
      order by i.sku asc, i.slot asc
      limit 1`,
    params,
  );

  const row = rows[0];
  if (!row) return null;

  return {
    imageId: row.image_id,
    batchId: Number(row.batch_id),
    state: row.state,
    generationId: row.generation_id,
    attempts: row.attempts,
    sku: row.sku,
    slot: row.slot,
    filename: row.filename,
    prompt: row.prompt,
    kind: row.kind,
    objectKey: row.object_key,
    sourceUrl: row.photo_url,
  };
}

export async function setJobState(
  db: SqlClient,
  imageId: string,
  state: JobState,
  extra: {
    generationId?: string;
    failureCode?: string | null;
    lastError?: string | null;
    incrementAttempts?: boolean;
  } = {},
): Promise<void> {
  await db.query(
    `update image_jobs
        set state = $2,
            generation_id = coalesce($3, generation_id),
            failure_code  = $4,
            last_error    = $5,
            attempts      = attempts + $6,
            updated_at    = now()
      where image_id = $1`,
    [
      imageId,
      state,
      extra.generationId ?? null,
      extra.failureCode ?? null,
      extra.lastError ?? null,
      extra.incrementAttempts ? 1 : 0,
    ],
  );
}

/** Records the stored object alongside the state change, in one transaction. */
export async function markImageStored(
  db: SqlClient,
  imageId: string,
  stored: { objectKey: string; checksum: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `update images set object_key = $2, checksum = $3 where id = $1`,
      [imageId, stored.objectKey, stored.checksum],
    );
    await tx.query(
      `update image_jobs set state = 'stored', updated_at = now() where image_id = $1`,
      [imageId],
    );
  });
}

export async function markImagePosted(
  db: SqlClient,
  imageId: string,
  messageTs: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`update images set message_ts = $2 where id = $1`, [
      imageId,
      messageTs,
    ]);
    await tx.query(
      `update image_jobs set state = 'posted', updated_at = now() where image_id = $1`,
      [imageId],
    );
  });
}

export async function getImageByObjectKey(
  db: SqlClient,
  objectKey: string,
): Promise<{ id: string; filename: string } | null> {
  const { rows } = await db.query<{ id: string; filename: string }>(
    `select id, filename from images where object_key = $1`,
    [objectKey],
  );
  return rows[0] ?? null;
}

export async function setBatchState(
  db: SqlClient,
  batchId: number,
  state: string,
): Promise<void> {
  await db.query(`update batches set state = $2 where id = $1`, [batchId, state]);
}

/**
 * Batches whose every job has reached a terminal stage but which have not been
 * announced yet.
 *
 * Used to post the single "ready for review" mention exactly once, from the
 * worker rather than from the request that started the batch — a request does
 * not outlive a restart, and the batch has to be announced either way.
 */
export async function findBatchesAwaitingAnnouncement(
  db: SqlClient,
): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>(
    `select b.id
       from batches b
      where b.state = 'generating'
        and not exists (
          select 1 from image_jobs j
           where j.batch_id = b.id
             and j.state not in ('posted', 'failed')
        )
        and exists (select 1 from image_jobs j where j.batch_id = b.id)`,
  );
  return rows.map((r) => Number(r.id));
}

/** How a finished batch actually turned out, failures included. */
export async function batchOutcome(
  db: SqlClient,
  batchId: number,
): Promise<{ posted: number; failed: number }> {
  const { rows } = await db.query<{ posted: string; failed: string }>(
    `select
       count(*) filter (where state = 'posted') as posted,
       count(*) filter (where state = 'failed') as failed
     from image_jobs where batch_id = $1`,
    [batchId],
  );
  return {
    posted: Number(rows[0]?.posted ?? 0),
    failed: Number(rows[0]?.failed ?? 0),
  };
}

export interface ProductImage {
  imageId: string;
  /** Present only where the overview page needs it. */
  decision?: "approved" | "discarded" | null;
  slot: number;
  filename: string;
  prompt: string | null;
  kind: ImageKind;
  objectKey: string | null;
  jobState: JobState;
  failureCode: string | null;
  /**
   * What actually went wrong, when there is no Luma failure code to explain it.
   *
   * A pass-through never reaches Luma, so its failures are ours — a download
   * or a write — and without this they are indistinguishable from a silent
   * refusal by the model.
   */
  lastError?: string | null;
  /** How many times someone has asked for this exact shot again. */
  retries?: number;
}

/**
 * Every candidate for one product in one batch, in slot order.
 *
 * A product's shots are reviewed together, so they are fetched together —
 * including the ones that failed, which appear in the message as an
 * explanation rather than as an image.
 */
export async function getProductImages(
  db: SqlClient,
  batchId: number,
  sku: string,
): Promise<{ productName: string; shotIdea: string | null; images: ProductImage[] }> {
  const { rows } = await db.query<{
    image_id: string;
    slot: number;
    filename: string;
    prompt: string | null;
    kind: ImageKind;
    object_key: string | null;
    state: JobState;
    failure_code: string | null;
    last_error: string | null;
    retries: number;
    product_name: string;
    shot_idea: string | null;
    decision: string | null;
  }>(
    `select i.id as image_id, i.slot, i.filename, i.prompt, i.kind,
            i.object_key, j.state, j.failure_code, j.last_error, j.retries,
            i.product_name, r.shot_idea,
            case
              when a.image_id is not null then 'approved'
              when d.image_id is not null then 'discarded'
              else null
            end as decision
       from images i
       join image_jobs j            on j.image_id = i.id
       join batch_rows r            on r.batch_id = i.batch_id and r.sku = i.sku
       left join approved_images a  on a.image_id = i.id
       left join discarded_images d on d.image_id = i.id
      where i.batch_id = $1 and i.sku = $2
      order by i.slot asc`,
    [batchId, sku],
  );

  return {
    productName: rows[0]?.product_name ?? sku,
    shotIdea: rows[0]?.shot_idea ?? null,
    images: rows.map((r) => ({
      imageId: r.image_id,
      slot: r.slot,
      filename: r.filename,
      prompt: r.prompt,
      kind: r.kind,
      objectKey: r.object_key,
      jobState: r.state,
      failureCode: r.failure_code,
      lastError: r.last_error,
      retries: Number(r.retries ?? 0),
      decision: (r.decision as "approved" | "discarded" | null) ?? null,
    })),
  };
}

/** Marks a product's whole set posted against the one message carrying it. */
export async function markProductPosted(
  db: SqlClient,
  imageIds: string[],
  messageTs: string,
): Promise<void> {
  if (imageIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.query(`update images set message_ts = $2 where id = any($1::uuid[])`, [
      imageIds,
      messageTs,
    ]);
    await tx.query(
      `update image_jobs set state = 'posted', updated_at = now()
        where image_id = any($1::uuid[]) and state = 'stored'`,
      [imageIds],
    );
  });
}

/**
 * Assigns the batch its review token if it has none, and returns it.
 *
 * 128 bits from a CSPRNG — comfortably past OWASP's 64-bit floor for a
 * session-equivalent identifier, and the same shape as the object keys the
 * image route already relies on.
 */
export async function ensureReviewToken(
  db: SqlClient,
  batchId: number,
): Promise<string> {
  const { rows } = await db.query<{ review_token: string | null }>(
    `select review_token from batches where id = $1`,
    [batchId],
  );
  const existing = rows[0]?.review_token;
  if (existing) return existing;

  const token = randomBytes(16).toString("hex");
  await db.query(`update batches set review_token = $2 where id = $1`, [
    batchId,
    token,
  ]);
  return token;
}

export async function findBatchByReviewToken(
  db: SqlClient,
  token: string,
): Promise<Batch | null> {
  const { rows } = await db.query<{
    id: string;
    source_filename: string;
    state: string;
  }>(
    `select id, source_filename, state from batches where review_token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceFilename: row.source_filename,
    state: row.state,
  };
}

export async function setProductMessageTs(
  db: SqlClient,
  batchId: number,
  sku: string,
  messageTs: string,
  permalink?: string,
): Promise<void> {
  await db.query(
    `update batch_rows set message_ts = $3, permalink = coalesce($4, permalink)
      where batch_id = $1 and sku = $2`,
    [batchId, sku, messageTs, permalink ?? null],
  );
}

export type { ProductSummary as ProductView };

export interface ProductSummary {
  sku: string;
  productName: string;
  shotIdea: string | null;
  messageTs: string | null;
  /** A link straight into this product's Slack thread. */
  permalink: string | null;
  images: ProductImage[];
}

/** Every product in a batch with its candidates, for the overview page. */
export async function getBatchProducts(
  db: SqlClient,
  batchId: number,
): Promise<ProductSummary[]> {
  const { rows } = await db.query<{
    sku: string;
    product_name: string;
    shot_idea: string | null;
    message_ts: string | null;
    permalink: string | null;
    image_id: string | null;
    slot: number | null;
    filename: string | null;
    prompt: string | null;
    kind: ImageKind | null;
    object_key: string | null;
    state: JobState | null;
    failure_code: string | null;
    last_error: string | null;
    retries: number | null;
    decision: string | null;
  }>(
    `select r.sku, r.product_name, r.shot_idea, r.message_ts, r.permalink,
            i.id as image_id, i.slot, i.filename, i.prompt, i.kind,
            i.object_key, j.state, j.failure_code, j.last_error, j.retries,
            case
              when a.image_id is not null then 'approved'
              when d.image_id is not null then 'discarded'
              else null
            end as decision
       from batch_rows r
       left join images i           on i.batch_id = r.batch_id and i.sku = r.sku
       left join image_jobs j       on j.image_id = i.id
       left join approved_images a  on a.image_id = i.id
       left join discarded_images d on d.image_id = i.id
      where r.batch_id = $1
      order by r.row_index asc, i.slot asc`,
    [batchId],
  );

  const products = new Map<string, ProductSummary>();

  for (const row of rows) {
    let product = products.get(row.sku);
    if (!product) {
      product = {
        sku: row.sku,
        productName: row.product_name,
        shotIdea: row.shot_idea,
        messageTs: row.message_ts,
        permalink: row.permalink,
        images: [],
      };
      products.set(row.sku, product);
    }

    if (row.image_id) {
      product.images.push({
        imageId: row.image_id,
        slot: row.slot ?? 0,
        filename: row.filename ?? "",
        prompt: row.prompt,
        kind: row.kind ?? "styled",
        objectKey: row.object_key,
        jobState: row.state ?? "pending_submit",
        failureCode: row.failure_code,
        lastError: row.last_error,
        retries: Number(row.retries ?? 0),
        decision: (row.decision as "approved" | "discarded" | null) ?? null,
      });
    }
  }

  return [...products.values()];
}

export interface ImageLocation {
  imageId: string;
  batchId: number;
  sku: string;
  filename: string;
  /** The candidate's own message, inside the product's thread. */
  messageTs: string | null;
  /** The product's line in the channel. */
  productMessageTs: string | null;
}

/** Where an image is, so its decision can be reflected back into Slack. */
export async function getImageLocation(
  db: SqlClient,
  imageId: string,
): Promise<ImageLocation | null> {
  const { rows } = await db.query<{
    image_id: string;
    batch_id: string;
    sku: string;
    filename: string;
    message_ts: string | null;
    product_message_ts: string | null;
  }>(
    `select i.id as image_id, i.batch_id, i.sku, i.filename, i.message_ts,
            r.message_ts as product_message_ts
       from images i
       join batch_rows r on r.batch_id = i.batch_id and r.sku = i.sku
      where i.id = $1`,
    [imageId],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    imageId: row.image_id,
    batchId: Number(row.batch_id),
    sku: row.sku,
    filename: row.filename,
    messageTs: row.message_ts,
    productMessageTs: row.product_message_ts,
  };
}

/** True once a batch has been confirmed, after which it is frozen. */
export async function isBatchFrozen(
  db: SqlClient,
  batchId: number,
): Promise<boolean> {
  const { rows } = await db.query<{ state: string }>(
    `select state from batches where id = $1`,
    [batchId],
  );
  return rows[0]?.state === "delivered";
}

export async function getBatchState(db: SqlClient, batchId: number): Promise<string> {
  const { rows } = await db.query<{ state: string }>(
    `select state from batches where id = $1`,
    [batchId],
  );
  return rows[0]?.state ?? "uploaded";
}

export interface ApprovedImage {
  imageId: string;
  sku: string;
  filename: string;
  objectKey: string;
  checksum: string | null;
}

/**
 * The approved images of one batch, in catalog order.
 *
 * Membership is the filter, so a discarded image cannot appear here by any
 * route — which is the property that keeps the wrong file out of the export.
 */
export async function getApprovedImages(
  db: SqlClient,
  batchId: number,
): Promise<ApprovedImage[]> {
  const { rows } = await db.query<{
    image_id: string;
    sku: string;
    filename: string;
    object_key: string | null;
    checksum: string | null;
  }>(
    `select i.id as image_id, i.sku, i.filename, i.object_key, i.checksum
       from approved_images a
       join images i     on i.id = a.image_id
       join batch_rows r on r.batch_id = i.batch_id and r.sku = i.sku
      where a.batch_id = $1 and i.object_key is not null
      order by r.row_index asc, i.slot asc`,
    [batchId],
  );

  return rows.map((r) => ({
    imageId: r.image_id,
    sku: r.sku,
    filename: r.filename,
    objectKey: r.object_key!,
    checksum: r.checksum,
  }));
}

/**
 * Counts over the images that can actually be decided.
 *
 * An image whose generation failed is never posted with buttons, so it can
 * never enter either relation. Counting it as outstanding leaves a batch
 * permanently unconfirmable — and makes this disagree with `/luma status`,
 * which has always excluded failures.
 */
export async function batchDecisionCounts(
  db: SqlClient,
  batchId: number,
): Promise<{ decidable: number; approved: number; discarded: number; pending: number }> {
  // Pending is counted directly rather than derived by subtraction. A photo
  // that never arrived may still be discarded — an explicit "not pursuing
  // this" — and subtracting a discarded-but-failed image from a total that
  // excluded it drove the count negative, which reads as "never finished".
  const { rows } = await db.query<{
    pending: string;
    approved: string;
    discarded: string;
  }>(
    `select
       (select count(*)
          from images i
          join image_jobs j            on j.image_id = i.id
          left join approved_images a  on a.image_id = i.id
          left join discarded_images d on d.image_id = i.id
         where i.batch_id = $1
           and a.image_id is null
           and d.image_id is null
           and j.state <> 'failed') as pending,
       (select count(*) from approved_images  where batch_id = $1) as approved,
       (select count(*) from discarded_images where batch_id = $1) as discarded`,
    [batchId],
  );

  const row = rows[0]!;
  const pending = Number(row.pending);
  const approved = Number(row.approved);
  const discarded = Number(row.discarded);
  return { decidable: pending + approved + discarded, approved, discarded, pending };
}

/**
 * Puts a photo that never arrived back in the queue.
 *
 * Attempts are reset, not continued: the job already exhausted them, and the
 * person asking has usually just fixed whatever caused it. Re-running the same
 * row rather than appending a new one, because the shot that is missing is
 * this one — a reshoot is for wanting something different.
 */
export async function retryFailedImage(
  db: SqlClient,
  imageId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { rows } = await db.query<{ kind: ImageKind; state: JobState; batch_state: string }>(
    `select i.kind, j.state, b.state as batch_state
       from images i
       join image_jobs j on j.image_id = i.id
       join batches b    on b.id = i.batch_id
      where i.id = $1`,
    [imageId],
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: "That photo doesn't exist." };
  if (row.state !== "failed") {
    return { ok: false, reason: "That photo hasn't failed, so there is nothing to retry." };
  }
  if (row.batch_state === "delivered") {
    return {
      ok: false,
      reason:
        "This batch has been confirmed and handed over, so it can't be changed.",
    };
  }

  await db.query(
    `update image_jobs
        set state = $2, attempts = 0, failure_code = null, last_error = null,
            generation_id = null, retries = retries + 1, updated_at = now()
      where image_id = $1`,
    [imageId, row.kind === "pass_through" ? "pending_fetch" : "pending_submit"],
  );
  return { ok: true };
}

/** Remembered so the pin can be lifted when the batch is handed over. */
export async function setIntroMessageTs(
  db: SqlClient,
  batchId: number,
  messageTs: string,
): Promise<void> {
  await db.query(`update batches set intro_message_ts = $2 where id = $1`, [
    batchId,
    messageTs,
  ]);
}

export async function getIntroMessageTs(
  db: SqlClient,
  batchId: number,
): Promise<string | null> {
  const { rows } = await db.query<{ intro_message_ts: string | null }>(
    `select intro_message_ts from batches where id = $1`,
    [batchId],
  );
  return rows[0]?.intro_message_ts ?? null;
}

/**
 * Moves a batch's state only if it is where we expect.
 *
 * Returns false when it was not, which makes a read-then-write pair safe
 * against two deferred tasks arriving together.
 */
export async function transitionBatchState(
  db: SqlClient,
  batchId: number,
  from: string,
  to: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `update batches set state = $3 where id = $1 and state = $2 returning id`,
    [batchId, from, to],
  );
  return rows.length > 0;
}
