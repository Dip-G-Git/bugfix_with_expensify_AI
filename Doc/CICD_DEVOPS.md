# CI/CD & DevOps Guide — Expensify Issue Notifier & Auto-Proposer

## Overview

Every push triggers automated quality checks. Merges to `main` trigger production deployment.

```
Developer pushes code
        │
        ▼
┌───────────────────────────────────────┐
│  GitHub Actions: CI Pipeline          │
│                                       │
│  1. Lint (ESLint + Prettier)          │
│  2. TypeScript type check             │
│  3. Unit tests (Vitest)               │
│  4. API integration tests             │
│  5. Build backend                     │
│  6. Build frontend (Next.js)          │
│  7. [PR only] E2E tests (Playwright)  │
│  8. Coverage report                   │
└───────────────────────────────────────┘
        │
        │ (only on merge to main)
        ▼
┌───────────────────────────────────────┐
│  GitHub Actions: Deploy Pipeline      │
│                                       │
│  1. Build Docker image (backend)      │
│  2. Push image to Registry            │
│  3. Deploy to Render.com (backend)    │
│  4. Deploy to Vercel (frontend)       │
│  5. Run smoke tests against prod      │
└───────────────────────────────────────┘
```

---

## GitHub Actions Workflows

### CI Workflow (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: '26'

jobs:
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test-backend:
    name: Backend Tests
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Run unit tests
        working-directory: backend
        run: npm run test:unit
      - name: Run API integration tests
        working-directory: backend
        env:
          DATABASE_URL: "file:./test.db"
          REDIS_URL: "redis://localhost:6379"
          JWT_SECRET: "test-secret-min-32-chars-abcdefgh"
          JWT_REFRESH_SECRET: "test-refresh-secret-min-32-chars"
          ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef"
        run: npm run test:api
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          directory: backend/coverage

  test-frontend:
    name: Frontend Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - working-directory: frontend
        run: npm run test

  build:
    name: Build Verification
    runs-on: ubuntu-latest
    needs: [lint, test-backend, test-frontend]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build

  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: [build]
    if: github.event_name == 'pull_request' && github.base_ref == 'main'
    services:
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Install Playwright browsers
        working-directory: frontend
        run: npx playwright install --with-deps chromium
      - name: Start backend
        working-directory: backend
        env:
          DATABASE_URL: "file:./e2e-test.db"
          REDIS_URL: "redis://localhost:6379"
          JWT_SECRET: "test-secret-min-32-chars-abcdefgh"
          JWT_REFRESH_SECRET: "test-refresh-secret-min-32-chars"
          ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef"
          NODE_ENV: "test"
        run: |
          npm run db:push
          npm run db:seed:test
          npm run start &
          sleep 5
      - name: Start frontend
        working-directory: frontend
        env:
          NEXT_PUBLIC_API_URL: "http://localhost:3001"
        run: npm run build && npm run start &
      - name: Wait for servers
        run: npx wait-on http://localhost:3001/health http://localhost:3000
      - name: Run E2E tests
        working-directory: frontend
        run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: frontend/playwright-report/
```

### Deploy Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    name: Deploy Backend to Render
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render Deploy Hook
        run: |
          curl -s -X POST "${{ secrets.RENDER_DEPLOY_HOOK_URL }}"

  deploy-frontend:
    name: Deploy Frontend to Vercel
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '26'
          cache: 'npm'
      - run: npm install -g vercel@latest
      - run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend
      - run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend
      - run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend

  smoke-test:
    name: Production Smoke Test
    runs-on: ubuntu-latest
    needs: [deploy-backend, deploy-frontend]
    steps:
      - name: Health check backend
        run: |
          sleep 30  # Wait for deploy to complete
          curl -f "${{ secrets.PROD_API_URL }}/health" || exit 1
      - name: Health check frontend
        run: curl -f "${{ secrets.PROD_FRONTEND_URL }}" || exit 1
```

---

## Required GitHub Secrets

Configure these in your repository: **Settings → Secrets and variables → Actions**

