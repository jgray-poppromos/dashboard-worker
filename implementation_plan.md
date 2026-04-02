# Error Dashboard Worker — Implementation Plan

## Overview

Build a `dashboard-worker.js` Cloudflare Worker that:
1. Serves `index.html` as a static shell
2. Ingests webhook errors from 3 automation workers → stores in KV → forwards to Slack
3. Serves the event feed back to the dashboard
4. Accepts per-order clear commands

Then update `index.html` to strip Preview Mode blocks and call live endpoints, and write `wrangler.toml` + SOP.

---

## User Review Required

> [!IMPORTANT]
> **I need the 3 Sugar report IDs before executing.** The HTML already has the placeholder config:
> ```js
> prodfiles:  { reportId: "REPLACE_WITH_PROD_FILES_REPORT_ID", ... }
> prodphotos: { reportId: "REPLACE_WITH_PROD_PHOTOS_REPORT_ID", ... }
> proofs:     { reportId: "REPLACE_WITH_PROOFS_REPORT_ID", ... }
> ```
> I'll leave these as the same placeholder strings in the final files so you can fill them in — I won't invent IDs.

> [!IMPORTANT]
> **Worker subdomain name.** The HTML already references `dashboard-worker.poppromos.workers.dev`. I'll use `dashboard-worker` as the Cloudflare Worker name in `wrangler.toml`. Confirm this matches your Cloudflare account routing, or tell me to use a different name.

> [!NOTE]
> **Feed polling interval.** The existing HTML polls every 15 seconds (`FEED_POLL_MS = 15000`). You requested 60 seconds in the spec. I'll change the poll to 60s when I remove Preview Mode, since the Preview Mode fake-latency was the only reason 15s felt snappy. Just confirm.

> [!NOTE]
> **The `clearOrderErrors` function in index.html currently only dismisses locally** (session-only). In live mode it will call `POST /clear/order/:orderNumber` on the worker, which deletes matching KV keys. The session-level `feedState.dismissed` Set is kept as a UI optimization so cards don't flicker back in before the next poll.

---

## Proposed Changes

### New Files

#### [NEW] dashboard-worker.js

A single-file Cloudflare Worker (no bundler needed). Routes:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Returns `index.html` as `text/html` (HTML is embedded as a JS string literal in the worker) |
| `POST` | `/webhook` | Authenticated via `X-Webhook-Secret` header. Validates JSON body, stores KV event, fires Slack non-blocking |
| `GET` | `/events` | Lists all KV keys w/ prefix `event:`, fetches values, returns newest-first array capped at 200 |
| `POST` | `/clear/order/:orderNumber` | Authenticated. Lists all `event:` keys, deletes those matching the order number |

**KV key format:** `event:<timestamp_ms>:<random6>` (e.g. `event:1743441895000:a3f9c2`)  
**KV TTL:** 172800 seconds (48h)  
**Slack message format:** Block Kit with worker name tag, order number hyperlinked to Sugar record, error message body  
**CORS:** Will add permissive `Access-Control-Allow-Origin: *` headers so the dashboard HTML (served from a different origin or file://) can call the endpoints

**Security:**
- `/webhook` and `/clear/order/...` check `X-Webhook-Secret` against `env.WEBHOOK_SECRET`
- `/events` is unauthenticated (dashboard is internal-only, errors are not sensitive)
- Will add a note to lock down `/events` with a read token if needed in future

**HTML embedding strategy:** The worker will store the HTML inline as a JS template literal. This avoids needing an asset binding or KV for the HTML file, keeping the deploy simple. The HTML is ~64KB which is fine for a Worker script.

#### [NEW] wrangler.toml

```toml
name = "dashboard-worker"
main = "dashboard-worker.js"
compatibility_date = "2024-01-01"

[observability]
enabled = true
head_sampling_rate = 1

kv_namespaces = [
  { binding = "DASHBOARD_KV", id = "REPLACE_WITH_KV_NAMESPACE_ID" }
]

[vars]
# No plaintext vars needed - all sensitive values are secrets

# Secrets (set via wrangler secret put):
# - WEBHOOK_SECRET
# - SLACK_WEBHOOK_URL

# Optional future cron trigger (uncomment to enable):
# [triggers]
# crons = ["0 */1 * * *"]   # hourly cleanup of expired events (KV TTL handles this automatically)
```

#### [NEW] worker_operation.md

Full SOP documenting:
- Architecture overview
- Webhook contract (fields, auth)
- KV schema
- How to rotate secrets
- How to update report IDs
- Endpoint reference
- How to update existing workers to post to the webhook

#### [NEW] .cursorrules

Standard project `.cursorrules` file.

---

### Modified Files

#### [MODIFY] index.html

**Changes (surgical, not a full rewrite):**

1. **Remove PREVIEW MODE block in `fetchReport()`** (lines 761–766):
   - Delete the `if (SEED_DATA[key])` early-return block
   - The live proxy fetch below it is already correct (`${PROXY_BASE}/api/v8/Reports/${reportId}/records?max_num=500`)

2. **Remove SEED_DATA constant** (lines 665–753):
   - The entire `const SEED_DATA = { ... }` block

3. **Remove SEED_EVENTS constant** (lines 1086–1103):
   - The entire `const SEED_EVENTS = [ ... ]` block

4. **Replace Preview Mode block in `fetchFeedEvents()`** (lines 1225–1234):
   - Remove the fake-latency `await`/`return SEED_EVENTS` lines
   - Uncomment and clean up the real `fetch()` call

5. **Update `clearOrderErrors()`** (lines 1210–1220):
   - Remove the comment-stub about calling the worker
   - Add a real non-blocking `fetch()` call to `POST /clear/order/${orderNumber}` (fire-and-forget, no auth header needed from browser — the clear endpoint auth is optional, see design note below)
   - Keep the local `feedState.dismissed` add for instant UI response

6. **Update `autoClearFromReports()`** (lines 1185–1195):
   - After dismissing, also call `POST /clear/order/:orderNumber` for each newly cleared order

7. **Update `FEED_POLL_MS`** from `15000` → `60000`

> [!NOTE]
> **Clear endpoint authentication from the browser:** The `POST /clear/order/...` is called from the browser. Since `WEBHOOK_SECRET` should not be embedded in client-side JS, the clear endpoint will **not** require auth. It's an internal ops tool behind no public link — acceptable risk. The `/webhook` endpoint (posted to by workers server-side) is the one that must be authenticated.

---

## Verification Plan

### Manual Verification (after deploy)
1. `wrangler dev --local` to test locally before deploying
2. Curl the `/webhook` endpoint with a test payload to confirm KV write + Slack post
3. Hit `/events` in browser to confirm JSON returns correctly
4. Open dashboard in browser, confirm report tabs load (will need real report IDs)
5. Confirm error feed cards appear and Clear button works
6. Confirm auto-clear fires after a manual Refresh with a resolved order

### Automated PowerShell Test (in `_debug/`)
Create `_debug/test-webhook.ps1` that posts a test event to the worker and then reads `/events` to confirm it round-trips.
