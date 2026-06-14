# Regression Tests

Each file in this directory corresponds to a specific bug that was found and fixed.
Every bug fix MUST include a regression test that would have caught the bug.

## Naming Convention

`issue-NNN-short-description.test.ts`

Where NNN is the GitHub issue number of the bug report.

## Template

```typescript
import { describe, it, expect } from 'vitest';

describe('Regression: [brief description of original bug]', () => {
  it('[what should happen that previously did not]', async () => {
    // 1. Reproduce the exact conditions that caused the bug
    // 2. Assert the correct behaviour

    // Example:
    // const result = await someService.doThing(edgeCaseInput);
    // expect(result).toBe(expectedCorrectValue);
  });
});
```
