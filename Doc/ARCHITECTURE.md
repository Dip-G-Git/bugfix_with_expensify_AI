# Architecture — GitHub Issue Notifier & Auto-Proposer

## 1. System Overview

Monitors any GitHub repository for new issues matching a configured label, sends email notifications within ~10 seconds, and automatically generates + posts contributor proposal comments via Claude in parallel. Also sends update emails when watched issues change.

**Single user. No auth. No Redis. No job queues. SQLite + SMTP (+ optional Anthropic API for auto-proposals) only.**

> A `frontend/` Next.js scaffold exists in this repo (npm workspace member) but is **disconnected** from this backend — it calls `/api/auth/login`, which does not exist here. It has no CI job and is not part of the deployed system. This document describes the backend only.

---

## 2. High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                       Express.js API Server                        │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                         API Layer                            │  │
│  │  GET/PUT /api/config        POST /api/config/start|stop      │  │
│  │  GET /api/notifications     DELETE /api/notifications        │  │
│  │  POST /api/notifications/:id/trigger-update                  │  │
│  │  POST/GET /api/proposals    GET /api/proposals/:id           │  │
│  │  GET /health                GET /health/ready                │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│                         │                                           │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │                      Service Layer                           │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  IssuePollerService.fullScan()                        │  │  │
│  │  │  (5s full snapshot of open labeled issues, REST Issues │  │  │
│  │  │  API, sorted by created date; detects new/updated/     │  │  │
│  │  │  closed issues; populates issueDataCache)              │  │  │
│  │  └────────────────────────────┬───────────────────────────┘  │  │
│  │                               │  both fire after each poll     │  │
│  │           ┌───────────────────┴──────────────────────────┐    │  │
│  │           │  (parallel, fully independent)               │    │  │
│  │    ┌──────┴──────────────┐   ┌──────────────────────┐   │    │  │
│  │    │ NotificationSender  │   │ AutoProposalService   │   │    │  │
│  │    │ Service             │   │ (reads issueDataCache;│   │    │  │
│  │    │ (isRunning lock,    │   │ generates via LLM +   │   │    │  │
│  │    │ update-email gate,  │   │ posts GitHub comment; │   │    │  │
│  │    │ notify window gate) │   │ isRunning lock)       │   │    │  │
│  │    └─────────────────────┘   └──────────────────────┘   │    │  │
│  │           └──────────────────────────────────────────────┘    │  │
│  │                                                               │  │
│  │  ┌────────────────────────┐  ┌────────────────────────────┐  │  │
│  │  │ ProposalGeneratorSvc   │  │ ProposalGuardsService      │  │  │
│  │  │ (Anthropic SDK,        │  │ (assertNoExistingProposal, │  │  │
│  │  │  claude-opus-4-8)      │  │  assertProposalIsDifferent)│  │  │
│  │  └────────────────────────┘  └────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                         │                                           │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │             SQLite Database (Prisma ORM)                      │  │
│  │   Config (singleton)  |  NotificationRecord  |  ProposalRecord│  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        │              │                  │
  ┌─────▼──────┐ ┌─────▼──────┐    ┌──────▼──────┐
  │ GitHub API │ │ Anthropic  │    │ Gmail SMTP  │
  │ REST Issues│ │ API        │    │ (Nodemailer,│
  │ + Octokit  │ │ (claude-   │    │ pooled      │
  │            │ │ opus-4-8)  │    │ connection) │
  └────────────┘ └────────────┘    └─────────────┘
```

---

## 3. One Scheduler, Parallel Reactive Services

`backend/src/jobs/schedulers.ts` starts a single 5-second timer. After each poll cycle that produced activity, **both** `NotificationSenderService` and `AutoProposalService` are fired in parallel using fire-and-forget `.catch()` — neither blocks the other or the poller.

### Full-Scan Poller (5s)

A complete snapshot of every open labeled issue, every 5 seconds. Because the whole list is re-read each cycle (no incremental `since` watermark), a failed cycle is fully recovered by the next one — no newly created issue can slip through. Detects new issues within 0–5 seconds of label addition, plus updates and closures.

```
startup (after 2s)
    │
    ▼  every 5 seconds
IssuePollerService.fullScan()
    ├─ read Config from DB
    ├─ if !isRunning or no githubToken → return false
    ├─ daily reset check (dailySelectedCount → 0 at date change)
    ├─ GET /repos/{owner}/{repo}/issues?labels=...&state=open&sort=created&direction=desc
    │   (paginated per_page=100 — full snapshot, newest first)
    │
    ├─ tracked in DB but ABSENT from results → soft-delete (closed / label removed)
    │
    ├─ for each issue in the snapshot:
    │   ├─ NEW (not in DB):
    │   │   ├─ skip unless created today            (isCreatedToday guard)
    │   │   ├─ skip if daily limit reached
    │   │   └─ CREATE NotificationRecord (PENDING) + increment dailySelectedCount
    │   │       + write to issueDataCache (Map<issueNumber,{title,body,cachedAt}>)
    │   └─ EXISTING (title/body/comment-count/updated-at changed):
    │       └─ sync fields; if status=SENT → SET hasPendingUpdate=true
    │
    ├─ returns hasActivity: boolean
    │
    └─ if hasActivity:
        ├─ NotificationSenderService.send()   ← parallel, fire-and-forget
        └─ AutoProposalService.run()          ← parallel, fire-and-forget
