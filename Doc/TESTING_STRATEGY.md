# Testing Strategy — Expensify Issue Notifier & Auto-Proposer

## Testing Philosophy

- **Test behaviour, not implementation** — tests should verify what the code does, not how
- **Fast feedback loop** — unit tests run in milliseconds; E2E tests run in CI only
- **Real integrations where it matters** — API tests use a real SQLite instance, not mocks
- **Deterministic** — tests never rely on network calls to GitHub or Gmail in CI

---

## Test Pyramid

```
         ╱─────╲
        ╱  E2E   ╲       5–10 tests — slow, high confidence, browser-driven
       ╱───────────╲
      ╱  API / Integ ╲   20–40 tests — medium speed, real DB, mocked externals
     ╱─────────────────╲
    ╱    Unit Tests      ╲ 80–120 tests — fast, isolated, all edge cases
   ╱──────────────────────╲
```

---

## Test Types

### 1. Unit Tests

**Tool:** Vitest  
**Location:** `backend/tests/unit/`, `frontend/tests/unit/`  
**Speed:** < 50ms per test  
**Coverage target:** 80%+ statement coverage

**What to unit test:**
- Service logic (guard checks, grace period calculation, daily limit enforcement)
- Utility functions (encryption, date helpers, label matching)
- Middleware functions (auth validation, error handler)
- Data transformation (GitHub API response → DB model)

**What NOT to unit test:**
- Prisma queries directly (test in integration tests)
- Express routing (test via Supertest API tests)
- External API calls (mock these)

**Example unit test:**

```typescript
// backend/tests/unit/services/guard.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuardService } from '../../../src/services/guard.service';
import type { GithubService } from '../../../src/services/github.service';

describe('GuardService.canSubmitProposal', () => {
  let mockGithub: GithubService;
  let guard: GuardService;

  beforeEach(() => {
    mockGithub = {
      getAssignedOpenIssues: vi.fn(),
    } as unknown as GithubService;
    guard = new GuardService(mockGithub);
  });

  it('returns true when user has no assigned issues', async () => {
    vi.mocked(mockGithub.getAssignedOpenIssues).mockResolvedValue([]);
    expect(await guard.canSubmitProposal('user1')).toBe(true);
  });

  it('returns false when user has an active assigned issue', async () => {
    vi.mocked(mockGithub.getAssignedOpenIssues).mockResolvedValue([{ id: 999 }]);
    expect(await guard.canSubmitProposal('user1')).toBe(false);
  });

  it('returns false when GitHub API throws', async () => {
    vi.mocked(mockGithub.getAssignedOpenIssues).mockRejectedValue(new Error('API error'));
    expect(await guard.canSubmitProposal('user1')).toBe(false);
  });
});
```

```typescript
// backend/tests/unit/utils/grace-period.test.ts
import { describe, it, expect } from 'vitest';
import { isGracePeriodPassed } from '../../../src/utils/grace-period';

describe('isGracePeriodPassed', () => {
  it('returns false for issues created less than 24 hours ago', () => {
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000);
    expect(isGracePeriodPassed(recent)).toBe(false);
  });

  it('returns true for issues created more than 24 hours ago', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(isGracePeriodPassed(old)).toBe(true);
  });

  it('returns false for issues created exactly 24 hours ago', () => {
    const exact = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isGracePeriodPassed(exact)).toBe(false);
  });
});
```

---

### 2. API / Integration Tests

**Tool:** Vitest + Supertest  
**Location:** `backend/tests/integration/`  
**Speed:** 100ms–2s per test  
**Coverage target:** All API endpoints covered

**Characteristics:**
- Use a **real SQLite test database** (reset between test suites)
- External services (GitHub API, Gmail) are **mocked at the HTTP level** using `msw` (Mock Service Worker)
- Full Express app is mounted — middleware, auth, validation all run

**Setup:**

```typescript
// backend/tests/integration/helpers/setup.ts
import { PrismaClient } from '@prisma/client';
import { setupServer } from 'msw/node';
import { githubHandlers } from '../mocks/github.handlers';

export const server = setupServer(...githubHandlers);
export const prisma = new PrismaClient({
  datasources: { db: { url: 'file:./test.db' } },
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});
```

**Example API test:**

```typescript
// backend/tests/integration/api/issues.test.ts
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../../../src/app';
import { prisma } from '../helpers/setup';
import { createTestUser, getTestToken } from '../helpers/auth';

describe('GET /api/issues', () => {
  let token: string;

  beforeEach(async () => {
    await prisma.issue.deleteMany();
    await prisma.user.deleteMany();
    const user = await createTestUser(prisma);
    token = getTestToken(user.id);
    await prisma.issue.create({
      data: { githubIssueNumber: 1, title: 'Test Issue', url: 'https://github.com/test' },
    });
  });

  it('returns 200 with list of issues', async () => {
    const res = await request(app)
      .get('/api/issues')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Test Issue');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(401);
  });

  it('returns 400 with invalid pagination params', async () => {
    const res = await request(app)
      .get('/api/issues?page=-1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
```

---

### 3. E2E Tests (End-to-End)

