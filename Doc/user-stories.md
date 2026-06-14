# User Stories — GitHub Issue Notifier

**Product:** GitHub Issue Notifier (single-user, self-hosted)  
**Version:** 1.0  
**Date:** 2026-06-13

---

## Completed User Stories

---

### US-01 — Configure and start monitoring

**As a** developer who wants to be alerted to Expensify open-source contribution opportunities,  
**I want to** enter my email address and choose which GitHub repo and label to watch,  
**So that** I receive email alerts when new matching issues appear.

**Acceptance Criteria:**

- [x] `PUT /api/config` accepts `notificationEmail`, `watchedRepo`, `watchedLabel`, `issueLimit`, `githubToken`
- [x] Validates email format (Zod) — returns 400 if invalid
- [x] Validates `watchedRepo` must be `owner/repo` format — returns 400 if missing slash
- [x] `POST /api/config/start` requires `notificationEmail` to be set — returns 400 if empty
- [x] `POST /api/config/start` sets `isRunning=true` in the database
- [x] `GET /api/config/status` returns current state: `isRunning`, `watchedRepo`, `issueLimit`, etc.

**Tests:** `config.test.ts` — 27 tests pass  
**Status:** COMPLETE

---

### US-02 — Stop monitoring without losing data

**As a** user who wants to temporarily pause notifications,  
**I want to** stop the monitoring service without deleting any records,  
**So that** I can resume later from where I left off.

**Acceptance Criteria:**

- [x] `POST /api/config/stop` sets `isRunning=false`
- [x] All existing `NotificationRecord` rows are preserved (not deleted)
- [x] `POST /api/config/stop` is idempotent — works even if already stopped
- [x] Poller and email sender both check `isRunning` on every cycle and skip if false

**Tests:** `config.test.ts` — stop tests pass; unit tests verify early-return behaviour  
**Status:** COMPLETE

---

### US-03 — Get notified immediately when a matching issue is posted

**As a** developer watching the Expensify/App repo for "Help Wanted" issues,  
**I want to** receive an email within 60 seconds of a new issue being labeled "Help Wanted",  
**So that** I can claim the bounty before other contributors.

**Acceptance Criteria:**

- [x] Events Poller polls GitHub Events API every 60 seconds (dynamic via X-Poll-Interval)
- [x] Detects `IssuesEvent` with action `opened` or `labeled` + watched label
- [x] Creates a `NotificationRecord` with `status=PENDING`
- [x] Email Sender drains PENDING records every 20 seconds
- [x] Average notification time: ~45 seconds (half of 60s poll cycle + 20s email cycle)
- [x] Maximum notification time: ~80 seconds (just-missed poll + next email cycle)

**Tests:** `events-poller.service.test.ts`, `notification-sender.service.test.ts`  
**Status:** COMPLETE

---

### US-04 — Never miss an issue even if email fails temporarily

**As a** user relying on this tool for time-sensitive alerts,  
**I want** email failures to be retried automatically,  
**So that** a temporary SMTP outage doesn't cause me to miss an issue permanently.

**Acceptance Criteria:**

- [x] Failed email send: `attempts++`, `lastAttemptAt` updated, `status` stays `PENDING`
- [x] Next 20-second email sender cycle automatically retries all PENDING records
- [x] No maximum retry count — retries continue until email succeeds
- [x] Once email sent: `status=SENT`, `notifiedAt` set
- [x] Failed attempts do NOT block other records (all PENDING records processed per cycle)

**Tests:** `notification-sender.service.test.ts` — retry and multi-record tests pass  
**Status:** COMPLETE

---

### US-05 — Receive update emails when a watched issue changes

**As a** developer who claimed a bounty issue,  
**I want to** be notified when the issue is edited or reopened,  
**So that** I don't miss important requirement changes or status updates.

**Acceptance Criteria:**

