/**
 * Ordered, append-only migrations. Never edit a released one — add another.
 *
 * The shape here encodes decisions from the design:
 *  - images carry NO decision status column; decision state is membership
 *  - approved and discarded are separate relations, so all three states
 *    (approved / discarded / pending) are plain membership checks
 *  - the event log is append-only audit; nothing operational reads it
 *  - pipeline state lives on the job row, which is a different concern from
 *    decision state and is allowed a status column
 *  - a pass-through image starts at 'pending_fetch', not 'pending_submit':
 *    its output is the customer's original photo, so it must never enter the
 *    paid submission path
 *  - the delivered pointer is deliberately distinct from "highest batch id",
 *    so an unconfirmed batch is structurally unreachable by retrieval
 */
export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  {
    name: "0001_initial",
    sql: `
      create table batches (
        id              bigserial primary key,
        source_filename text        not null,
        state           text        not null default 'uploaded',
        uploaded_at     timestamptz not null default now(),
        constraint batches_state_valid check (state in (
          'uploaded', 'generating', 'ready_for_review', 'complete', 'delivered'
        ))
      );

      -- Singleton row. The pointer only ever moves on a human confirmation,
      -- which is what makes an unconfirmed batch unreachable by retrieval.
      create table delivered_pointer (
        only_row   boolean     primary key default true,
        batch_id   bigint      references batches(id),
        updated_at timestamptz not null default now(),
        constraint delivered_pointer_singleton check (only_row)
      );
      insert into delivered_pointer (only_row, batch_id) values (true, null);

      create table images (
        id           uuid        primary key,
        batch_id     bigint      not null references batches(id),
        sku          text        not null,
        product_name text        not null,
        slot         int         not null,
        kind         text        not null,
        filename     text        not null,
        prompt       text,
        object_key   text,
        checksum     text,
        created_at   timestamptz not null default now(),
        constraint images_kind_valid check (kind in ('styled', 'pass_through')),
        constraint images_slot_unique unique (batch_id, sku, slot)
      );
      create index images_batch_idx on images (batch_id);

      create table approved_images (
        image_id   uuid        primary key references images(id),
        batch_id   bigint      not null references batches(id),
        actor      text        not null,
        created_at timestamptz not null default now()
      );
      create index approved_images_batch_idx on approved_images (batch_id);

      create table discarded_images (
        image_id   uuid        primary key references images(id),
        batch_id   bigint      not null references batches(id),
        actor      text        not null,
        created_at timestamptz not null default now()
      );
      create index discarded_images_batch_idx on discarded_images (batch_id);

      -- Append-only. Audit and provenance only; no operational read path.
      create table decision_events (
        id         bigserial   primary key,
        image_id   uuid        not null references images(id),
        batch_id   bigint      not null references batches(id),
        decision   text        not null,
        actor      text        not null,
        created_at timestamptz not null default now(),
        constraint decision_events_decision_valid check (decision in ('approve', 'discard'))
      );
      create index decision_events_image_idx on decision_events (image_id);

      create table image_jobs (
        image_id      uuid        primary key references images(id),
        batch_id      bigint      not null references batches(id),
        state         text        not null default 'pending_submit',
        generation_id text,
        attempts      int         not null default 0,
        failure_code  text,
        last_error    text,
        updated_at    timestamptz not null default now(),
        constraint image_jobs_state_valid check (state in (
          'pending_submit', 'pending_fetch', 'submitted', 'completed',
          'stored', 'posted', 'failed'
        ))
      );
      create index image_jobs_state_idx on image_jobs (state);
    `,
  },
  {
    name: "0002_batch_rows",
    sql: `
      -- The parsed catalog, stored at ingest so a batch is self-contained.
      -- Re-reading the uploaded file at generation time would depend on Slack
      -- still hosting it, and on it not having changed underneath us.
      create table batch_rows (
        id           bigserial   primary key,
        batch_id     bigint      not null references batches(id),
        row_index    int         not null,
        sku          text        not null,
        product_name text        not null,
        category     text        not null,
        colour       text        not null,
        material     text        not null,
        price        text        not null,
        photo_url    text        not null,
        shot_idea    text,
        constraint batch_rows_sku_unique unique (batch_id, sku)
      );
      create index batch_rows_batch_idx on batch_rows (batch_id, row_index);
    `,
  },
  {
    name: "0003_image_message_ts",
    sql: `
      -- Recorded so a decided image can be rewritten in place. Without it the
      -- stream is an archive of undifferentiated candidates rather than a
      -- work queue.
      alter table images add column message_ts text;
    `,
  },
  {
    name: "0004_review_surface",
    sql: `
      -- An unguessable per-batch token. The overview page is read-only, so a
      -- capability link is proportionate: it exposes product photos bound for
      -- a public website, not anything that can act.
      alter table batches add column review_token text unique;

      -- The product's message in the channel. Its thread holds the candidate
      -- images, so discussion lands beside the comparison it is about, and the
      -- channel itself stays scannable text.
      alter table batch_rows add column message_ts text;
    `,
  },
];
