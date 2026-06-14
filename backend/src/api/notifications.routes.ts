import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

export const notificationsRouter = Router();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

// GET /api/notifications — list all notification records
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit, status, includeDeleted } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;

    const where = {
      ...(status ? { status } : {}),
      ...(!includeDeleted ? { deletedAt: null } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.notificationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notificationRecord.count({ where }),
    ]);

    res.json({
      data: records,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/:id — get single record
notificationsRouter.get('/:id', async (req, res, next) => {
  try {
    const record = await prisma.notificationRecord.findUnique({
      where: { id: req.params['id'] },
    });

    if (!record) {
      res.status(404).json({ error: 'Notification record not found' });
      return;
    }

    res.json({ data: record });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/:id — soft delete (sets deletedAt)
notificationsRouter.delete('/:id', async (req, res, next) => {
  try {
    const record = await prisma.notificationRecord.findUnique({
      where: { id: req.params['id'] },
    });

    if (!record) {
      res.status(404).json({ error: 'Notification record not found' });
      return;
    }

    if (record.deletedAt) {
      res.status(409).json({ error: 'Record is already soft-deleted' });
      return;
    }

    const updated = await prisma.notificationRecord.update({
      where: { id: req.params['id'] },
      data: { deletedAt: new Date() },
    });

    logger.info({ id: record.id, issueNumber: record.githubIssueNumber }, 'Soft deleted notification record');
    res.json({ data: updated, message: 'Record soft-deleted' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/:id/hard — permanent delete
notificationsRouter.delete('/:id/hard', async (req, res, next) => {
  try {
    const record = await prisma.notificationRecord.findUnique({
      where: { id: req.params['id'] },
    });

    if (!record) {
      res.status(404).json({ error: 'Notification record not found' });
      return;
    }

    await prisma.notificationRecord.delete({ where: { id: req.params['id'] } });

    logger.info({ id: record.id, issueNumber: record.githubIssueNumber }, 'Hard deleted notification record');
    res.json({ message: 'Record permanently deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/restore — restore a soft-deleted record
notificationsRouter.post('/:id/restore', async (req, res, next) => {
  try {
    const record = await prisma.notificationRecord.findUnique({
      where: { id: req.params['id'] },
    });

    if (!record) {
      res.status(404).json({ error: 'Notification record not found' });
      return;
    }

    if (!record.deletedAt) {
      res.status(409).json({ error: 'Record is not soft-deleted' });
      return;
    }

    const restored = await prisma.notificationRecord.update({
      where: { id: req.params['id'] },
      data: { deletedAt: null },
    });

    logger.info({ id: record.id, issueNumber: record.githubIssueNumber }, 'Restored notification record');
    res.json({ data: restored, message: 'Record restored' });
  } catch (err) {
    next(err);
  }
});
