# Dashboard Worker - PowerShell Commands

This file contains useful commands for testing, deploying, and debugging the Error Dashboard Worker.

## Setup & Deployment
```powershell
# Create KV Namespace for Dashboard (One-time)
npx wrangler kv namespace create DASHBOARD_KV

# Add the internal Webhook Secret
npx wrangler secret put WEBHOOK_SECRET

# Deploy Dashboard Worker
npx wrangler deploy
```

## Testing Endpoints Locally
```powershell
# Clear a specific order (Replace 123456 with the order number)
Invoke-RestMethod -Uri "https://dashboard-worker.poppromos.workers.dev/clear/order/123456" -Method Post
```

## Viewing Logs
```powershell
# Tail the remote logs of the Dashboard Worker
npx wrangler tail
```
