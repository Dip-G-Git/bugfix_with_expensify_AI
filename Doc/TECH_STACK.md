# Technology Stack — Expensify Issue Notifier & Auto-Proposer

## Stack Summary

| Layer         | Technology         | Version    | Purpose                               |
|---------------|--------------------|------------|---------------------------------------|
| Runtime       | Node.js            | v26.x LTS  | Server runtime                        |
| Language      | TypeScript         | 5.x        | Type-safe JavaScript                  |
| API Framework | Express.js         | 5.x        | HTTP server & routing                 |
| ORM           | Prisma             | 6.x        | Database access & migrations          |
| Database      | SQLite (dev)       | —          | Local development                     |
| Database      | PostgreSQL (prod)  | 16.x       | Production via Neon free tier         |
| Job Queue     | BullMQ             | 5.x        | Background job scheduling             |
| Cache/Queue   | Redis              | 7.x        | BullMQ backend (Upstash free tier)    |
| Email         | Nodemailer         | 6.x        | Gmail SMTP email delivery             |
| GitHub Client | @octokit/rest      | 21.x       | GitHub API integration                |
| Scheduler     | node-cron          | 3.x        | Cron-based polling                    |
| Validation    | Zod                | 3.x        | Runtime schema validation             |
| Auth          | JWT (jsonwebtoken) | 9.x        | API authentication                    |
| Logging       | Pino               | 9.x        | Structured JSON logging               |
| Security      | Helmet + CORS      | latest     | HTTP security hardening               |
| Rate Limiting | express-rate-limit | 7.x        | API abuse prevention                  |

### Frontend

| Layer       | Technology          | Version | Purpose                              |
|-------------|---------------------|---------|--------------------------------------|
| Framework   | Next.js             | 15.x    | React full-stack framework           |
| UI          | shadcn/ui           | latest  | Accessible component library         |
| Styling     | Tailwind CSS        | 4.x     | Utility-first CSS                    |
| State       | Zustand             | 5.x     | Lightweight global state             |
| Data fetch  | TanStack Query      | 5.x     | Server state, caching, invalidation  |
| Forms       | React Hook Form     | 7.x     | Performant form management           |
| Validation  | Zod                 | 3.x     | Shared frontend/backend schemas      |
| Icons       | Lucide React        | latest  | Icon library                         |

### Testing

| Type            | Tool                  | Purpose                              |
|-----------------|-----------------------|--------------------------------------|
| Unit tests      | Vitest                | Fast, ESM-native unit testing        |
| API tests       | Supertest + Vitest    | HTTP integration tests               |
| E2E tests       | Playwright            | Browser-level end-to-end tests       |
| Component tests | Testing Library       | React component testing              |
| Code quality    | ESLint + Prettier     | Linting and formatting               |
| Pre-commit      | Husky + lint-staged   | Enforce quality on commit            |
| Coverage        | c8 (Vitest built-in)  | Code coverage reporting              |
| API contract    | Zod schemas           | Schema-level contract verification   |

### DevOps / CI/CD

| Tool              | Purpose                                  |
|-------------------|------------------------------------------|
| GitHub Actions    | CI pipeline (lint, test, build)          |
| Docker            | Containerisation for production deploy   |
| Docker Compose    | Local multi-service development          |
| Render.com        | Production hosting (backend)             |
| Vercel            | Production hosting (frontend)            |
| Neon              | Managed PostgreSQL (free tier)           |
| Upstash           | Managed Redis (free tier)                |
| Dependabot        | Automated dependency updates             |
| CodeClimate / SonarCloud | Code quality gate                 |

---

## Why Each Choice

### Node.js v26
- Latest stable release (released April 2025)
- Native `fetch`, ESM by default, improved performance over v22
- Long-term support roadmap

### TypeScript (not plain JS)
- "JavaScript-based" ✓ — TypeScript compiles to JavaScript
- Catches bugs at compile time (null checks, wrong prop types)
- Prisma generates fully-typed query results
- Zod schemas can be inferred as TypeScript types (single source of truth)

### Express.js v5 (not Fastify/Hono)
- Most familiar, best documentation, largest ecosystem
- v5 stable since 2024: native promise/async error handling
- Sufficient for 1–3 users (no need for Fastify's raw throughput)

### Prisma (not Drizzle/TypeORM)
- Best-in-class DX: auto-generated types, visual DB browser
- Handles SQLite ↔ PostgreSQL migration with a single config change
- Schema-first: migrations are explicit and reviewable

### BullMQ (not simple cron-only)
- Persistent jobs survive server restarts (Redis-backed)
- Retry with exponential backoff (important for GitHub API rate limits)
- Job visibility: see queue depth in dashboard
- For 1-3 users, free Upstash Redis is sufficient

### Next.js 15 (not CRA/Vite React)
- App Router + Server Components = less client-side JS
- Built-in API routes (no separate server needed for frontend BFF)
- One-click Vercel deploy
- Best TypeScript support in React ecosystem

### shadcn/ui (not MUI/Chakra)
- Components are copied into your codebase — full control
- Tailwind-based — consistent with modern design systems
- Accessible by default (Radix UI primitives)
- No runtime CSS-in-JS overhead

### Vitest (not Jest)
- 10–30x faster than Jest for ESM projects
- Jest-compatible API — easy migration
- Native TypeScript support without Babel

### Playwright (not Cypress)
- Runs in CI without browser binary issues
- Supports Chromium + Firefox + WebKit
- Better async handling and parallel test execution

### Render.com (deployment)
- Free tier available (sleeps after 15 min inactivity — acceptable for dev)
- Starter tier ($7/mo) = always-on, 512MB RAM, sufficient for 1-3 users
- One-click Docker deploy + environment variable management
- Better free tier than Heroku post-2022

### Neon (PostgreSQL)
- Free tier: 512MB storage, 1 compute unit, branching (for staging)
- Serverless Postgres — scales to zero when idle
- Direct Prisma integration

### Upstash (Redis)
- Free tier: 10,000 commands/day — sufficient for BullMQ at this scale
- REST API + native Redis protocol support

---

## Package Manager

**npm** (default, comes with Node.js)

> Alternatively: **pnpm** for 40–60% faster installs and disk efficiency in monorepos. Recommend switching to pnpm if the project grows.

---

## Node.js Version Management

Use `.nvmrc` or `.node-version` file pinned to `26` to ensure all contributors use the same version.

With `nvm`: `nvm use` in project root will auto-select Node 26.

---

## Environment Requirements

| Environment | Database   | Redis           | Email         |
|-------------|------------|-----------------|---------------|
| Development | SQLite     | Docker (local)  | Ethereal.email (fake SMTP) |
| Test        | SQLite (in-memory) | ioredis-mock | Mocked        |
| Production  | Neon PG    | Upstash Redis   | Gmail SMTP    |