| Secret Name              | Description                                      |
|--------------------------|--------------------------------------------------|
| `RENDER_DEPLOY_HOOK_URL` | Render deploy webhook URL (from Render dashboard)|
| `VERCEL_TOKEN`           | Vercel personal access token                     |
| `VERCEL_ORG_ID`          | Vercel team/org ID                               |
| `VERCEL_PROJECT_ID`      | Vercel project ID                                |
| `PROD_API_URL`           | Production backend URL (for smoke tests)         |
| `PROD_FRONTEND_URL`      | Production frontend URL (for smoke tests)        |

---

## Docker Setup

### `docker-compose.yml` (Local Development)

```yaml
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

### `docker-compose.prod.yml` (Production)

```yaml
version: '3.9'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - '3001:3001'
    environment:
      - NODE_ENV=production
    env_file:
      - ./backend/.env.production
    restart: always
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3001/health']
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  postgres-data:
```

### `backend/Dockerfile`

```dockerfile
# Build stage
FROM node:26-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Production stage
FROM node:26-alpine AS runner
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
USER appuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/server.js"]
```

---

## Branch Strategy

```
main ─────────────────────────────────────────► production deploy
  └── develop ─────────────────────────────────► staging (optional)
        ├── feat/add-proposal-template
        ├── fix/grace-period-calculation
        └── chore/update-dependencies
```

**Rules:**
- `main` — always deployable; protected branch
- Direct pushes to `main` are disabled; PRs required
- At least 1 review required to merge to `main`
- All CI checks must pass before merge
- Feature branches: prefix with `feat/`, `fix/`, `chore/`, `docs/`

---

## Pre-commit Hooks (Husky)

Runs automatically on `git commit`:

```
pre-commit:
  └── lint-staged
        ├── *.{ts,tsx} → ESLint --fix → Prettier --write
        └── *.{json,md,yml} → Prettier --write

commit-msg:
  └── Conventional commit message format check
      (feat: | fix: | chore: | docs: | test: | refactor:)
```

**Conventional commit examples:**
```
feat: add grace period enforcement to poller
fix: prevent duplicate proposals on relabelled issues
chore: update @octokit/rest to v21
docs: add deployment section to README
test: add regression test for daily limit boundary
```

---

## Dependabot

Configured to auto-open PRs for dependency updates:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
    groups:
      dependencies:
        update-types: ["minor", "patch"]

  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
```

---

## Monitoring & Observability

### Structured Logging (Pino)

All logs are structured JSON in production:
```json
{"level":30,"time":1749600000000,"service":"github-poller","msg":"Polled 12 issues","matched":3}
{"level":50,"time":1749600001000,"service":"email","msg":"Failed to send","error":"EAUTH","userId":"usr_1"}
```

Render.com streams these logs to its dashboard automatically.

### Health Endpoints

```
GET /health       → 200 {"status":"ok","uptime":12345}
GET /health/ready → 200 {"status":"ready","db":"connected","redis":"connected"}
              or → 503 {"status":"not ready","db":"disconnected"}
```

### Render.com Alerting

Configure Render health check alerts:
- **Health check path:** `/health/ready`
- **Failure threshold:** 3 consecutive failures
- **Notification:** Email alert to `sandipanghosh64@gmail.com`

---

## Cost Breakdown (Production)

| Service         | Tier      | Cost/month | Notes                            |
|-----------------|-----------|-----------|----------------------------------|
| Render.com      | Starter   | $7        | Always-on, 512MB RAM             |
| Neon PostgreSQL | Free      | $0        | 512MB, 1 compute unit            |
| Upstash Redis   | Free      | $0        | 10K commands/day                 |
| Vercel          | Hobby     | $0        | Frontend, unlimited deploys      |
| GitHub Actions  | Free      | $0        | 2,000 min/month free for private |
| **Total**       |           | **$7/mo** |                                  |

> **Free alternative:** Use Render.com Free tier ($0) — the service sleeps after 15 min of inactivity. For a background poller that runs every 5 min, this is a problem. Use the $7 Starter tier for production.
