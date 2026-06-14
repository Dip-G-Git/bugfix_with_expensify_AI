/**
 * Test fixtures using real Expensify/App issue data and event shapes.
 * Issue numbers, titles, and labels sourced from the public Expensify/App repo.
 */

const BASE_URL = 'https://github.com/Expensify/App/issues';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export const REAL_ISSUES = [
  {
    number: 47668,
    title: 'Fix accessibility issue in ExpensifyCard transaction form when using screen reader',
    html_url: `${BASE_URL}/47668`,
    labels: [{ name: 'Help Wanted' }, { name: 'Weekly' }],
    created_at: daysAgo(1),
  },
  {
    number: 47234,
    title: 'Update deprecated requestAnimationFrame usage in Animated components',
    html_url: `${BASE_URL}/47234`,
    labels: [{ name: 'Help Wanted' }, { name: 'Monthly' }],
    created_at: daysAgo(2),
  },
  {
    number: 46891,
    title: 'Fix incorrect total amount display when currency conversion is applied',
    html_url: `${BASE_URL}/46891`,
    labels: [{ name: 'Help Wanted' }],
    created_at: daysAgo(3),
  },
  {
    number: 46543,
    title: 'DistanceRequest component does not render map on Android 14',
    html_url: `${BASE_URL}/46543`,
    labels: [{ name: 'Help Wanted' }, { name: 'Bug' }],
    created_at: daysAgo(5),
  },
] as const;

export const STALE_ISSUE = {
  number: 44001,
  title: 'Old issue created more than 7 days ago',
  html_url: `${BASE_URL}/44001`,
  labels: [{ name: 'Help Wanted' }],
  created_at: daysAgo(10),
};

export const NON_HELP_WANTED_ISSUE = {
  number: 47999,
  title: 'Internal task: update CI pipeline configuration',
  html_url: `${BASE_URL}/47999`,
  labels: [{ name: 'Bug' }, { name: 'Internal' }],
  created_at: daysAgo(1),
};

/** Build a GitHub IssuesEvent payload */
export function makeIssueEvent(
  action: string,
  issue: {
    number: number;
    title: string;
    html_url: string;
    labels: Array<{ name?: string | null }>;
    created_at: string;
  }
) {
  return {
    type: 'IssuesEvent',
    payload: { action, issue },
  };
}

/** Build a 200 OK response from GitHub Events API */
export function makeEventsResponse(
  events: ReturnType<typeof makeIssueEvent>[],
  opts: { etag?: string; pollInterval?: number } = {}
) {
  return {
    status: 200,
    headers: {
      etag: opts.etag ?? '"abc123etag"',
      'x-poll-interval': String(opts.pollInterval ?? 60),
    },
    data: events,
  };
}

/** Default config returned by prisma mock */
export const DEFAULT_CONFIG = {
  id: 'singleton',
  notificationEmail: 'sandghos1987@gmail.com',
  watchedRepo: 'Expensify/App',
  watchedLabel: 'Help Wanted',
  issueLimit: 4,
  githubToken: null,
  lastEtag: null,
  pollIntervalSeconds: 60,
  dailySelectedCount: 0,
  dailyResetDate: new Date().toISOString().slice(0, 10),
  isRunning: true,
  updatedAt: new Date(),
};

/** Build a NotificationRecord from an issue */
export function makeNotificationRecord(
  issue: (typeof REAL_ISSUES)[number],
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `rec-${issue.number}`,
    githubIssueNumber: issue.number,
    title: issue.title,
    url: issue.html_url,
    repoFullName: 'Expensify/App',
    matchedLabel: 'Help Wanted',
    status: 'PENDING' as const,
    attempts: 0,
    lastAttemptAt: null,
    notifiedAt: null,
    hasPendingUpdate: false,
    updateEmailCount: 0,
    lastUpdateEmailAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
