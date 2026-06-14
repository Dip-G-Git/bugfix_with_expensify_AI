import { Octokit } from '@octokit/rest';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

interface IssuePayload {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  labels: Array<{ name?: string | null }>;
}

interface RepoEvent {
  type?: string | null;
  payload?: {
    action?: string;
    issue?: IssuePayload;
  };
}

const RECENTLY_CREATED_DAYS = 7;
const UPDATE_ACTIONS = new Set(['edited', 'reopened']);

function isRecentlyCreated(createdAt: string): boolean {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs <= RECENTLY_CREATED_DAYS * 24 * 60 * 60 * 1000;
}

export class EventsPollerService {
  static async poll(): Promise<number> {
    const config = await prisma.config.findUnique({ where: { id: 'singleton' } });

    if (!config) return 60;
    if (!config.isRunning) return config.pollIntervalSeconds;

    // Daily reset
    const today = new Date().toISOString().slice(0, 10);
    if (config.dailyResetDate !== today) {
      await prisma.config.update({
        where: { id: 'singleton' },
        data: { dailySelectedCount: 0, dailyResetDate: today },
      });
      config.dailySelectedCount = 0;
    }

    const parts = config.watchedRepo.split('/');
    if (parts.length !== 2) {
      logger.error({ watchedRepo: config.watchedRepo }, 'Invalid watchedRepo, expected owner/repo');
      return config.pollIntervalSeconds;
    }
    const [owner, repo] = parts as [string, string];

    const octokit = new Octokit({ auth: config.githubToken ?? undefined });

    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}/events', {
        owner,
        repo,
        per_page: 20,
        headers: config.lastEtag ? { 'If-None-Match': config.lastEtag } : {},
      });

      // 304 can come as a status field instead of throwing
      if ((response as { status?: number }).status === 304) {
        logger.debug('Events poll: 304 Not Modified');
        return config.pollIntervalSeconds;
      }

      const headers = response.headers as Record<string, string | undefined>;
      const newEtag = headers['etag'];
      const pollInterval = parseInt(headers['x-poll-interval'] ?? String(config.pollIntervalSeconds), 10);

      await prisma.config.update({
        where: { id: 'singleton' },
        data: {
          ...(newEtag ? { lastEtag: newEtag } : {}),
          pollIntervalSeconds: pollInterval,
        },
      });

      const events = (response.data ?? []) as RepoEvent[];
      const watchedLabelLower = config.watchedLabel.toLowerCase();
      let currentDailyCount = config.dailySelectedCount;

      for (const event of events) {
        if (event.type !== 'IssuesEvent' || !event.payload?.issue) continue;

        const { action, issue } = event.payload;
        if (!action || !issue) continue;

        // Skip issues not recently created (older than 7 days)
        if (!isRecentlyCreated(issue.created_at)) continue;

        const hasWatchedLabel = issue.labels?.some(
          (l) => (l.name ?? '').toLowerCase() === watchedLabelLower
        ) ?? false;

        // New issue selection: opened or labeled with watched label
        if ((action === 'opened' || action === 'labeled') && hasWatchedLabel) {
          const existing = await prisma.notificationRecord.findUnique({
            where: { githubIssueNumber: issue.number },
          });

          if (!existing) {
            if (currentDailyCount >= config.issueLimit) {
              logger.info({ issueNumber: issue.number }, 'Daily issue limit reached, skipping');
              continue;
            }

            await prisma.notificationRecord.create({
              data: {
                githubIssueNumber: issue.number,
                title: issue.title,
                url: issue.html_url,
                repoFullName: config.watchedRepo,
                matchedLabel: config.watchedLabel,
                status: 'PENDING',
              },
            });

            await prisma.config.update({
              where: { id: 'singleton' },
              data: { dailySelectedCount: { increment: 1 } },
            });

            currentDailyCount++;
            logger.info({ issueNumber: issue.number }, 'Issue selected for notification');
          }
        }

        // Update notification for already-selected issues
        if (UPDATE_ACTIONS.has(action ?? '')) {
          const existing = await prisma.notificationRecord.findUnique({
            where: { githubIssueNumber: issue.number },
          });

          if (existing && existing.status === 'SENT' && !existing.deletedAt && !existing.hasPendingUpdate) {
            await prisma.notificationRecord.update({
              where: { githubIssueNumber: issue.number },
              data: { hasPendingUpdate: true },
            });
            logger.info({ issueNumber: issue.number, action }, 'Update queued for notification');
          }
        }
      }

      return pollInterval;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 304) {
        logger.debug('Events poll: 304 Not Modified (via error)');
        return config.pollIntervalSeconds;
      }
      if (status === 403) {
        logger.warn('Events poll: rate limited, backing off 120s');
        return 120;
      }
      logger.error(err, 'Events poll failed');
      return config.pollIntervalSeconds;
    }
  }
}
