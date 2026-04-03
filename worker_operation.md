# Dashboard Worker - Operations Guide

The `dashboard-worker` acts as the backend aggregator and static web host for the Error Dashboard UI.

## Architecture

* **`dashboard-worker.js`**: The main Cloudflare Worker that intercepts incoming routes.
* **`index.html`**: The frontend UI, imported natively by the worker and served at `GET /`.
* **KV Namespace (`DASHBOARD_KV`)**: The persistent storage for active errors from other workers. Events expire automatically after 48 hours via Cloudflare TTL.

## Endpoints

1. **`GET /`** - Serves the HTML dashboard interface.
2. **`GET /events`** - Returns a JSON array of active errors from `DASHBOARD_KV`. Limit is set to 200 via `list({ limit })`.
3. **`POST /webhook`** - Called by the external workers (e.g. `production-process`).
    * Takes `X-Webhook-Secret` for authentication.
    * If `status: "success"`, it actively deletes any active error states for the provided `order_number`.
    * Otherwise, it stores the error state into the KV.
4. **`POST /clear/order/:orderNumber`** - Exposed for the frontend so that the "Clear" button successfully purges an order's active error state.

## To Set Up Worker Communication

When updating external workers to send signals to the Dashboard, follow this contract:

1. Add a secret via `wrangler secret put DASHBOARD_WEBHOOK_URL` in the external worker to point to `https://dashboard-worker.poppromos.workers.dev/webhook`.
2. Add a secret via `wrangler secret put DASHBOARD_WEBHOOK_SECRET` matching the Dashboard Worker's `WEBHOOK_SECRET`.
3. In their script, use:

```javascript
fetch(env.DASHBOARD_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Secret': env.DASHBOARD_WEBHOOK_SECRET
  },
  body: JSON.stringify({
    order_number: "...",
    worker: "production-process",
    error_message: "...", // Only if it failed
    status: "success",    // Set "success" to clear an active error automatically!
    sugar_record_id: "...",
  })
})
```

## First Deployment Instructions

1. `npx wrangler kv namespace create DASHBOARD_KV`
2. Update the `wrangler.toml` file with the returned ID.
3. Add the Webhook Secret:
   `npx wrangler secret put WEBHOOK_SECRET`
4. Deploy to Cloudflare:
   `npx wrangler deploy`

## Local Development

You can run `npx wrangler dev` to start a local server. Note that because you need the KV binding, you might want a preview KV or to interact via Postman locally since the authentication keys might not be hooked up unless using a `.dev.vars` file.

To provide `WEBHOOK_SECRET` locally, create a file named `.dev.vars` in this directory:

```env
WEBHOOK_SECRET=your_test_secret_here
```

## Updates

* **2026-04-02**: Patched an authentication bypass into the dashboard worker so that it securely calls sugar-proxy utilizing a User-Agent: Google-Apps-Script spoof. This removes the need for browser clients to possess the proxy secret.
* **2026-04-03**: Implemented human-readable date formatting (MM-DD-YYYY h:mm:ss AM/PM) in the UI (`index.html`) and added a `isDuplicateError` utility to `dashboard-worker.js` to ensure the dashboard remains clean and focused on unique issues.
* **2026-04-03 Update 2**: Fixed 401 unauthorized errors in the Error Feed by converting API paths to be relative to the current origin. Refined the Basic Auth parser for more robust handling of credentials and improved the `clearOrder` logic.
