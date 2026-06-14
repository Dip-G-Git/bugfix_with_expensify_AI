# Architecture — GitHub Issue Notifier

## 1. System Overview

Monitors any GitHub repository for new issues matching a configured label and sends email notifications immediately. Also sends update emails when a watched issue changes.

**Single user. No auth. No Redis. No job queues. SQLite + SMTP only.**

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Express.js API Server                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    API Layer                        │   │
│  │  GET/PUT /api/config    POST /api/config/start|stop │   │
│  │  GET /api/notifications  DELETE /api/notifications  │   │
│  │  GET /health             GET /health/ready          │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────────┐   │
│  │                 Service Layer                       │   │
│  │                                                     │   │
│  │  ┌──────────────────────┐  ┌───────────────────┐   │   │
│  │  │  EventsPollerService │  │NotificationSender │   │   │
│  │  │  (runs on setTimeout)│  │(runs on 20s timer)│   │   │
│  │  └──────────┬───────────┘  └────────┬──────────┘   │   │
│  │             │                       │              │   │
│  └─────────────┼───────────────────────┼──────────────┘   │
│                │                       │                   │
│  ┌─────────────▼───────────────────────▼──────────────┐   │
│  │              SQLite Database (Prisma ORM)           │   │
│  │   Config (singleton)  |  NotificationRecord         │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
      ┌──────────────┴──────────────┐
      │                             │
┌─────▼──────┐               ┌──────▼──────┐
│ GitHub API │               │ Gmail SMTP  │
│ Events API │               │ (Nodemailer)│
│ + Octokit  │               └─────────────┘
└────────────┘
```

---

## 3. Two Schedulers

### Scheduler 1 — Events Poller (dynamic interval)

```
startup (after 2s delay)
    │
    ▼
EventsPollerService.poll()
    │
    ├─ read Config from DB
    ├─ if !isRunning → return immediately
    ├─ daily reset check (dailySelectedCount → 0 at midnight)
    ├─ GET /repos/{owner}/{repo}/events?per_page=20
    │   Header: If-None-Match: {lastEtag}
    │
    ├─ 304 Not Modified → save interval, return
    │
    └─ 200 OK → process events
        ├─ save new ETag + X-Poll-Interval to DB
        ├─ for each IssuesEvent:
        │   ├─ skip if issue.created_at > 7 days ago
        │   ├─ action=opened|labeled + has watched label + not in DB + under limit
        │   │   → CREATE NotificationRecord (PENDING) + increment dailySelectedCount
        │   └─ action=edited|reopened + already SENT + not deleted
        │       → SET hasPendingUpdate=true
        │
        └─ return pollIntervalSeconds (from X-Poll-Interval)
               │
               ▼
        setTimeout(poll, pollIntervalSeconds * 1000)   ← reschedules itself
```

### Scheduler 2 — Email Sender (fixed 20s interval)

```
setInterval(20_000)
    │
    ▼
NotificationSenderService.send()
    │
    ├─ read Config → if !isRunning or !notificationEmail → return
    │
    ├─ PASS 1: find all PENDING records (deletedAt=null)
    │   for each:
    │   ├─ sendMail() success → status=SENT, notifiedAt=now, attempts++
    │   └─ sendMail() fail   → attempts++, lastAttemptAt=now (stays PENDING → retried next 20s)
    │
    └─ PASS 2: find all SENT records where hasPendingUpdate=true (deletedAt=null)
        for each:
        ├─ sendMail() success → hasPendingUpdate=false, updateEmailCount++
        └─ sendMail() fail   → log error (hasPendingUpdate stays true → retried next 20s)
