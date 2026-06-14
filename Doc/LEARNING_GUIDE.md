# Learning Guide — GitHub Issue Notifier

This guide teaches every technology used in this project, in the order you should learn it.

---

## Learning Path Overview

```
Phase 1: Foundations
   TypeScript → Node.js → Async/Await

Phase 2: Backend Core
   Express.js → Prisma + SQLite → REST API Design → Zod Validation

Phase 3: Integrations
   GitHub Events API → ETag / Conditional Requests → Nodemailer (SMTP)

Phase 4: Scheduling & Reliability
   setTimeout vs setInterval → Dynamic intervals → Retry patterns

Phase 5: Testing
   Vitest → Supertest → MSW (API mocking)

Phase 6: DevOps
   Docker (multi-stage builds) → Fly.io → GitHub Actions CI/CD
```

Estimated total: **3–5 weeks** for someone with basic JavaScript knowledge.

---

## Phase 1: Foundations

### 1.1 TypeScript

TypeScript adds types to JavaScript. It catches entire classes of bugs before they reach production.

**Key concepts:**
- Primitive types: `string`, `number`, `boolean`
- Union types: `'PENDING' | 'SENT' | 'FAILED'`
- Optional properties: `field?: string`
- Interfaces vs type aliases
- Generics: `function first<T>(arr: T[]): T`
- `as const` and enums
- `async/await` with typed Promises

**Where you'll see it in this project:**
```typescript
// prisma/schema.prisma generates these types automatically:
type NotifStatus = 'PENDING' | 'SENT' | 'FAILED';

// Zod validates and infers types at runtime:
const schema = z.object({ email: z.string().email(), limit: z.number().int().min(1) });
type Config = z.infer<typeof schema>;
```

