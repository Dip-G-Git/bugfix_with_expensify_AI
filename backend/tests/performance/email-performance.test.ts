/**
 * Performance benchmarks for email notification throughput.
 *
 * Uses mocked SMTP (no real network calls) to measure pure application
 * overhead: DB reads, service orchestration, and record update latency.
 *
 * Run with: npm run test:performance
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_CONFIG, REAL_ISSUES, makeNotificationRecord } from '../fixtures/github-events.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  config: { findUnique: vi.fn() },
  notificationRecord: { findMany: vi.fn(), update: vi.fn() },
}));

vi.mock('../../src/db/client.js', () => ({ prisma: mockPrisma }));

const mockSendIssueNotification = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/services/email.service.js', () => ({
  sendIssueNotification: mockSendIssueNotification,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { NotificationSenderService } from '../../src/services/notification-sender.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RUNNING_CONFIG = {
  ...DEFAULT_CONFIG,
  isRunning: true,
  notificationEmail: 'sandghos1987@gmail.com',
};

function buildPendingRecords(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const issue = REAL_ISSUES[i % REAL_ISSUES.length];
    return makeNotificationRecord(issue, {
      id: `perf-rec-${i}`,
      githubIssueNumber: issue.number + i * 1000,
    });
  });
}

async function runWithTiming(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationSenderService performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.config.findUnique.mockResolvedValue(RUNNING_CONFIG);
    mockPrisma.notificationRecord.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('processes 1 PENDING record in < 50ms', async () => {
    const records = buildPendingRecords(1);
    mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'PENDING' ? records : [])
    );

    const duration = await runWithTiming(() => NotificationSenderService.send());

    expect(duration).toBeLessThan(50);
    expect(mockSendIssueNotification).toHaveBeenCalledTimes(1);
  });

  it('processes 10 PENDING records in < 200ms', async () => {
    const records = buildPendingRecords(10);
    mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'PENDING' ? records : [])
    );

    const duration = await runWithTiming(() => NotificationSenderService.send());

    expect(duration).toBeLessThan(200);
    expect(mockSendIssueNotification).toHaveBeenCalledTimes(10);
    expect(mockPrisma.notificationRecord.update).toHaveBeenCalledTimes(10);
  });

  it('processes 50 PENDING records in < 500ms', async () => {
    const records = buildPendingRecords(50);
    mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'PENDING' ? records : [])
    );

    const duration = await runWithTiming(() => NotificationSenderService.send());

    expect(duration).toBeLessThan(500);
    expect(mockSendIssueNotification).toHaveBeenCalledTimes(50);
  });

  it('processes 4 update emails in < 100ms', async () => {
    const records = buildPendingRecords(4).map((r) => ({
      ...r,
      status: 'SENT' as const,
      hasPendingUpdate: true,
      updateEmailCount: 0,
    }));

    mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'SENT' && where.hasPendingUpdate ? records : [])
    );

    const duration = await runWithTiming(() => NotificationSenderService.send());

    expect(duration).toBeLessThan(100);
    expect(mockSendIssueNotification).toHaveBeenCalledTimes(4);
  });

  it('throughput: measures emails/second rate', async () => {
    const COUNT = 20;
    const records = buildPendingRecords(COUNT);
    mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'PENDING' ? records : [])
    );

    const durationMs = await runWithTiming(() => NotificationSenderService.send());
    const durationSec = durationMs / 1000;
    const throughput = COUNT / durationSec;

    console.log(`[perf] ${COUNT} emails in ${durationMs.toFixed(1)}ms → ${throughput.toFixed(0)} emails/sec`);

    // With mocked SMTP, throughput should be > 100 emails/sec
    expect(throughput).toBeGreaterThan(100);
  });

  it('handles 0 records with near-zero overhead', async () => {
    mockPrisma.notificationRecord.findMany.mockResolvedValue([]);

    const duration = await runWithTiming(() => NotificationSenderService.send());

    // Just config read + 2 empty findMany calls — should be very fast
    expect(duration).toBeLessThan(20);
    expect(mockSendIssueNotification).not.toHaveBeenCalled();
  });

  it('measures single-send latency (p99 baseline)', async () => {
    const RUNS = 10;
    const latencies: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      vi.clearAllMocks();
      mockPrisma.config.findUnique.mockResolvedValue(RUNNING_CONFIG);
      mockPrisma.notificationRecord.update.mockResolvedValue({});

      const records = [buildPendingRecords(1)[0]];
      mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.status === 'PENDING' ? records : [])
      );

      const ms = await runWithTiming(() => NotificationSenderService.send());
      latencies.push(ms);
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(RUNS * 0.5)];
    const p99 = sorted[Math.floor(RUNS * 0.99)] ?? sorted[sorted.length - 1];

    console.log(`[perf] single-send: p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms`);

    expect(p99).toBeLessThan(50);
  });

  it('passes when email fails — no performance regression on retry path', async () => {
    const records = buildPendingRecords(5);
    mockPrisma.notificationRecord.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.status === 'PENDING' ? records : [])
    );

    // All emails fail
    mockSendIssueNotification.mockRejectedValue(new Error('SMTP down'));

    const duration = await runWithTiming(() => NotificationSenderService.send());

    expect(duration).toBeLessThan(200);
    // DB updated for each failure (attempts++)
    expect(mockPrisma.notificationRecord.update).toHaveBeenCalledTimes(5);
  });
});
