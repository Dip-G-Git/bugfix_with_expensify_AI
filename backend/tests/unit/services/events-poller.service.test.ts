import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_CONFIG,
  REAL_ISSUES,
  STALE_ISSUE,
  NON_HELP_WANTED_ISSUE,
  makeIssueEvent,
  makeEventsResponse,
  makeNotificationRecord,
} from '../../fixtures/github-events.js';

// --- Prisma mock (hoisted so it's available in vi.mock factory) ---
const mockPrisma = vi.hoisted(() => ({
  config: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  notificationRecord: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../../src/db/client.js', () => ({ prisma: mockPrisma }));

// --- Octokit mock ---
const mockRequest = vi.hoisted(() => vi.fn());

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({ request: mockRequest })),
}));

// Logger silenced for unit tests
vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { EventsPollerService } from '../../../src/services/events-poller.service.js';

describe('EventsPollerService.poll()', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: config exists, is running, no existing records
    mockPrisma.config.findUnique.mockResolvedValue({ ...DEFAULT_CONFIG });
    mockPrisma.config.update.mockResolvedValue({ ...DEFAULT_CONFIG });
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(null);
    mockPrisma.notificationRecord.create.mockResolvedValue(makeNotificationRecord(REAL_ISSUES[0]));
    mockPrisma.notificationRecord.update.mockResolvedValue(makeNotificationRecord(REAL_ISSUES[0]));

    // Default GitHub response: 1 new opened issue with Help Wanted label
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('opened', { ...REAL_ISSUES[0] })])
    );
  });

  // ─── Config state checks ──────────────────────────────────────────────────

  it('returns 60 when config row does not exist', async () => {
    mockPrisma.config.findUnique.mockResolvedValue(null);
    const result = await EventsPollerService.poll();
    expect(result).toBe(60);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns pollIntervalSeconds and skips polling when !isRunning', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({ ...DEFAULT_CONFIG, isRunning: false, pollIntervalSeconds: 90 });
    const result = await EventsPollerService.poll();
    expect(result).toBe(90);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // ─── Daily reset ──────────────────────────────────────────────────────────

  it('resets dailySelectedCount when dailyResetDate is a past date', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({
      ...DEFAULT_CONFIG,
      dailySelectedCount: 3,
      dailyResetDate: '2026-06-12',
    });
    mockRequest.mockResolvedValue(makeEventsResponse([]));

    await EventsPollerService.poll();

    const resetCall = mockPrisma.config.update.mock.calls.find(
      (c) => c[0].data.dailySelectedCount === 0
    );
    expect(resetCall).toBeDefined();
  });

  it('does NOT reset count when dailyResetDate equals today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockPrisma.config.findUnique.mockResolvedValue({
      ...DEFAULT_CONFIG,
      dailySelectedCount: 2,
      dailyResetDate: today,
    });
    mockRequest.mockResolvedValue(makeEventsResponse([]));

    await EventsPollerService.poll();

    const resetCall = mockPrisma.config.update.mock.calls.find(
      (c) => c[0].data.dailySelectedCount === 0
    );
    expect(resetCall).toBeUndefined();
  });

  // ─── Repo format validation ───────────────────────────────────────────────

  it('returns pollIntervalSeconds for invalid watchedRepo format', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({
      ...DEFAULT_CONFIG,
      watchedRepo: 'InvalidFormat',
      pollIntervalSeconds: 75,
    });
    const result = await EventsPollerService.poll();
    expect(result).toBe(75);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // ─── HTTP response handling ───────────────────────────────────────────────

  it('returns pollIntervalSeconds on 304 status in response object', async () => {
    mockRequest.mockResolvedValue({ status: 304, headers: {}, data: [] });
    const result = await EventsPollerService.poll();
    expect(result).toBe(DEFAULT_CONFIG.pollIntervalSeconds);
    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('returns pollIntervalSeconds on 304 thrown as error', async () => {
    mockRequest.mockRejectedValue({ status: 304 });
    const result = await EventsPollerService.poll();
    expect(result).toBe(DEFAULT_CONFIG.pollIntervalSeconds);
  });

  it('returns 120 on 403 rate-limit error', async () => {
    mockRequest.mockRejectedValue({ status: 403 });
    const result = await EventsPollerService.poll();
    expect(result).toBe(120);
    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('returns pollIntervalSeconds on unexpected error', async () => {
    mockRequest.mockRejectedValue(new Error('network error'));
    const result = await EventsPollerService.poll();
    expect(result).toBe(DEFAULT_CONFIG.pollIntervalSeconds);
  });

  // ─── ETag + X-Poll-Interval ───────────────────────────────────────────────

  it('saves new ETag and pollIntervalSeconds from response headers', async () => {
    mockRequest.mockResolvedValue(
      makeEventsResponse([], { etag: '"new-etag-xyz"', pollInterval: 90 })
    );

    const result = await EventsPollerService.poll();

    const updateCall = mockPrisma.config.update.mock.calls.find(
      (c) => c[0].data.lastEtag === '"new-etag-xyz"'
    );
    expect(updateCall).toBeDefined();
    expect(result).toBe(90);
  });

  it('sends If-None-Match header when lastEtag is set', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({ ...DEFAULT_CONFIG, lastEtag: '"saved-etag"' });
    mockRequest.mockResolvedValue(makeEventsResponse([]));

    await EventsPollerService.poll();

    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/events',
      expect.objectContaining({
        headers: { 'If-None-Match': '"saved-etag"' },
      })
    );
  });

  it('sends empty headers when no ETag is saved', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({ ...DEFAULT_CONFIG, lastEtag: null });
    mockRequest.mockResolvedValue(makeEventsResponse([]));

    await EventsPollerService.poll();

    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/events',
      expect.objectContaining({ headers: {} })
    );
  });

  // ─── New issue selection — opened ────────────────────────────────────────

  it('creates a NotificationRecord for a new opened issue with watched label', async () => {
    const issue = { ...REAL_ISSUES[0] };
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('opened', issue)]));

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          githubIssueNumber: issue.number,
          title: issue.title,
          url: issue.html_url,
          status: 'PENDING',
        }),
      })
    );
  });

  it('creates a NotificationRecord for a "labeled" event with watched label', async () => {
    const issue = { ...REAL_ISSUES[1] };
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('labeled', issue)]));

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ githubIssueNumber: issue.number }),
      })
    );
  });

  it('increments dailySelectedCount in Config after creating a record', async () => {
    const issue = { ...REAL_ISSUES[0] };
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('opened', issue)]));

    await EventsPollerService.poll();

    const incrementCall = mockPrisma.config.update.mock.calls.find(
      (c) => c[0].data.dailySelectedCount?.increment === 1
    );
    expect(incrementCall).toBeDefined();
  });

  it('does NOT create record when issue already exists in DB', async () => {
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(
      makeNotificationRecord(REAL_ISSUES[0])
    );
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('opened', { ...REAL_ISSUES[0] })]));

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('does NOT create record when issue has no watched label', async () => {
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('opened', { ...NON_HELP_WANTED_ISSUE })])
    );

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('uses case-insensitive label matching', async () => {
    const issueWithUpperLabel = {
      ...REAL_ISSUES[0],
      labels: [{ name: 'HELP WANTED' }],
    };
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('opened', issueWithUpperLabel)])
    );

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).toHaveBeenCalled();
  });

  it('skips issue older than 7 days (recently-created filter)', async () => {
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('opened', { ...STALE_ISSUE })])
    );

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('skips new issue when daily limit is already reached', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({
      ...DEFAULT_CONFIG,
      dailySelectedCount: 4,
      issueLimit: 4,
    });
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('opened', { ...REAL_ISSUES[0] })]));

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('selects up to the daily limit across multiple events', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({
      ...DEFAULT_CONFIG,
      dailySelectedCount: 3,
      issueLimit: 4,
    });

    const events = REAL_ISSUES.slice(0, 3).map((i) => makeIssueEvent('opened', { ...i }));
    mockRequest.mockResolvedValue(makeEventsResponse(events));

    // First findUnique call: null (not in DB); then limit is hit → rest skipped
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(null);

    await EventsPollerService.poll();

    // Only 1 record created (3 + 1 = 4 = limit)
    expect(mockPrisma.notificationRecord.create).toHaveBeenCalledTimes(1);
  });

  // ─── Update notifications ─────────────────────────────────────────────────

  it('sets hasPendingUpdate for an edited SENT issue', async () => {
    const issue = { ...REAL_ISSUES[0] };
    const existingRecord = makeNotificationRecord(issue, { status: 'SENT', hasPendingUpdate: false });
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(existingRecord);
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('edited', issue)]));

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubIssueNumber: issue.number },
        data: { hasPendingUpdate: true },
      })
    );
  });

  it('sets hasPendingUpdate for a reopened SENT issue', async () => {
    const issue = { ...REAL_ISSUES[1] };
    const existingRecord = makeNotificationRecord(issue, { status: 'SENT', hasPendingUpdate: false });
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(existingRecord);
    mockRequest.mockResolvedValue(makeEventsResponse([makeIssueEvent('reopened', issue)]));

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hasPendingUpdate: true } })
    );
  });

  it('does NOT set hasPendingUpdate when issue is not in DB', async () => {
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(null);
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('edited', { ...REAL_ISSUES[0] })])
    );

    await EventsPollerService.poll();

    const updateHasPendingUpdate = mockPrisma.notificationRecord.update.mock.calls.find(
      (c) => c[0].data.hasPendingUpdate === true
    );
    expect(updateHasPendingUpdate).toBeUndefined();
  });

  it('does NOT set hasPendingUpdate when record is still PENDING', async () => {
    const pendingRecord = makeNotificationRecord(REAL_ISSUES[0], { status: 'PENDING' });
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(pendingRecord);
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('edited', { ...REAL_ISSUES[0] })])
    );

    await EventsPollerService.poll();

    const updateHasPendingUpdate = mockPrisma.notificationRecord.update.mock.calls.find(
      (c) => c[0].data.hasPendingUpdate === true
    );
    expect(updateHasPendingUpdate).toBeUndefined();
  });

  it('does NOT set hasPendingUpdate when record is already soft-deleted', async () => {
    const deletedRecord = makeNotificationRecord(REAL_ISSUES[0], {
      status: 'SENT',
      deletedAt: new Date(),
    });
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(deletedRecord);
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('edited', { ...REAL_ISSUES[0] })])
    );

    await EventsPollerService.poll();

    const updateHasPendingUpdate = mockPrisma.notificationRecord.update.mock.calls.find(
      (c) => c[0].data.hasPendingUpdate === true
    );
    expect(updateHasPendingUpdate).toBeUndefined();
  });

  it('does NOT set hasPendingUpdate when hasPendingUpdate is already true', async () => {
    const record = makeNotificationRecord(REAL_ISSUES[0], {
      status: 'SENT',
      hasPendingUpdate: true,
    });
    mockPrisma.notificationRecord.findUnique.mockResolvedValue(record);
    mockRequest.mockResolvedValue(
      makeEventsResponse([makeIssueEvent('edited', { ...REAL_ISSUES[0] })])
    );

    await EventsPollerService.poll();

    const updateHasPendingUpdate = mockPrisma.notificationRecord.update.mock.calls.find(
      (c) => c[0].data.hasPendingUpdate === true
    );
    expect(updateHasPendingUpdate).toBeUndefined();
  });

  // ─── Non-IssuesEvent filtering ────────────────────────────────────────────

  it('ignores non-IssuesEvent event types', async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      headers: { etag: '"abc"', 'x-poll-interval': '60' },
      data: [
        { type: 'PushEvent', payload: { commits: [] } },
        { type: 'PullRequestEvent', payload: { action: 'opened' } },
        { type: 'WatchEvent', payload: { action: 'started' } },
      ],
    });

    await EventsPollerService.poll();

    expect(mockPrisma.notificationRecord.create).not.toHaveBeenCalled();
  });

  it('returns the parsed X-Poll-Interval value', async () => {
    mockRequest.mockResolvedValue(makeEventsResponse([], { pollInterval: 120 }));
    const result = await EventsPollerService.poll();
    expect(result).toBe(120);
  });

  it('uses per_page=20 in the API request', async () => {
    mockRequest.mockResolvedValue(makeEventsResponse([]));
    await EventsPollerService.poll();
    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/events',
      expect.objectContaining({ per_page: 20 })
    );
  });

  it('parses owner and repo correctly from watchedRepo', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({
      ...DEFAULT_CONFIG,
      watchedRepo: 'microsoft/vscode',
    });
    mockRequest.mockResolvedValue(makeEventsResponse([]));

    await EventsPollerService.poll();

    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/events',
      expect.objectContaining({ owner: 'microsoft', repo: 'vscode' })
    );
  });
});
