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
export interface Viewer {
  /** Whether this request may approve, discard and confirm. */
  canWrite: boolean;
}

export function renderReviewPage(
  state: ReviewState,
  token: string,
  viewer: Viewer = { canWrite: false },
): string {
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
  .thread { font-size:13px; color:var(--accent); text-decoration:none; }
  .thread:hover { text-decoration:underline; }
  .acts { display:flex; gap:6px; margin-top:6px; }
  .acts button { flex:1; padding:6px 4px; font-size:12px; cursor:pointer;
                 border:1px solid var(--line); border-radius:6px;
                 background:var(--bg); color:var(--fg); }
  .acts button:hover { border-color:var(--accent); }
  .acts button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .acts button[disabled] { opacity:.5; cursor:default; }
  .reshoot { margin-top:6px; }
  .reshoot > button.ask { width:100%; padding:6px 4px; font-size:12px;
                          cursor:pointer; border:1px solid var(--line);
                          border-radius:6px; background:var(--bg);
                          color:var(--muted); }
  .reshoot > button.ask:hover { border-color:var(--accent); color:var(--fg); }
  .reshoot textarea { width:100%; box-sizing:border-box; margin-top:6px;
                      padding:8px; font:inherit; font-size:13px;
                      border:1px solid var(--line); border-radius:6px;
                      background:var(--bg); color:var(--fg); resize:vertical; }
  .reshoot .note { margin:6px 0; font-size:11px; color:var(--muted); }
  .reshoot .form button { padding:6px 10px; font-size:12px; cursor:pointer;
                          border:1px solid var(--line); border-radius:6px;
                          background:var(--bg); color:var(--fg); }
  .reshoot .form button.go { background:var(--accent); border-color:var(--accent);
                             color:#fff; }
  .confirm { border:1px solid var(--accent); border-radius:10px; padding:16px;
             margin-top:24px; }
  .confirm p { margin:0 0 12px; font-size:14px; }
  button.primary { padding:10px 16px; font-size:15px; cursor:pointer;
                   border:0; border-radius:8px; background:var(--accent); color:#fff; }
  button.primary.armed { background:#b42318; }
  #toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%);
           background:var(--fg); color:var(--bg); padding:10px 16px;
           border-radius:8px; font-size:14px; display:none; max-width:90vw; }
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

  ${state.products.map((p) => renderProduct(p, viewer)).join("\n")}

  ${
    viewer.canWrite && totals.pending === 0 && totals.images > 0 && state.batchState !== "delivered"
      ? `<div class="confirm">
           <p><b>Everything has been decided.</b> Confirming hands these to the
           web person and freezes the batch — decisions can't be changed
           afterwards.</p>
           <button class="primary" id="confirm">Confirm and hand over</button>
         </div>`
      : ""
  }

  <footer>
    ${
      viewer.canWrite
        ? "You're signed in — your decisions save as you make them."
        : "Read-only. Run <code>/luma signin</code> in Slack to get a link that lets you decide."
    }
  </footer>
</div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
  // Polling rather than a stream: a failed poll retries, whereas a dropped
  // connection leaves a progress page looking finished when it is not.
  const TOKEN = ${JSON.stringify(token)};
  const REVISION = ${JSON.stringify(state.revision)};

  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 4000);
  }

  async function send(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Same-origin, and the cookie is SameSite=Lax, so a cross-site form
      // cannot forge one of these.
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
    if (res.status === 403) {
      toast("Your sign-in has expired or your access was removed. Run /luma signin again.");
    } else {
      const detail = await res.json().catch(() => null);
      toast(detail?.reason ?? "That didn't save — try again.");
    }
    return false;
  }

  document.querySelectorAll(".acts").forEach((group) => {
    const imageId = group.dataset.image;
    group.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", async () => {
        const decision = button.classList.contains("approve") ? "approve" : "discard";
        group.querySelectorAll("button").forEach((b) => (b.disabled = true));
        const ok = await send("/api/review/" + TOKEN + "/decide", { imageId, decision });
        if (ok) location.reload();
        else group.querySelectorAll("button").forEach((b) => (b.disabled = false));
      });
    });
  });

  document.querySelectorAll(".reshoot").forEach((box) => {
    const imageId = box.dataset.image;
    const ask = box.querySelector("button.ask");
    const form = box.querySelector(".form");
    const text = box.querySelector("textarea");

    ask.addEventListener("click", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) text.focus();
    });
    box.querySelector("button.cancel").addEventListener("click", () => {
      form.hidden = true;
    });

    box.querySelector("button.go").addEventListener("click", async () => {
      const go = box.querySelector("button.go");
      go.disabled = true;
      const ok = await send("/api/review/" + TOKEN + "/regenerate", {
        imageId,
        prompt: text.value,
      });
      go.disabled = false;
      if (ok) {
        form.hidden = true;
        toast("Asked for another. It'll appear here and in the thread.");
        // Not a reload: the new shot does not exist yet, and the poll is
        // what notices it arriving.
      }
    });
  });

  const confirmButton = document.getElementById("confirm");
  if (confirmButton) {
    // Two taps, because this one cannot be undone and it sits on the same
    // page as every approve and discard button. The first tap only arms it.
    let armed = false;
    confirmButton.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        confirmButton.textContent = "Tap again to freeze this batch";
        confirmButton.classList.add("armed");
        setTimeout(() => {
          if (!armed) return;
          armed = false;
          confirmButton.textContent = "Confirm and hand over";
          confirmButton.classList.remove("armed");
        }, 5000);
        return;
      }
      confirmButton.disabled = true;
      const ok = await send("/api/review/" + TOKEN + "/confirm", {});
      if (ok) location.reload();
      else {
        armed = false;
        confirmButton.disabled = false;
        confirmButton.textContent = "Confirm and hand over";
        confirmButton.classList.remove("armed");
      }
    });
  }
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
  // Keep polling after generation finishes: write access is a list, so two
  // people can be deciding at the same time and neither should act on a
  // stale view. Slower once there is nothing being generated.
  setInterval(refresh, ${state.inProgress ? 4000 : 15000});
