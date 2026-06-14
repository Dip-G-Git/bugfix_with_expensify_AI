# GitHub Issue Notifier — Backend

## What This System Does

Monitors any GitHub repository for new issues matching a configured label and sends email notifications immediately. Also sends update emails when a watched issue is modified.

No webhooks, no Redis, no job queues. Runs on SQLite + SMTP only.

---

## Architecture

### Two Schedulers (always running)

| Scheduler | Interval | Purpose |
|---|---|---|
| Events Poller | Dynamic (from GitHub `X-Poll-Interval`, starts at 60s) | Detects new/updated issues via GitHub Events API + ETag |
| Email Sender | Fixed 20s | Drains PENDING notification records, sends emails, retries failures |

### Event Detection Flow

```
GitHub Events API (GET /repos/{owner}/{repo}/events)
  + ETag (If-None-Match header)  →  304 = nothing changed (free)
                                 →  200 = new events, filter by IssuesEvent
                                       action=opened|labeled + has watched label
                                       → create NotificationRecord (PENDING)
                                       action=edited|labeled|... on already-selected issue
                                       → set hasPendingUpdate=true
```

### Email Sending Flow

```
Every 20 seconds:
  1. Find all NotificationRecord WHERE status=PENDING AND deletedAt=null
     → try sendMail → success: status=SENT, notifiedAt=now
                    → fail:   attempts++, retry next 20s (indefinite)

  2. Find all NotificationRecord WHERE status=SENT AND hasPendingUpdate=true AND deletedAt=null
     → try sendMail (update email) → success: hasPendingUpdate=false, updateEmailCount++
                                   → fail:   retry next 20s (indefinite)
```

### Daily Issue Limit

- `Config.dailySelectedCount` tracks how many new issues were selected today
- Reset to 0 at midnight (checked on every poller cycle)
- Update emails for already-selected issues are NOT counted against the limit
- Default limit: 4 new issues per day

---

## Database Models

### Config (singleton row, id = "singleton")

| Field | Type | Default | Description |
|---|---|---|---|
| notificationEmail | String | "" | Email address to notify |
| watchedRepo | String | "Expensify/App" | GitHub repo (owner/repo) |
| watchedLabel | String | "Help Wanted" | Label to watch for |
| issueLimit | Int | 4 | Max new issues selected per day |
| githubToken | String? | null | Optional PAT (5000 req/hr vs 60) |
| lastEtag | String? | null | Last ETag from Events API |
| pollIntervalSeconds | Int | 60 | Updated dynamically from X-Poll-Interval |
| dailySelectedCount | Int | 0 | New issues selected today |
| dailyResetDate | String | "" | YYYY-MM-DD of last reset |
| isRunning | Boolean | false | Master on/off switch |

### NotificationRecord (one per selected issue)

| Field | Type | Description |
|---|---|---|
| githubIssueNumber | Int (unique) | GitHub issue number |
| title | String | Issue title |
| url | String | Issue URL |
| repoFullName | String | owner/repo |
| matchedLabel | String | Label that triggered selection |
| status | Enum | PENDING → SENT (or FAILED stays PENDING for retry) |
| attempts | Int | Number of email send attempts |
| notifiedAt | DateTime? | When initial email was sent |
| hasPendingUpdate | Boolean | True when update email needs sending |
| updateEmailCount | Int | Total update emails sent |
| deletedAt | DateTime? | Soft delete timestamp (null = active) |

---

## API Endpoints

### Config

| Method | Route | Description |
|---|---|---|
| GET | /api/config | Get current config (hides githubToken) |
| PUT | /api/config | Update config fields |
| GET | /api/config/status | Quick status: isRunning, daily counts, poll interval |
| POST | /api/config/start | Start notification service (requires notificationEmail) |
| POST | /api/config/stop | Stop notification service |

### Notifications (Issues)

| Method | Route | Description |
|---|---|---|
| GET | /api/notifications | List all records (paginated, filterable by status) |
| GET | /api/notifications/:id | Get single record |
| DELETE | /api/notifications/:id | Soft delete (sets deletedAt) |
| DELETE | /api/notifications/:id/hard | Hard delete (permanent) |
| POST | /api/notifications/:id/restore | Restore a soft-deleted record |

### Health

| Method | Route | Description |
|---|---|---|
| GET | /health | Uptime check |
| GET | /health/ready | DB connectivity check |

---

## Local Development

### 1. Install dependencies
```bash
cd backend && npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
```

### 3. Set up database
```bash
npm run db:push
```

### 4. Start
```bash
npm run dev
```

### 5. Configure via API
```bash
curl -X PUT http://localhost:3001/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "notificationEmail": "you@example.com",
    "watchedRepo": "Expensify/App",
    "watchedLabel": "Help Wanted",
    "issueLimit": 4,
    "githubToken": "ghp_..."
  }'

curl -X POST http://localhost:3001/api/config/start
```

---

## Production Deployment

### Cost Comparison

| Platform | Cost | Notes |
|---|---|---|
| **Fly.io** (recommended) | ~$2.10/month | Easiest DX, persistent volume |
| **Oracle Cloud Free Tier** | $0/month forever | More setup, true zero cost |
| **Railway** | ~$2–3/month | $5 credit given on signup |
| **Render** | $7/month | Paid tier required (free tier sleeps) |

> **The poller must run 24/7.** Any platform that "sleeps" idle instances (Render free, Vercel, Netlify) will NOT work.

