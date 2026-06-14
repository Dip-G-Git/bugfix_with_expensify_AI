import { Router } from 'express';
import { prisma } from '../db/client.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'not ready', db: 'disconnected' });
  }
});