```

---

## 4. Database Schema

### Config (always exactly one row, id = "singleton")

```
id                   "singleton"
notificationEmail    email to send to
watchedRepo          "owner/repo"
watchedLabel         "Help Wanted"
issueLimit           4  (max new issues per day)
githubToken          optional PAT
lastEtag             saved ETag from last Events API response
pollIntervalSeconds  60 (updated from X-Poll-Interval header)
dailySelectedCount   0..N (how many new issues selected today)
dailyResetDate       "YYYY-MM-DD" (when count was last reset)
isRunning            true/false (master switch)
```

### NotificationRecord (one per selected GitHub issue)

```
id                   cuid
githubIssueNumber    unique — prevents duplicate selection
title                issue title
url                  GitHub issue URL
repoFullName         "owner/repo"
matchedLabel         label that triggered selection
status               PENDING | SENT | FAILED
attempts             count of email send attempts
lastAttemptAt        last attempt timestamp
notifiedAt           when initial email was successfully sent
hasPendingUpdate     true when an update email is queued
updateEmailCount     total update emails sent
lastUpdateEmailAt    when last update email was sent
deletedAt            soft delete timestamp (null = active)
createdAt / updatedAt
```

---

## 5. Key Design Decisions

### No Redis / BullMQ
The `NotificationRecord` table serves as the job queue. `status=PENDING` = queued. The Email Sender drains it every 20 seconds.

**Benefits:** No infrastructure dependency, queue state visible in Prisma Studio, retries are automatic (failed = stays PENDING).

### ETag-based polling (not timestamp-based)
Previous design used `since: lastPolledAt` which used GitHub's `updated_at` field. Issues that weren't recently updated would disappear from results permanently.

ETag approach: GitHub tells us exactly when the response changes. We never miss events.

### DB-backed Config (not env vars)
All runtime settings (email, repo, label, limit) live in the Config table, editable via API without a server restart. Only SMTP credentials and DATABASE_URL are in env vars.

### isRunning flag
The `Config.isRunning` boolean is the master switch. Both schedulers check it on every cycle. `POST /api/config/start` and `stop` toggle it in the DB.

### Daily issue limit (not daily email limit)
`dailySelectedCount` tracks distinct issues *selected*, not emails sent. Once an issue is selected, all its future update emails are unlimited. The limit prevents being flooded with new issues on busy days.

### Recently-created filter (7 days)
Only issues created within the last 7 days are selected. This prevents stale events (an old issue getting a new comment) from consuming your daily limit.

---

## 6. API Endpoints

### Config
| Method | Path | Description |
|---|---|---|
| GET | /api/config | View settings (githubToken hidden) |
| PUT | /api/config | Update settings |
| GET | /api/config/status | isRunning, daily counts, poll interval |
| POST | /api/config/start | Start monitoring (requires notificationEmail) |
| POST | /api/config/stop | Stop monitoring |

### Notifications
| Method | Path | Description |
|---|---|---|
| GET | /api/notifications | List records (paginated, filterable by status) |
| GET | /api/notifications/:id | Single record |
| DELETE | /api/notifications/:id | Soft delete (sets deletedAt) |
| DELETE | /api/notifications/:id/hard | Hard delete (permanent) |
| POST | /api/notifications/:id/restore | Restore soft-deleted |

### Health
| Method | Path | Description |
|---|---|---|
| GET | /health | Uptime |
| GET | /health/ready | DB connectivity |

---

## 7. Security

- **Helmet.js** — HTTP security headers on all responses
- **CORS** — restricted to configured origin
- **Rate limiting** — 200 req per 15 min on all `/api` routes
- **Zod validation** — all request bodies validated before DB access
- **githubToken never exposed** — stripped from all GET /api/config responses
- **No SQL injection** — all DB access via Prisma parameterised queries
- **No auth tokens to steal** — single-user tool with no login, designed for local/private use

---

## 8. Production Deployment

```
Internet ──HTTPS──► Fly.io Machine (shared-cpu-1x, 256MB RAM)
                         │
                    Express API + Schedulers
                         │
                    /data/prod.db (SQLite)
                         │
                    Fly.io Persistent Volume (1GB)
```

**Cost: ~$2.10/month** (machine + volume)

See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step instructions.

---

## 9. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js v22 | LTS, native ESM, excellent async |
| Language | TypeScript | Type safety, Prisma type generation |
| API framework | Express.js v5 | Minimal, well-understood, stable |
| ORM | Prisma | Type-safe queries, schema-first, SQLite support |
| Database | SQLite | Zero infrastructure, persistent volumes on Fly.io |
| Job queue | DB-backed (NotificationRecord) | No Redis needed, simpler, visible |
| Polling strategy | Events API + ETag | Efficient, no missed events, respects rate limits |
| Email | Nodemailer | Industry standard, works with any SMTP |
| Validation | Zod | Runtime + compile-time type safety |
| Logging | Pino | Fast structured JSON logs |
| Testing | Vitest + Supertest + MSW | Fast, Jest-compatible, good ESM support |
| Deployment | Fly.io + Docker | Simple, persistent volumes, ~$2/month |
| CI/CD | GitHub Actions | Free, integrated with repo |