---

### Option A — Fly.io (~$2.10/month) ✅ Recommended

#### First-time setup

```bash
# 1. Install flyctl
# macOS:  brew install flyctl
# Windows: winget install flyctl
# Linux:  curl -L https://fly.io/install.sh | sh

# 2. Log in
flyctl auth login

# 3. Create the app (run from backend/)
cd backend
flyctl launch --name github-issue-notifier --no-deploy

# 4. Create persistent volume for SQLite (1 GB = $0.15/month)
flyctl volumes create notifier_data --size 1 --region ams

# 5. Set secrets (never commit these)
flyctl secrets set \
  SMTP_HOST=smtp.gmail.com \
  SMTP_PORT=587 \
  SMTP_SECURE=false \
  SMTP_USER=your@gmail.com \
  SMTP_PASS="xxxx xxxx xxxx xxxx"

# 6. Deploy
flyctl deploy --remote-only
```

#### After deploy — configure the notifier

```bash
# Get your app URL
flyctl info

# Set config (replace URL with your Fly.io URL)
curl -X PUT https://github-issue-notifier.fly.dev/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "notificationEmail": "you@example.com",
    "watchedRepo": "Expensify/App",
    "watchedLabel": "Help Wanted",
    "issueLimit": 4,
    "githubToken": "ghp_..."
  }'

curl -X POST https://github-issue-notifier.fly.dev/api/config/start
```

#### Useful commands

```bash
flyctl status          # machine status
flyctl logs            # live logs
flyctl ssh console     # SSH into the machine
flyctl deploy          # redeploy after code changes
flyctl secrets list    # view secret names (not values)
```

---

### Option B — Oracle Cloud Always Free ($0/month forever)

Best for true zero cost. Gives you 2 AMD VMs (1 OCPU, 1GB RAM) that never expire.

```bash
# 1. Sign up at cloud.oracle.com (requires credit card for verification, never charged)
# 2. Create an Always Free AMD VM (Ubuntu 22.04)
# 3. SSH in, then:

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Clone your repo
git clone https://github.com/YOUR/REPO.git
cd REPO/backend

# Install deps and build
npm ci && npm run build && npx prisma generate

# Set env vars
cp .env.example .env
nano .env   # fill in SMTP_* values, DATABASE_URL=file:./prod.db

# Push DB schema
npm run db:push

# Install PM2 (process manager — keeps app running after SSH exit)
sudo npm install -g pm2

# Start with PM2
pm2 start dist/server.js --name notifier
pm2 save
pm2 startup   # run the printed command to auto-start on reboot

# Configure the notifier
curl -X PUT http://localhost:3001/api/config \
  -H "Content-Type: application/json" \
  -d '{"notificationEmail":"you@example.com","watchedRepo":"Expensify/App","watchedLabel":"Help Wanted","issueLimit":4}'

curl -X POST http://localhost:3001/api/config/start
```

To access the API from outside, open port 3001 in Oracle's Security List, or put Nginx in front.

---

### CI/CD — Auto-deploy on Git Push (Fly.io)

Already configured in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml).

Add these secrets in GitHub → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `FLY_API_TOKEN` | Output of `flyctl tokens create deploy` |
| `PROD_API_URL` | `https://github-issue-notifier.fly.dev` |

Every push to `master` that touches `backend/` will auto-deploy.

---

### Infrastructure Files

| File | Purpose |
|---|---|
| [backend/Dockerfile](backend/Dockerfile) | Multi-stage build: compile TS → minimal runner image |
| [backend/.dockerignore](backend/.dockerignore) | Excludes node_modules, .env, *.db from image |
| [backend/fly.toml](backend/fly.toml) | Fly.io app config: region, volume mount, health check |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | Auto-deploy to Fly.io on push to master |

---

## Key Design Decisions

- **No Redis / BullMQ**: Replaced with a simple DB-backed pending queue. The `NotificationRecord` table IS the queue.
- **No auth**: Single-user tool. Add an `API_KEY` env check if public-facing.
- **Dynamic poll interval**: Reads `X-Poll-Interval` from GitHub response header each cycle. Starts at 60s.
- **ETag**: Sends `If-None-Match` on every poll. GitHub returns 304 (no rate limit cost) when nothing changed.
- **Indefinite email retry**: No max attempt cap. Email sender retries every 20s until success.
- **Issue limit is for new selections only**: Update emails on already-selected issues are unlimited.
- **Rate limit handling**: On 403 from GitHub, backs off to 120s automatically.

---

## File Structure

```
backend/src/
  api/
    config.routes.ts          GET/PUT config, start/stop
    notifications.routes.ts   GET/soft-delete/hard-delete issues
    health.routes.ts          health checks
  services/
    events-poller.service.ts  GitHub Events API + ETag logic
    notification-sender.service.ts  drain PENDING records + send email
    email.service.ts          Nodemailer wrapper (initial + update emails)
  jobs/
    schedulers.ts             two schedulers: poller + email sender
  middleware/
    error.middleware.ts       Zod + generic error handler
    not-found.middleware.ts   404 handler
  db/
    client.ts                 Prisma client singleton
  utils/
    env.ts                    Zod-validated env vars
    logger.ts                 Pino logger
    octokit.ts                Octokit factory
  app.ts                      Express app setup
  server.ts                   Entry point
prisma/
  schema.prisma               Config + NotificationRecord models
```
