import { describe, it, expect } from 'vitest';
import {
  assertCommentCountInRange,
  assertProposalIsDifferent,
  GuardViolationError,
  MIN_ISSUE_COMMENTS,
  MAX_ISSUE_COMMENTS,
  type IssueComment,
} from '../../../src/services/proposal-guards.service.js';

function makeComments(n: number): IssueComment[] {
  return Array.from({ length: n }, (_, i) => ({
    body: `comment ${i}`,
    user: { login: `user${i}` },
    html_url: `https://github.com/o/r/issues/1#c${i}`,
  }));
}

describe('assertCommentCountInRange', () => {
  it('accepts issues with 1 to 4 comments (inclusive bounds)', async () => {
    for (let n = MIN_ISSUE_COMMENTS; n <= MAX_ISSUE_COMMENTS; n++) {
      await expect(assertCommentCountInRange(makeComments(n))).resolves.toBeUndefined();
    }
  });

  it('rejects issues with zero comments', async () => {
    await expect(assertCommentCountInRange(makeComments(0))).rejects.toBeInstanceOf(
      GuardViolationError
    );
  });

  it('rejects issues with more than 4 comments', async () => {
    await expect(assertCommentCountInRange(makeComments(5))).rejects.toBeInstanceOf(
      GuardViolationError
    );
  });

  it('reports the actual count and bounds in the violation details', async () => {
    try {
      await assertCommentCountInRange(makeComments(7));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GuardViolationError);
      expect((err as GuardViolationError).details).toEqual({
        count: 7,
        min: MIN_ISSUE_COMMENTS,
        max: MAX_ISSUE_COMMENTS,
      });
    }
  });

  it('honours explicit custom bounds', async () => {
    await expect(assertCommentCountInRange(makeComments(6), 5, 10)).resolves.toBeUndefined();
    await expect(assertCommentCountInRange(makeComments(2), 5, 10)).rejects.toBeInstanceOf(
      GuardViolationError
    );
  });
});

describe('assertProposalIsDifferent', () => {
  const rootCauseSection = (text: string): IssueComment => ({
    body: `## Proposal\n### What is the root cause of that problem?\n${text}\n### What changes do you think we should make`,
    user: { login: 'someone' },
    html_url: 'https://github.com/o/r/issues/1#c',
  });

  it('blocks a near-duplicate root cause', async () => {
    const existing = rootCauseSection(
      'The submit button handler never debounces clicks so the request fires twice'
    );
    await expect(
      assertProposalIsDifferent(
        [existing],
        'The submit button handler never debounces clicks so the request fires twice rapidly'
      )
    ).rejects.toBeInstanceOf(GuardViolationError);
  });

  it('allows a clearly different root cause', async () => {
    const existing = rootCauseSection(
      'The submit button handler never debounces clicks so the request fires twice'
    );
    await expect(
      assertProposalIsDifferent(
        [existing],
        'Pagination offset is computed from the wrong page index causing skipped records'
      )
    ).resolves.toBeUndefined();
  });
});
