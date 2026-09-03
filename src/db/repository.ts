import { randomUUID } from "node:crypto";
import type { SqlClient } from "./client.js";
import { inTransaction } from "./client.js";

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
  const created: Image[] = [];

  for (const image of images) {
    const id = randomUUID();
    await db.query(
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
    // rows in non-terminal states, so an image with no row is invisible to it.
    await db.query(
      `insert into image_jobs (image_id, batch_id, state) values ($1, $2, $3)`,
      [id, batchId, image.kind === "pass_through" ? "pending_submit" : "pending_submit"],
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
}

/**
 * Records a decision as membership.
 *
 * The delete-then-insert pair runs in one transaction so an image can never be
 * observed in both relations, and the event is appended in the same
 * transaction so the audit log can never disagree with the state it describes.
 */
export async function recordDecision(
  db: SqlClient,
  input: { imageId: string; batchId: number; decision: Decision; actor: string },
): Promise<void> {
  const { imageId, batchId, decision, actor } = input;
  const target = decision === "approve" ? "approved_images" : "discarded_images";
  const other = decision === "approve" ? "discarded_images" : "approved_images";

  await inTransaction(db, async (tx) => {
    await tx.query(`delete from ${other} where image_id = $1`, [imageId]);
    await tx.query(
      `insert into ${target} (image_id, batch_id, actor) values ($1, $2, $3)
       on conflict (image_id) do nothing`,
      [imageId, batchId, actor],
    );
    await tx.query(
      `insert into decision_events (image_id, batch_id, decision, actor)
       values ($1, $2, $3, $4)`,
      [imageId, batchId, decision, actor],
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
