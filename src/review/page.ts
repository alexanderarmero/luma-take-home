import type { ReviewState } from "./state.js";

/** Minimal escaping; every interpolated value is customer data. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATE_LABEL: Record<string, string> = {
  generating: "generating…",
  ready: "awaiting a decision",
  approved: "approved",
  discarded: "discarded",
  failed: "couldn't be generated",
};

/**
 * The read-only overview.
 *
 * Read-only on purpose: approvals stay in Slack, where the platform tells us
 * who clicked. A page reached by a shared link could not say who decided, and
 * "Ellie's pick is the decision" would drop from enforced to conventional.
 *
 * Self-contained — no external stylesheet, script or font — so it renders on a
 * phone with no network beyond the images themselves.
 */
export function renderReviewPage(state: ReviewState, token: string): string {
  const { totals } = state;
  const done = totals.approved + totals.discarded;
  const percent = totals.images === 0 ? 0 : Math.round((done / totals.images) * 100);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Batch ${state.batchId} · ${esc(state.sourceFilename)}</title>
<meta property="og:title" content="Batch ${state.batchId} — ${totals.images} shots">
<meta property="og:description" content="${totals.approved} approved · ${totals.pending} still to review">
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --card:#fafafa; --accent:#2b6cb0; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#15171a; --fg:#e8e8e8; --muted:#9aa0a6; --line:#2a2d31; --card:#1c1f23; --accent:#7cb3ea; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 20px 16px 64px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:14px; margin-bottom:20px; }
  .bar { height:8px; background:var(--line); border-radius:4px; overflow:hidden; margin:14px 0 6px; }
  .bar > i { display:block; height:100%; background:var(--accent); width:${percent}%; transition:width .4s; }
  .stats { display:flex; flex-wrap:wrap; gap:8px 18px; font-size:14px; color:var(--muted); margin-bottom:8px; }
  .stats b { color:var(--fg); }
  .live { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--muted); }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); animation:p 1.4s infinite; }
  @keyframes p { 0%,100%{opacity:1} 50%{opacity:.25} }
  .product { border:1px solid var(--line); border-radius:10px; padding:14px; margin:14px 0; background:var(--card); }
  .product h2 { font-size:15px; margin:0 0 2px; }
  .idea { color:var(--muted); font-size:14px; font-style:italic; margin:0 0 12px; }
  .shots { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  figure { margin:0; }
  figure img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:8px; background:var(--line); display:block; }
  .ph { width:100%; aspect-ratio:1; border-radius:8px; background:var(--line);
        display:grid; place-items:center; color:var(--muted); font-size:13px; text-align:center; padding:8px; }
  figcaption { font-size:12px; color:var(--muted); margin-top:6px; word-break:break-all; }
  .tag { display:inline-block; font-size:11px; padding:2px 7px; border-radius:99px;
         border:1px solid var(--line); margin-top:4px; }
  .approved { color:#2f855a; border-color:#2f855a; }
  .discarded { color:#a0522d; border-color:#a0522d; }
  .failed { color:#c53030; border-color:#c53030; }
  footer { color:var(--muted); font-size:13px; margin-top:28px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Batch ${state.batchId}</h1>
  <div class="sub">${esc(state.sourceFilename)}</div>

  <div class="bar"><i></i></div>
  <div class="stats">
    <span><b>${totals.products}</b> products</span>
    <span><b>${totals.images}</b> photos</span>
    <span><b>${totals.approved}</b> approved</span>
    <span><b>${totals.discarded}</b> discarded</span>
    <span><b>${totals.pending}</b> still to review</span>
    ${totals.failed > 0 ? `<span><b>${totals.failed}</b> couldn't be generated</span>` : ""}
    <span>$${state.spentUsd.toFixed(2)} spent</span>
  </div>
  ${
    state.inProgress
      ? `<div class="live"><span class="dot"></span>Still generating — this page updates itself.</div>`
      : ""
  }

  ${state.products.map(renderProduct).join("\n")}

  <footer>
    Read-only. Approve and discard in Slack, in each product's thread.
  </footer>
</div>
<script>
  // Polling rather than a stream: a failed poll retries, whereas a dropped
  // connection leaves a progress page looking finished when it is not.
  const TOKEN = ${JSON.stringify(token)};
  const REVISION = ${JSON.stringify(state.revision)};
  async function refresh() {
    try {
      const res = await fetch("/api/review/" + TOKEN, { cache: "no-store" });
      if (!res.ok) return;
      const next = await res.json();
      // Reload only when something actually changed, so a page being read
      // does not flicker every four seconds.
      if (next.revision !== REVISION) location.reload();
    } catch (_) { /* a transient failure is just the next poll's problem */ }
  }
  if (${state.inProgress}) setInterval(refresh, 4000);
</script>
</body>
</html>`;
}

function renderProduct(product: ReviewState["products"][number]): string {
  const idea = product.isPassThrough
    ? "No shot idea was given — the original photo, unchanged."
    : `"${product.shotIdea ?? ""}"`;

  return `<section class="product">
    <h2>${esc(product.sku)} · ${esc(product.productName)}</h2>
    <p class="idea">${esc(idea)}</p>
    <div class="shots">
      ${product.candidates.map(renderCandidate).join("\n")}
    </div>
  </section>`;
}

function renderCandidate(candidate: ReviewState["products"][number]["candidates"][number]): string {
  const label = STATE_LABEL[candidate.state] ?? candidate.state;
  const tagClass = ["approved", "discarded", "failed"].includes(candidate.state)
    ? candidate.state
    : "";

  const visual = candidate.imageUrl
    ? `<img src="${esc(candidate.imageUrl)}" alt="${esc(candidate.filename)}" loading="lazy">`
    : `<div class="ph">${candidate.state === "failed" ? "not generated" : "generating…"}</div>`;

  return `<figure>
    ${visual}
    <figcaption>${esc(candidate.filename)}<br>
      <span class="tag ${tagClass}">${esc(label)}</span>
    </figcaption>
  </figure>`;
}
