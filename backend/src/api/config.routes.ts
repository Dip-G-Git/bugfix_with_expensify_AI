import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { logger } from '../utils/logger.js';

export const configRouter = Router();

const DEFAULT_CONFIG = {
  id: 'singleton',
  notificationEmail: '',
  watchedRepo: 'Expensify/App',
  watchedLabel: 'Help Wanted',
  issueLimit: 4,
  githubToken: null,
  lastEtag: null,
  pollIntervalSeconds: 60,
  dailySelectedCount: 0,
  dailyResetDate: '',
  isRunning: false,
};

async function getOrCreateConfig() {
  return prisma.config.upsert({
    where: { id: 'singleton' },
    create: DEFAULT_CONFIG,
    update: {},
  });
}

// GET /api/config
configRouter.get('/', async (_req, res, next) => {
  try {
    const config = await getOrCreateConfig();
    const { githubToken: _token, lastEtag: _etag, ...safe } = config;
    res.json({ config: safe, hasGithubToken: !!config.githubToken });
  } catch (err) {
    next(err);
  }
});

const updateConfigSchema = z.object({
  notificationEmail: z.string().email().optional(),
  watchedRepo: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format')
    .optional(),
  watchedLabel: z.string().min(1).optional(),
  issueLimit: z.coerce.number().int().min(1).max(100).optional(),
  githubToken: z.string().min(1).nullable().optional(),
});

// PUT /api/config
configRouter.put('/', async (req, res, next) => {
  try {
    const body = updateConfigSchema.parse(req.body);
    const current = await getOrCreateConfig();
    const repoChanged = body.watchedRepo && body.watchedRepo !== current.watchedRepo;

    const updated = await prisma.config.upsert({
      where: { id: 'singleton' },
      create: { ...DEFAULT_CONFIG, ...body },
      update: {
        ...body,
        ...(repoChanged ? { lastEtag: null, dailySelectedCount: 0, dailyResetDate: '' } : {}),
      },
    });

    const { githubToken: _token, lastEtag: _etag, ...safe } = updated;
    logger.info('Config updated');
    res.json({ config: safe, hasGithubToken: !!updated.githubToken });
  } catch (err) {
    next(err);
  }
});

// GET /api/config/status
configRouter.get('/status', async (_req, res, next) => {
  try {
    const config = await getOrCreateConfig();
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      isRunning: config.isRunning,
      watchedRepo: config.watchedRepo,
      watchedLabel: config.watchedLabel,
      issueLimit: config.issueLimit,
      notificationEmail: config.notificationEmail,
      dailySelectedCount: config.dailySelectedCount,
      isNewDay: config.dailyResetDate !== today,
      pollIntervalSeconds: config.pollIntervalSeconds,
      hasGithubToken: !!config.githubToken,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/config/start
configRouter.post('/start', async (_req, res, next) => {
  try {
    const config = await getOrCreateConfig();

    if (!config.notificationEmail) {
      res.status(400).json({ error: 'notificationEmail must be set before starting' });
      return;
    }

    await prisma.config.update({ where: { id: 'singleton' }, data: { isRunning: true } });
    logger.info('Notification service started');
    res.json({ status: 'running', message: 'Notification service started' });
  } catch (err) {
    next(err);
  }
});

// POST /api/config/stop
configRouter.post('/stop', async (_req, res, next) => {
  try {
    await prisma.config.update({ where: { id: 'singleton' }, data: { isRunning: false } });
    logger.info('Notification service stopped');
    res.json({ status: 'stopped', message: 'Notification service stopped' });
  } catch (err) {
    next(err);
  }
});
