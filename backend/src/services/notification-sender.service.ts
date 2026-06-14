import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { sendIssueNotification } from './email.service.js';

export class NotificationSenderService {
  static async send(): Promise<void> {
    const config = await prisma.config.findUnique({ where: { id: 'singleton' } });

    if (!config || !config.isRunning || !config.notificationEmail) return;

    // 1. Send initial PENDING notifications (no issue limit check — already counted at selection time)
    const pending = await prisma.notificationRecord.findMany({
      where: { status: 'PENDING', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    for (const record of pending) {
      try {
        await sendIssueNotification({
          to: config.notificationEmail,
          issueTitle: record.title,
          issueUrl: record.url,
          issueNumber: record.githubIssueNumber,
          matchedLabel: record.matchedLabel,
          repoFullName: record.repoFullName,
          isUpdate: false,
        });

        await prisma.notificationRecord.update({
          where: { id: record.id },
          data: {
            status: 'SENT',
            notifiedAt: new Date(),
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });

        logger.info({ issueNumber: record.githubIssueNumber }, 'Initial notification sent');
      } catch (err) {
        await prisma.notificationRecord.update({
          where: { id: record.id },
          data: {
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
        logger.error(err, `Failed to send notification for issue #${record.githubIssueNumber}, will retry in 20s`);
      }
    }

    // 2. Send update notifications for already-notified issues
    const pendingUpdates = await prisma.notificationRecord.findMany({
      where: { status: 'SENT', hasPendingUpdate: true, deletedAt: null },
      orderBy: { updatedAt: 'asc' },
    });

    for (const record of pendingUpdates) {
      const updateCount = record.updateEmailCount + 1;
      try {
        await sendIssueNotification({
          to: config.notificationEmail,
          issueTitle: record.title,
          issueUrl: record.url,
          issueNumber: record.githubIssueNumber,
          matchedLabel: record.matchedLabel,
          repoFullName: record.repoFullName,
          isUpdate: true,
          updateCount,
        });

        await prisma.notificationRecord.update({
          where: { id: record.id },
          data: {
            hasPendingUpdate: false,
            updateEmailCount: { increment: 1 },
            lastUpdateEmailAt: new Date(),
          },
        });

        logger.info({ issueNumber: record.githubIssueNumber, updateCount }, 'Update notification sent');
      } catch (err) {
        // hasPendingUpdate stays true — retried automatically on next 20s cycle
        logger.error(err, `Failed to send update notification for issue #${record.githubIssueNumber}, will retry in 20s`);
      }
    }
  }
}