```

### NotificationSenderService

```
isRunning lock? → skip (prevents overlap)
isWithinNotifyWindow()? NO → hold (emails wait in DB until window opens)

PASS 1: all PENDING records (deletedAt=null) — initial email
    ├─ sendMail() success → status=SENT, notifiedAt=now, labelDetectedAt measured for lag log
    └─ sendMail() fail   → attempts++, stays PENDING (retried next cycle)

PASS 2: all SENT records where hasPendingUpdate=true (deletedAt=null) — update email
    ├─ proposal-comment gate:
    │   no ProposalRecord for this issue (matched on myGithubUsername when set)
    │   → clear hasPendingUpdate, skip (no update email without a proposal)
    ├─ sendMail() success → hasPendingUpdate=false, updateEmailCount++
    └─ sendMail() fail   → stays true (retried next cycle)
```

### AutoProposalService

```
isRunning lock? → skip (prevents overlap)
config.autoProposal? config.myGithubUsername? ANTHROPIC_API_KEY? githubToken? → abort if any missing

Batch-check ProposalRecords for myGithubUsername across all pending issues
→ filter to toPropose (issues with no existing proposal)

Promise.allSettled(toPropose.map(issue => {
    cache hit → use issueDataCache (skip GET /issues)
    cache miss → GET /repos/{owner}/{repo}/issues/{n}

    listIssueComments()
    assertNoExistingProposal()   ← guard: proposal already exists in GitHub comments?
    generateProposal()           ← LLM call (claude-opus-4-8)
    assertProposalIsDifferent()  ← guard: root cause too similar to existing comment?
    POST /repos/{owner}/{repo}/issues/{n}/comments
    CREATE ProposalRecord
}))
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
lastEtag             legacy column — no longer used (poller does not use ETags)
pollIntervalSeconds  legacy column — poller now runs on a fixed 5s interval
dailySelectedCount   0..N (how many new issues selected today)
dailyResetDate       "YYYY-MM-DD" (when count was last reset)
isRunning            true/false (master switch)
notifyStartTime      "HH:MM" or "" (notify window start)
notifyEndTime        "HH:MM" or "" (notify window end)
notifyTimezone       IANA timezone (default: "UTC")
myGithubUsername     your GitHub username (for update-email gating + auto-proposal attribution)
autoProposal         true/false (auto-generate proposals on new issue detection)
updatedAt
```

### NotificationRecord (one per selected GitHub issue)

```
id                   cuid
githubIssueNumber    unique — prevents duplicate selection
title                issue title (synced on edits)
body                 issue body (synced on edits)
commentCount         GitHub comment count, used by REST sync to detect new comments
githubUpdatedAt      GitHub's issue.updated_at, used by REST sync to detect any change
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
labelDetectedAt      when the issue was first detected (used to measure label→email lag)
deletedAt            soft delete timestamp (null = active)
createdAt / updatedAt
```

### ProposalRecord (one per contributor per issue)

```
id                   cuid
githubIssueNumber    GitHub issue number
repoFullName         "owner/repo"
contributorUsername  GitHub username the proposal is attributed to
rootCause            LLM-generated root cause (text hypothesis, not source-verified)
proposedChange       LLM-generated proposed fix (plain English, no code diffs)
alternatives         LLM-generated alternatives (optional)
commentBody          full formatted comment body as posted to GitHub
commentUrl           URL of the posted GitHub comment
commentId            GitHub comment ID
createdAt