- [x] Poller detects `IssuesEvent` with `action=edited` or `action=reopened`
- [x] Only triggers for issues already tracked (`status=SENT`, not deleted)
- [x] Sets `hasPendingUpdate=true` on the existing `NotificationRecord`
- [x] Email Sender sends update email with subject `[Update #N] Issue #N: title`
- [x] Orange badge (#e36209) distinguishes update email from initial notification
- [x] `updateEmailCount` increments, `lastUpdateEmailAt` set on success
- [x] Multiple updates to the same issue each trigger separate email

**Tests:** `events-poller.service.test.ts` (update queueing), `notification-sender.service.test.ts` (update sending)  
**Status:** COMPLETE

---

### US-06 — Limit daily new-issue selections

**As a** user in a high-activity repo,  
**I want** to limit how many new issues are selected per day,  
**So that** I don't get overwhelmed with email during busy periods.

**Acceptance Criteria:**

- [x] `issueLimit` configurable (default: 4, range: 1–100)
- [x] `dailySelectedCount` tracks distinct issues selected today
- [x] New issue skipped (with log message) when `dailySelectedCount >= issueLimit`
- [x] Count resets to 0 at midnight UTC (`dailyResetDate` changes)
- [x] Update emails for already-selected issues do NOT count toward limit
- [x] Count resets when `watchedRepo` changes

**Tests:** `events-poller.service.test.ts` — limit, reset, and multi-event tests pass  
**Status:** COMPLETE

---

### US-07 — Only notify about recently-created issues

**As a** user who doesn't want stale events consuming my daily limit,  
**I want** the system to ignore issues older than 7 days,  
**So that** my daily limit is only used on current activity.

**Acceptance Criteria:**

- [x] `isRecentlyCreated()` checks `issue.created_at` ≤ 7 days from now
- [x] Issues older than 7 days are skipped silently
- [x] The 7-day filter applies to `opened` and `labeled` actions only
- [x] Update notifications for previously-selected issues are not affected by this filter

**Tests:** `events-poller.service.test.ts` — stale issue (10 days old) correctly skipped  
**Status:** COMPLETE

---

### US-08 — Efficient GitHub API usage with ETag

**As a** user without a GitHub Personal Access Token,  
**I want** the system to stay within the 60 requests/hour rate limit,  
**So that** I don't get blocked by GitHub.

**Acceptance Criteria:**

- [x] ETag from GitHub `etag` header saved to `Config.lastEtag`
- [x] Subsequent requests include `If-None-Match: {lastEtag}` header
- [x] GitHub returns 304 Not Modified when no new events → no rate limit cost
- [x] With 60s polling: ~6 real requests/hour (90%+ return 304)
- [x] `X-Poll-Interval` header respected — poll interval updated dynamically
- [x] On 403 rate limit: automatically backs off to 120 seconds

**Tests:** `events-poller.service.test.ts` — ETag, 304, 403 tests pass  
**Status:** COMPLETE

---

### US-09 — View all notification records

**As a** user who wants to review what's been sent,  
**I want to** list all notification records with filtering and pagination,  
**So that** I can audit my notification history.

**Acceptance Criteria:**

- [x] `GET /api/notifications` returns paginated list (`page`, `limit` params)
- [x] Filter by `status=PENDING|SENT|FAILED`
- [x] Default: excludes soft-deleted records
- [x] `?includeDeleted=true` shows soft-deleted records
- [x] Each record includes: `id`, `githubIssueNumber`, `title`, `url`, `status`, `attempts`, etc.
- [x] `GET /api/notifications/:id` returns single record (404 if not found)

**Tests:** `notifications.test.ts` — 8 list tests + single record tests pass  
**Status:** COMPLETE

---

### US-10 — Manage notification records (delete, restore)

**As a** user who wants to clean up old records,  
**I want to** soft-delete records (hide them) or permanently delete them,  
**And** be able to restore soft-deleted records if I change my mind.

**Acceptance Criteria:**

- [x] `DELETE /api/notifications/:id` — soft delete: sets `deletedAt`, record preserved
- [x] Soft-deleted records excluded from default list but accessible with `?includeDeleted=true`
- [x] `DELETE /api/notifications/:id/hard` — permanent delete: removes row from DB
- [x] `POST /api/notifications/:id/restore` — clears `deletedAt`, record visible again
- [x] Returns 409 if soft-delete attempted on already-deleted record
- [x] Returns 409 if restore attempted on a non-deleted record
- [x] Returns 404 for unknown ID on all operations

**Tests:** `notifications.test.ts` — full lifecycle test + individual operation tests pass  
**Status:** COMPLETE

---

### US-11 — Secure GitHub token configuration

**As a** user with a GitHub Personal Access Token,  
**I want to** store it securely and get 5000 requests/hour,  
**So that** the poller runs reliably even with frequent polling.

**Acceptance Criteria:**

- [x] `PUT /api/config` accepts `githubToken` (or `null` to clear)
- [x] Token stored in `Config.githubToken` field in DB
- [x] Token NEVER returned in `GET /api/config` response
- [x] `hasGithubToken: boolean` indicates if token is set without exposing it
- [x] Token passed to `new Octokit({ auth: token })` for authenticated requests

**Tests:** `config.test.ts` — githubToken visibility and hasGithubToken tests pass  
**Status:** COMPLETE

---

### US-12 — Health monitoring endpoints

**As an** operator deploying this tool,  
**I want** HTTP health check endpoints,  
**So that** uptime monitors (e.g. UptimeRobot) can verify the service is running.

**Acceptance Criteria:**

- [x] `GET /health` → `{ status: "ok", uptime: <seconds> }` — always returns 200
- [x] `GET /health/ready` → `{ status: "ready", db: "connected" }` — returns 200 when DB accessible
- [x] `GET /health/ready` → `{ status: "not ready", db: "disconnected" }` — returns 503 when DB fails

**Tests:** `health.test.ts` + `health.unit.test.ts` — 5+2 tests pass (including 503 error path)  
**Status:** COMPLETE

---

## Non-Functional Requirements Completed

| Requirement | Implementation | Status |
|---|---|---|
| Security headers | Helmet.js on all responses | COMPLETE |
| CORS protection | Configurable CORS_ORIGIN | COMPLETE |
| Rate limiting | 200 req / 15 min on /api/* | COMPLETE |
| Input validation | Zod on all request bodies | COMPLETE |
| Structured logging | Pino JSON logs | COMPLETE |
| Production deployment | Fly.io Docker ($2.10/month) | DOCUMENTED |
| CI/CD | GitHub Actions → Fly.io | COMPLETE |
| Zero-cost option | Oracle Cloud Always Free | DOCUMENTED |

---

## Stories NOT in Scope (by design)

| Story | Reason Excluded |
|---|---|
| Multi-user accounts / auth | Single-user tool by design |
| Webhook-based push notifications | Requires repo admin access |
| Mobile notifications | Out of scope |
| Issue commenting | Out of scope |
| GitHub sign-in | Not needed — uses PAT instead |
| Redis / job queue | Replaced by DB-backed queue |
| Proposal generation | Removed — out of scope |