**Tool:** Playwright  
**Location:** `frontend/tests/e2e/`  
**Speed:** 5–30s per test  
**When:** Runs in CI on PR to `main`, not on every commit

**Characteristics:**
- Requires both backend and frontend dev servers running
- Uses a dedicated test database seeded with test data
- Tests critical user journeys from the browser

**Test scenarios:**

```typescript
// frontend/tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test('user can log in and see dashboard', async ({ page }) => {
  await page.goto('/');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('h1')).toContainText('Dashboard');
});

test('invalid credentials show error', async ({ page }) => {
  await page.goto('/');
  await page.fill('[name="email"]', 'wrong@example.com');
  await page.fill('[name="password"]', 'wrongpassword');
  await page.click('button[type="submit"]');
  await expect(page.locator('[role="alert"]')).toContainText('Invalid credentials');
});
```

```typescript
// frontend/tests/e2e/config.spec.ts
import { test, expect } from '@playwright/test';

test('user can add a watched label', async ({ page }) => {
  // Assumes already logged in (use storageState for auth)
  await page.goto('/dashboard/config');
  await page.fill('[placeholder="Enter label name"]', 'Help Wanted');
  await page.click('button:text("Add Label")');
  await expect(page.locator('.label-chip')).toContainText('Help Wanted');
});
```

---

### 4. Component Tests (Frontend)

**Tool:** Vitest + @testing-library/react  
**Location:** `frontend/tests/unit/`

```typescript
// frontend/tests/unit/components/IssueCard.test.tsx
import { render, screen } from '@testing-library/react';
import { IssueCard } from '../../../src/components/IssueCard';

describe('IssueCard', () => {
  it('renders issue title as a clickable link', () => {
    render(<IssueCard title="Fix login bug" url="https://github.com/test/1" issueNumber={1} />);
    const link = screen.getByRole('link', { name: 'Fix login bug' });
    expect(link).toHaveAttribute('href', 'https://github.com/test/1');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
```

---

### 5. Regression Tests

**Purpose:** Ensure previously fixed bugs do not return.

Every bug fix MUST be accompanied by a test that would have caught it. Name the test file after the issue, e.g.:

```
backend/tests/regression/
  issue-001-duplicate-notifications.test.ts
  issue-002-grace-period-off-by-one.test.ts
  issue-003-proposal-posted-when-guard-should-block.test.ts
```

**Template:**
```typescript
// regression test template
describe('Regression: [brief description of bug]', () => {
  it('[what should happen that previously did not]', async () => {
    // Reproduce the exact conditions that caused the bug
    // Assert the correct behaviour
  });
});
```

---

### 6. Code Quality (Static Analysis)

**ESLint** — catches JavaScript/TypeScript errors and enforces style.

```json
// .eslintrc.json key rules
{
  "rules": {
    "no-console": "error",              // Use logger (Pino), not console
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": "error",
    "import/order": "error",            // Consistent import ordering
    "prefer-const": "error"
  }
}
```

**Prettier** — enforces consistent code formatting.

**Husky + lint-staged** — runs lint and format checks before every commit:
```json
// package.json lint-staged config
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

---

### 7. Coverage Requirements

| Layer      | Target | Tool               |
|------------|--------|--------------------|
| Backend services | 85% | Vitest + c8 |
| Backend API routes | 90% | Vitest + c8 |
| Frontend components | 70% | Vitest + c8 |
| Overall project | 80% | Combined report |

CI will **fail** if coverage drops below these thresholds.

---

## Test Data Strategy

### Development
- `backend/prisma/seed.ts` — seeds realistic test data

### Integration Tests
- Each test suite creates its own data in a fresh test DB
- Cleanup in `afterEach` or `beforeEach`

### E2E Tests
- Uses a dedicated `.env.test` with a test database
- Seeded via `npm run db:seed:test` before E2E run

### Sensitive Data
- Never use real GitHub tokens, real emails, or real API keys in tests
- Use `vitest-mock-extended` for service mocks
- Use `msw` for HTTP-level mocking of GitHub API responses

---

## Running Tests in CI

```yaml
# In CI, tests run in this order:
1. npm run lint              # Fast, fails early
2. npm run typecheck         # Type safety
3. npm run test:unit         # Fast (< 30s)
4. npm run test:api          # Medium (< 2 min)
5. npm run build             # Verify build succeeds
6. npm run test:e2e          # Slow — only on PRs to main
```

---

## Verification Checklist

Use this checklist to manually verify the application works end-to-end before a release:

```
□ Login with valid credentials succeeds
□ Login with invalid credentials shows error (not 500)
□ Adding a watched label appears in the list
□ Removing a watched label removes it from the list
□ Setting daily limit to 0 prevents email notifications
□ Issue poll runs and detected issues appear in dashboard
□ Email notification is received with correct clickable link
□ Daily limit is enforced (no email after limit reached)
□ Grace period prevents notification for issues < 24h old
□ Proposal is posted when Help Wanted label appears
□ Guard service blocks proposal when user has active assignment
□ Proposal monitor detects selection and updates status
□ Timeline comment is posted after selection
□ Health endpoint returns 200
□ Unauthenticated API requests return 401
□ Invalid JSON body returns 400 (not 500)
```
