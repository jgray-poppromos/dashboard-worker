# Dashboard Worker - PowerShell Commands

This file contains useful commands for testing, deploying, and debugging the Error Dashboard Worker.

## GitHub Repository

```powershell
# Retrieve stored GitHub token from git credential manager
echo "protocol=https`nhost=github.com`n" | git credential fill

# Create a new GitHub repository via API (replace NAME and DESCRIPTION)
$token = "<token-from-above>"
Invoke-RestMethod `
  -Uri "https://api.github.com/user/repos" `
  -Method POST `
  -Headers @{ Authorization = "token $token"; Accept = "application/vnd.github.v3+json" } `
  -Body (ConvertTo-Json @{ name = "dashboard-worker"; description = "..."; private = $false }) `
  -ContentType "application/json"

# Add remote and push
git remote add origin https://github.com/jgray-poppromos/dashboard-worker.git
git push -u origin master
```

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
