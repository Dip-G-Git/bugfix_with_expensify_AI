# GitHub Issue Notifier

Monitors any GitHub repository for new issues matching a configured label and emails you immediately. Also emails you on every update to a watched issue.

No webhooks needed. No Redis. No Docker. No auth. SQLite + SMTP only.

---

## How It Works

```
GitHub Events API (polls every ~60s with ETag)
         │
         ▼  new issue with watched label?
    Select it (max N per day, default 4)
         │
         ▼
   NotificationRecord saved (status: PENDING)
         │
         ▼  Email Sender runs every 20s
    Send email → status: SENT
         │
         ▼  Issue updated later?
    hasPendingUpdate = true → update email sent
```

---

## Prerequisites

| Tool     | Version | Install |
|----------|---------|---------|
| Node.js  | v22+    | https://nodejs.org |
| npm      | v10+    | Bundled with Node |

No Docker, no Redis, no database server required.

---

## Quick Start

### 1. Clone and install
```bash
git clone https://github.com/<your-username>/github-issue-notifier.git
cd github-issue-notifier/backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env` — only 5 values needed:
```env
DATABASE_URL="file:./dev.db"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
```

### 3. Set up database
```bash
npm run db:push
```

### 4. Start server
```bash
npm run dev
# Server runs at http://localhost:3001
```

### 5. Configure and start notifier
```bash
# Set what to watch and where to email
curl -X PUT http://localhost:3001/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "notificationEmail": "you@example.com",
    "watchedRepo": "Expensify/App",
    "watchedLabel": "Help Wanted",
    "issueLimit": 4,
    "githubToken": "ghp_..."
  }'

# Start monitoring
curl -X POST http://localhost:3001/api/config/start

# Check it's running
curl http://localhost:3001/api/config/status
```

---

## Environment Variables

Only these 5 are required. Everything else is configured via the API at runtime.

```env
DATABASE_URL="file:./dev.db"

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
```

### Getting Gmail App Password
1. Enable 2FA on your Gmail account
2. Google Account → Security → App Passwords → create one
3. Use the 16-character code as `SMTP_PASS`

### Getting a GitHub PAT (optional but recommended)
Unauthenticated: 60 API requests/hour
Authenticated PAT: 5,000 requests/hour

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Scopes: `public_repo` is enough for public repos
3. Set via `PUT /api/config` with `"githubToken": "ghp_..."`

---

## Project Structure

```
backend/
├── src/
│   ├── api/
│   │   ├── config.routes.ts         GET/PUT config, start/stop
│   │   ├── notifications.routes.ts  list/delete notification records
│   │   └── health.routes.ts         health checks
│   ├── services/
│   │   ├── events-poller.service.ts GitHub Events API + ETag polling
│   │   ├── notification-sender.service.ts  drain pending, send emails
│   │   └── email.service.ts         Nodemailer wrapper
│   ├── jobs/
│   │   └── schedulers.ts            two schedulers (poller + email sender)
│   ├── middleware/
│   │   ├── error.middleware.ts
│   │   └── not-found.middleware.ts
│   ├── db/
│   │   └── client.ts                Prisma singleton
│   ├── utils/
│   │   ├── env.ts                   Zod-validated env
│   │   ├── logger.ts                Pino logger
│   │   └── octokit.ts              Octokit factory
│   ├── app.ts                       Express setup
│   └── server.ts                    Entry point
├── prisma/
│   └── schema.prisma                Config + NotificationRecord models
├── Dockerfile
├── fly.toml                         Production deploy config
└── .env.example
```

---

## API Reference

### Config

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/config` | View current settings |
| `PUT` | `/api/config` | Update email, repo, label, limit, token |
| `GET` | `/api/config/status` | Quick status + daily counts |
| `POST` | `/api/config/start` | Start monitoring |
| `POST` | `/api/config/stop` | Pause monitoring |

### Notifications (Issues)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/notifications` | List records (`?status=SENT&page=1&limit=20`) |
| `GET` | `/api/notifications/:id` | Single record |
| `DELETE` | `/api/notifications/:id` | Soft delete |
| `DELETE` | `/api/notifications/:id/hard` | Hard delete |
| `POST` | `/api/notifications/:id/restore` | Restore soft-deleted |

### Health

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Uptime |
| `GET` | `/health/ready` | DB connectivity |

---

## Runtime Config Options

All set via `PUT /api/config`:

| Field | Default | Description |
|---|---|---|
| `notificationEmail` | (required) | Where to send emails |
| `watchedRepo` | `Expensify/App` | GitHub repo (`owner/repo`) |
| `watchedLabel` | `Help Wanted` | Label to filter on |
| `issueLimit` | `4` | Max new issues selected per day |
| `githubToken` | `null` | Optional PAT for higher rate limit |

---

## Available Scripts

```bash
npm run dev          # Start with hot-reload
npm run build        # Compile TypeScript
npm run start        # Start compiled app
npm run db:push      # Apply schema to SQLite
npm run db:studio    # Open Prisma Studio (DB browser)
npm run typecheck    # TypeScript type check
npm run lint         # ESLint
npm run test         # Run tests
```

---

## Deployment (Production)

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

**Recommended: Fly.io (~$2.10/month)**

```bash
cd backend
flyctl launch --name github-issue-notifier --no-deploy
flyctl volumes create notifier_data --size 1 --region ams
flyctl secrets set SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=you@gmail.com SMTP_PASS="xxxx xxxx xxxx xxxx"
flyctl deploy --remote-only
```

**Zero cost: Oracle Cloud Always Free** — see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Troubleshooting

**No emails arriving:**
- Check `GET /api/config/status` — is `isRunning: true`?
- Check `GET /api/notifications` — any records with `status: PENDING`?
- Verify SMTP credentials: Gmail requires App Password, not account password

**Issues not being detected:**
- Confirm `githubToken` is set — unauthenticated rate limit is 60 req/hour
- Check logs for rate limit errors (403 from GitHub)
- Verify `watchedRepo` format: must be `owner/repo` (e.g. `Expensify/App`)
- Issue must be ≤7 days old to be selected (recently-created filter)

**GitHub rate limit (403):**
- Set a PAT via `PUT /api/config` with `"githubToken": "ghp_..."`
- System automatically backs off to 120s on 403

**Database issues:**
```bash
cd backend
npm run db:push      # re-apply schema
npm run db:studio    # inspect data visually
```