</script>
</body>
</html>`;
}

function renderProduct(
  product: ReviewState["products"][number],
  viewer: Viewer,
): string {
  const idea = product.isPassThrough
    ? "No shot idea was given — the original photo, unchanged."
    : `"${product.shotIdea ?? ""}"`;

  // Anchored by SKU so a Slack message can link straight to this product.
  return `<section class="product" id="p-${esc(product.sku)}">
    <h2>${esc(product.sku)} · ${esc(product.productName)}</h2>
    <p class="idea">${esc(idea)}</p>
    ${
      product.threadUrl
        ? `<p><a class="thread" href="${esc(product.threadUrl)}" target="_blank" rel="noopener">Open Slack thread</a></p>`
        : ""
    }
    <div class="shots">
      ${product.candidates.map((c) => renderCandidate(c, viewer, product)).join("\n")}
    </div>
  </section>`;
}

function renderCandidate(
  candidate: ReviewState["products"][number]["candidates"][number],
  viewer: Viewer,
  product: ReviewState["products"][number],
): string {
  const label = STATE_LABEL[candidate.state] ?? candidate.state;
  const tagClass = ["approved", "discarded", "failed"].includes(candidate.state)
    ? candidate.state
    : "";

  const visual = candidate.imageUrl
    ? `<img src="${esc(candidate.imageUrl)}" alt="${esc(candidate.filename)}" loading="lazy">`
    : `<div class="ph">${candidate.state === "failed" ? "not generated" : "generating…"}</div>`;

  const decidable = viewer.canWrite && candidate.state !== "failed" && candidate.imageUrl;

  // A reshoot is posted into the product's thread, and a product with no
  // thread yet has nowhere to put it. Offered on a failed shot too — a shot
  // that never arrived is exactly when you want to ask for another.
  const reshootable =
    viewer.canWrite && product.hasThread && !product.isPassThrough;

  return `<figure>
    ${visual}
    <figcaption>${esc(candidate.filename)}<br>
      <span class="tag ${tagClass}">${esc(label)}</span>
    </figcaption>
    ${
      decidable
        ? `<div class="acts" data-image="${esc(candidate.imageId)}">
             <button class="approve${candidate.state === "approved" ? " on" : ""}">Approve</button>
             <button class="discard${candidate.state === "discarded" ? " on" : ""}">Discard</button>
           </div>`
        : ""
    }
    ${
      reshootable
        ? `<div class="reshoot" data-image="${esc(candidate.imageId)}">
             <button class="ask">Ask for another</button>
             <div class="form" hidden>
               <textarea rows="4" placeholder="Describe the shot you want.">${esc(candidate.prompt ?? "")}</textarea>
               <p class="note">One shot, made from exactly what you write — nothing rewrites it. It joins this product's thread; nothing here is replaced.</p>
               <button class="go">Make it</button>
               <button class="cancel">Cancel</button>
             </div>
           </div>`
        : ""
    }
  </figure>`;
}