**Resources:**
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — Official, free
- [Total TypeScript Beginners Tutorial](https://www.totaltypescript.com/tutorials/beginners-typescript) — Interactive

---

### 1.2 Node.js Fundamentals

**Key concepts:**
- `package.json` — scripts, dependencies, `"type": "module"` (ESM)
- ESM imports: `import { x } from './module.js'` (note the `.js` extension)
- `process.env` — reading environment variables
- `async/await` in the event loop
- Error handling: `try/catch` and unhandled rejections

**Where you'll see it:**
```typescript
// ESM module (this project uses NodeNext module resolution)
import { prisma } from '../db/client.js';   // .js extension required
import { env } from '../utils/env.js';
```

**Resources:**
- [Node.js Official Docs — Getting Started](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)

---

### 1.3 Async/Await Patterns

**Key patterns used in this project:**
```typescript
// Sequential — each waits for the previous
const config = await prisma.config.findUnique({ where: { id: 'singleton' } });
const records = await prisma.notificationRecord.findMany({ ... });

// Parallel — both run at the same time
const [records, total] = await Promise.all([
  prisma.notificationRecord.findMany({ ... }),
  prisma.notificationRecord.count({ ... }),
]);

// allSettled — runs all, doesn't fail if one throws
await Promise.allSettled(users.map(u => pollForUser(u)));
```

---

## Phase 2: Backend Core

### 2.1 Express.js v5

Express handles HTTP routing and middleware.

**Key concepts:**
- `Router()` — groups related routes into modules
- Middleware — functions that run before route handlers (`helmet`, `cors`, `rateLimit`)
- `req.body`, `req.params`, `req.query`
- `res.json()`, `res.status(404).json(...)`
- Error middleware — 4-argument function, must be registered last
- `next(err)` — passes error to error handler

**Pattern used throughout this project:**
```typescript
// api/config.routes.ts
configRouter.get('/status', async (_req, res, next) => {
  try {
    const config = await prisma.config.findUnique({ where: { id: 'singleton' } });
    res.json({ isRunning: config?.isRunning });
  } catch (err) {
    next(err);  // goes to error.middleware.ts
  }
});
```

**Resources:**
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

---

### 2.2 Prisma ORM

Prisma is a type-safe database client. Define your schema, get full TypeScript types for free.

**Key concepts:**
- `schema.prisma` — defines models (tables), fields, relations, enums
- `prisma generate` — generates the TypeScript client from schema
- `prisma db push` — syncs schema to DB (dev/simple cases)
- CRUD: `findUnique`, `findMany`, `create`, `update`, `upsert`, `delete`
- `upsert` — insert if not exists, update if exists (used for Config singleton)
- Atomic increments: `{ increment: 1 }` (thread-safe counter updates)

**Schema used in this project:**
```prisma
model Config {
  id                 String  @id @default("singleton")
  notificationEmail  String  @default("")
  watchedRepo        String  @default("Expensify/App")
  watchedLabel       String  @default("Help Wanted")
  issueLimit         Int     @default(4)
  dailySelectedCount Int     @default(0)
  isRunning          Boolean @default(false)
}

model NotificationRecord {
  id                String      @id @default(cuid())
  githubIssueNumber Int         @unique
  status            NotifStatus @default(PENDING)
  // ... more fields
}
```

**Key operations:**
```typescript
// Upsert singleton config
await prisma.config.upsert({
  where: { id: 'singleton' },
  create: { id: 'singleton', notificationEmail: '' },
  update: { isRunning: true },
});

// Atomic increment (safe from race conditions)
await prisma.config.update({
  where: { id: 'singleton' },
  data: { dailySelectedCount: { increment: 1 } },
});
```

**Resources:**
- [Prisma Getting Started](https://www.prisma.io/docs/getting-started)

---

### 2.3 REST API Design

**Principles used in this project:**
- Use HTTP verbs: `GET` (read), `POST` (create/action), `PUT` (replace), `DELETE` (remove)
- Consistent response shapes: `{ data: ... }` or `{ error: '...' }`
- Correct status codes: `200`, `201`, `400`, `404`, `409`, `503`
- Actions as sub-resources: `POST /api/config/start`, `POST /api/config/stop`
- Soft vs hard delete: `DELETE /id` (soft) vs `DELETE /id/hard` (permanent)

---

### 2.4 Zod Validation

Zod validates and parses data at runtime while generating TypeScript types.

**Used for:**
- Validating environment variables at startup (`env.ts`)
- Validating all API request bodies before touching the DB

```typescript
// env.ts — fails fast on startup if env is misconfigured
const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  SMTP_USER: z.string().email(),
  SMTP_PASS: z.string().min(1),
});

// config.routes.ts — validates PUT /api/config body
const updateConfigSchema = z.object({
  notificationEmail: z.string().email().optional(),
  watchedRepo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be owner/repo').optional(),
  issueLimit: z.coerce.number().int().min(1).max(100).optional(),
});
```

**Resources:**
- [Zod Docs](https://zod.dev/)

---

## Phase 3: Integrations

### 3.1 GitHub Events API

The Events API streams what's happening in a repo. This is what the poller uses instead of the Issues API.

**Why Events API instead of Issues API:**
- Issues API filters by `updated_at` — old issues fall out of results permanently
- Events API filters by event time — every action (opened, labeled, edited) is a discrete event
- Events API supports ETag — dramatically reduces rate limit usage

**The endpoint:**
```
GET /repos/{owner}/{repo}/events?per_page=20
```

**Response event types:**
```json
{
  "type": "IssuesEvent",
  "payload": {
    "action": "opened",
    "issue": {
      "number": 12345,
      "title": "Fix the bug",
      "html_url": "https://github.com/...",
      "created_at": "2024-01-01T00:00:00Z",
      "labels": [{ "name": "Help Wanted" }]
    }
  }
}
```

**Actions handled by this project:**

| Action | Meaning | What we do |
|---|---|---|
| `opened` | Issue created | Select if has watched label + under daily limit |
| `labeled` | Label added to issue | Select if new, or queue update if already selected |
| `edited` | Title/body changed | Queue update email for already-selected issues |
| `reopened` | Issue reopened | Queue update email for already-selected issues |

**Resources:**
- [GitHub Events API Docs](https://docs.github.com/en/rest/activity/events)

---

### 3.2 ETag and Conditional Requests

ETag (Entity Tag) is a cache validation mechanism. It makes polling extremely efficient.

**How it works:**
```
First request:
  GET /repos/owner/repo/events
  → Response 200 + header: ETag: "abc123"
  → Save ETag to DB

Next request (nothing changed):
  GET /repos/owner/repo/events
  Header: If-None-Match: "abc123"
  → Response 304 Not Modified (no body, almost no rate limit cost)
  → Skip processing

Next request (new events exist):
  GET /repos/owner/repo/events
  Header: If-None-Match: "abc123"
  → Response 200 + new ETag: "def456" + new events
  → Process events, save new ETag
```

**Also important: `X-Poll-Interval` header**

GitHub returns this on every response to tell you the minimum polling interval (usually 60 seconds). The scheduler reads this and adjusts dynamically:

```typescript
const pollInterval = parseInt(response.headers['x-poll-interval'] ?? '60', 10);
await prisma.config.update({ data: { pollIntervalSeconds: pollInterval } });
return pollInterval; // next poll waits this many seconds
```

**Rate limit math with ETag:**
- Without ETag: 60 polls/hour × 1 request = 60 requests/hour
- With ETag (90% 304s): 60 polls/hour × 0.1 "real" requests = 6 requests/hour
- Authenticated limit: 5,000/hour — you're using ~0.1% of your quota

---

### 3.3 Nodemailer (SMTP Email)

Nodemailer sends email via SMTP. This project uses Gmail's SMTP server.

**Key concepts:**
- `transporter` — configured connection to SMTP server
- `sendMail()` — sends an email; throws on failure (caught for retry)
- HTML + plain text versions (accessibility)
- Gmail requires App Password (not your account password) when 2FA is enabled

**Pattern in this project:**
```typescript
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

await transporter.sendMail({
  from: `"GitHub Issue Notifier" <${env.SMTP_USER}>`,
  to: config.notificationEmail,
  subject: `[New Issue] #${issue.number}: ${issue.title}`,
  html: `<a href="${issue.url}">${issue.title}</a>`,
  text: `${issue.title}\n${issue.url}`,
});
```

**Resources:**
- [Nodemailer Docs](https://nodemailer.com/)

---

## Phase 4: Scheduling & Reliability

### 4.1 Dynamic Scheduling with setTimeout

This project does NOT use `node-cron` or `setInterval` for the poller. It uses recursive `setTimeout` with a dynamic interval.

**Why?** The poll interval changes based on GitHub's `X-Poll-Interval` response header. `setInterval` has a fixed interval that can't be changed after creation.

```typescript
// Recursive setTimeout — each cycle schedules the next one
async function runAndReschedule() {
  const nextIntervalSeconds = await EventsPollerService.poll();
  // Waits exactly however long GitHub says, then runs again
  setTimeout(runAndReschedule, nextIntervalSeconds * 1000);
}

setTimeout(runAndReschedule, 2_000); // first run after 2s startup delay
```

**vs setInterval (used for email sender — fixed 20s):**
```typescript
setInterval(async () => {
  await NotificationSenderService.send();
}, 20_000);
```

**Key insight:** `setTimeout` is one-shot. `setInterval` fires repeatedly at fixed intervals. Recursive `setTimeout` gives you more control over timing between runs.

---

### 4.2 The DB-Backed Queue Pattern

This project replaces Redis/BullMQ with a simple database-backed queue:

**The queue IS the `NotificationRecord` table:**

| status | meaning |
|---|---|
| `PENDING` | Email not yet sent — will be picked up within 20s |
| `SENT` | Email sent successfully |

**Producer** (Events Poller):
```typescript
// "Enqueue" = INSERT a PENDING record
await prisma.notificationRecord.create({
  data: { githubIssueNumber: 123, status: 'PENDING', ... }
});
```

**Consumer** (Email Sender, runs every 20s):
```typescript
const pending = await prisma.notificationRecord.findMany({
  where: { status: 'PENDING', deletedAt: null }
});
for (const record of pending) {
  await sendEmail(...);              // try
  await prisma.notificationRecord.update({ data: { status: 'SENT' } });
}
// On failure: status stays PENDING → retried next 20s cycle
```

**Advantages over Redis/BullMQ for this use case:**
- No separate Redis service to run
- Queue state is visible in Prisma Studio
- Retries happen automatically (failed = stays PENDING)
- No additional dependencies

---

### 4.3 Retry Without Max Attempts

The email sender has no maximum retry count. It retries forever until success.

**Why:** If SMTP is down for 2 hours, we don't want to permanently lose notifications — we want them sent when the server comes back.

**How it works:**
- Job fails → `status` stays `PENDING`, `attempts` incremented
- Next 20s cycle: picks it up again, tries again
- Eventually SMTP recovers → email sent → `status: SENT`

**Contrast with BullMQ:**
- BullMQ has `attempts: 3` — after 3 failures the job moves to FAILED queue
- You need separate monitoring to detect and retry FAILED jobs
- This project's approach: simpler, no dead letter queue needed

---

## Phase 5: Testing

### 5.1 Vitest

Vitest is the test runner. It uses the same API as Jest.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('EventsPollerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips issues older than 7 days', async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    // ... test that isRecentlyCreated(oldDate) === false
  });
});
```

**Resources:**
- [Vitest Docs](https://vitest.dev/guide/)

---

### 5.2 Supertest (API Tests)

Tests Express routes without starting a real HTTP server:

```typescript
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

it('GET /api/config returns config', async () => {
  const res = await request(app).get('/api/config');
  expect(res.status).toBe(200);
  expect(res.body.config).toHaveProperty('watchedLabel');
});
```

**Resources:**
- [Supertest GitHub](https://github.com/ladjs/supertest)

---

### 5.3 MSW (Mock Service Worker)

MSW intercepts HTTP requests in tests. Used to mock GitHub API responses without real API calls:

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('https://api.github.com/repos/*/events', () => {
    return HttpResponse.json([
      { type: 'IssuesEvent', payload: { action: 'opened', issue: { ... } } }
    ]);
  })
);
```

**Resources:**
- [MSW Docs](https://mswjs.io/docs/)

---

## Phase 6: DevOps

### 6.1 Docker Multi-Stage Builds

Multi-stage builds produce smaller, more secure production images.

**This project's Dockerfile:**
```dockerfile
# Stage 1: Builder — has devDependencies, compiles TypeScript
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci                          # installs ALL deps
COPY tsconfig*.json ./
COPY src ./src/
RUN npm run build && npx prisma generate  # compile TS + generate Prisma client

# Stage 2: Runner — lean production image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules  # copy from builder
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY prisma ./prisma/
RUN mkdir -p /data                  # SQLite volume mount point
EXPOSE 3001
CMD ["sh", "-c", "node_modules/.bin/prisma db push --skip-generate && node dist/server.js"]
```

**Why two stages?**
- Builder stage installs devDependencies (TypeScript compiler, etc.)
- Runner stage only has what's needed at runtime
- Result: smaller image, faster startup, smaller attack surface

**Resources:**
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)

---

### 6.2 Fly.io Deployment

Fly.io runs Docker containers globally. Closest to "zero-config" production for Node.js.

**Key concepts:**
- `fly.toml` — app configuration (region, volume mounts, health checks)
- `flyctl secrets` — store sensitive env vars (never in fly.toml)
- `[[mounts]]` — persistent volume (for SQLite file survival across deploys)
- `auto_stop_machines = false` — critical for a poller that must run 24/7

**Why persistent volume matters:**
Without a volume, the SQLite file is inside the container and lost on every deploy. With `[[mounts]]`, the SQLite file lives on a network volume that survives restarts and redeploys.

```toml
[[mounts]]
  source      = 'notifier_data'
  destination = '/data'           # DATABASE_URL = file:/data/prod.db

[http_service]
  auto_stop_machines = false      # NEVER sleep — poller must always run
  min_machines_running = 1
```

**Resources:**
- [Fly.io Docs](https://fly.io/docs/)
- [Fly.io + SQLite Guide](https://fly.io/docs/litefs/)

---

### 6.3 GitHub Actions CI/CD

`.github/workflows/deploy.yml` auto-deploys to Fly.io on every push to `master` that touches `backend/`:

```yaml
on:
  push:
    branches: [master]
    paths:
      - 'backend/**'     # only triggers when backend code changes

jobs:
  deploy:
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}  # from repo secrets
```

**`--remote-only`** means Fly.io builds the Docker image on their servers, not locally. No Docker needed on the CI runner.

**Resources:**
- [GitHub Actions Docs](https://docs.github.com/en/actions)

---

## Useful Commands Cheat Sheet

```bash
# TypeScript
npx tsc --noEmit             # type check without building
npx tsc -p tsconfig.build.json  # build

# Prisma
npx prisma studio            # visual DB browser at localhost:5555
npx prisma db push           # apply schema changes to SQLite
npx prisma generate          # regenerate client after schema change

# Fly.io
flyctl status                # machine status
flyctl logs                  # live logs (Ctrl+C to stop)
flyctl ssh console           # SSH into the running machine
flyctl secrets set KEY=VALUE # set a secret env var
flyctl deploy --remote-only  # deploy latest code

# Testing
npm run test                 # all tests
npm run test:watch           # watch mode
npm run test:coverage        # with coverage report
```

---

## Recommended Reading Order for This Codebase

1. `backend/prisma/schema.prisma` — understand the two data models (Config, NotificationRecord)
2. `backend/src/utils/env.ts` — what env vars are required
3. `backend/src/jobs/schedulers.ts` — how the two schedulers start
4. `backend/src/services/events-poller.service.ts` — the core polling logic
5. `backend/src/services/notification-sender.service.ts` — how emails are sent and retried
6. `backend/src/api/config.routes.ts` — start/stop and config endpoints
7. `backend/src/api/notifications.routes.ts` — issue list and delete endpoints
8. `backend/Dockerfile` — how the app is containerised
9. `backend/fly.toml` — how it's deployed
10. [ARCHITECTURE.md](ARCHITECTURE.md) — the full system design picture