@@unique([githubIssueNumber, repoFullName, contributorUsername])
```

---

## 5. Key Design Decisions

### Single 5s full-scan poller for sub-10s latency and zero misses
A single poller runs `fullScan()` every 5 seconds against the REST Issues API, achieving ~8–12s label-to-email latency. It fetches a **complete snapshot** of all open labeled issues each cycle (paginated, sorted by creation date, no incremental `since` filter). A full snapshot is deliberately chosen over an incremental watermark so that a failed or skipped cycle is fully recovered by the next one — no newly created issue can be missed. The same cycle also detects updates (field changes) and closures (issues absent from the snapshot). New issues are gated by the `isCreatedToday` guard.

### Parallel email + proposal
Both `NotificationSenderService.send()` and `AutoProposalService.run()` are fired after every detection cycle using `Promise.catch()` without `await` — neither blocks the scheduler or each other. The proposal (~20s) does not delay the email (~10s). Each service has its own `isRunning` static flag to prevent overlapping concurrent invocations.

### In-memory issue data cache
`fullScan()` populates an in-memory `Map<issueNumber, {title, body, cachedAt}>` when it creates records. `AutoProposalService` reads from this cache first, saving one `GET /repos/.../issues/{n}` call per issue (~400–1200ms). Cache TTL is 2 minutes; entries are evicted on read.

### Update emails only for issues with a proposal comment
An initial email is always sent for a newly detected issue. **Update** emails are sent only when a `ProposalRecord` already exists for the issue (matched on `myGithubUsername` when set). If none exists, `hasPendingUpdate` is cleared and no update email goes out. This keeps update notifications focused on issues you are actually engaged with (i.e. have proposed on), and avoids inbox spam on issues you have not yet acted on.

### No Redis / BullMQ
The `NotificationRecord` table serves as the job queue. `status=PENDING` = queued. The send is triggered reactively after every poller cycle — not on its own fixed timer.

**Benefits:** No infrastructure dependency, queue state visible in Prisma Studio, retries are automatic (failed send = stays PENDING until next cycle).

### Proposals: cheap guards first, LLM call last
`AutoProposalService` runs both cheap guards before calling the LLM:
1. Batch DB check (no ProposalRecord for this user+issue)
2. `assertNoExistingProposal` (no matching comment already on GitHub)

Only after both pass does it call `generateProposal()` (the expensive LLM call). The third guard (`assertProposalIsDifferent`) runs after generation since it depends on the generated root cause text. This ensures failed proposals never waste a generation.

The LLM only sees the issue title/body/comments — it has no access to repository source code — so the generated root cause is explicitly framed as a text-based hypothesis.

### Full-snapshot polling (not incremental/ETag-based)
The poller fetches the full list of open labeled issues every cycle rather than relying on an ETag/`since` watermark. This trades some rate-limit efficiency for correctness: a complete snapshot every 5s means a dropped or failed cycle cannot cause a newly created issue to be permanently missed. The `lastEtag` and `pollIntervalSeconds` columns remain in the schema for backward compatibility but are no longer used by the poller.

### DB-backed Config (not env vars)
All runtime settings live in the `Config` table, editable via `PUT /api/config` without a server restart. Only SMTP credentials, `DATABASE_URL`, and `ANTHROPIC_API_KEY` are in env vars (they require a restart to change).

### isRunning flag
`Config.isRunning` is the master switch. The scheduler checks it on every cycle. `POST /api/config/start|stop` toggle it in the DB.

### Current-day created filter
Only issues created on the current calendar day are selected (`isCreatedToday`). This prevents stale issues (e.g. an old issue re-labeled) from consuming the daily issue limit and ensures notifications and proposals target freshly-posted work.

---

## 6. API Endpoints

### Config
| Method | Path | Description |
|---|---|---|
| GET | /api/config | View settings (githubToken hidden) |
| PUT | /api/config | Update settings |
| GET | /api/config/status | isRunning, daily counts, notify window state |
| POST | /api/config/start | Start monitoring (requires notificationEmail) |
| POST | /api/config/stop | Stop monitoring |

### Notifications
| Method | Path | Description |
|---|---|---|
| GET | /api/notifications | List records (paginated, filterable by status) |
| GET | /api/notifications/:id | Single record |
| POST | /api/notifications/track | Manually track an issue by number |
| POST | /api/notifications/:id/trigger-update | Manually flag hasPendingUpdate=true |
| DELETE | /api/notifications/:id | Soft delete |
| DELETE | /api/notifications/:id/hard | Hard delete |
| POST | /api/notifications/:id/restore | Restore soft-deleted |

### Proposals
| Method | Path | Description |
|---|---|---|
| POST | /api/proposals | Generate (LLM) and immediately post a proposal. No age restriction. Requires ANTHROPIC_API_KEY. |
| GET | /api/proposals | List records (paginated, filterable) |
| GET | /api/proposals/:id | Single record |

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
| Runtime | Node.js 22 | What CI/Docker actually pin |
| Language | TypeScript | Type safety, Prisma type generation |
| API framework | Express.js v5 | Minimal, well-understood, stable |
| ORM | Prisma | Type-safe queries, schema-first, SQLite support |
| Database | SQLite | Zero infrastructure, persistent volumes on Fly.io |
| Job queue | DB-backed (NotificationRecord) | No Redis needed, simpler, visible in Prisma Studio |
| Detection strategy | Single 5s full-snapshot poller (REST Issues API) | Complete snapshot every cycle → sub-10s latency, handles new/updated/closed issues, and guarantees no new issue is missed |
| Email | Nodemailer (pooled SMTP, `pool: true, maxConnections: 1`) | Persistent connection saves ~1–2s per email |
| LLM (proposals) | Anthropic SDK `claude-opus-4-8` | Best reasoning quality for root cause analysis; async so latency (~20s) doesn't block email |
| Validation | Zod | Runtime + compile-time type safety |
| Logging | Pino | Fast structured JSON logs |
| Testing | Vitest + Supertest | Fast, Jest-compatible, good ESM support |
| Deployment | Fly.io + Docker | Simple, persistent volumes, ~$2/month |
| CI/CD | GitHub Actions | Free, integrated with repo |
