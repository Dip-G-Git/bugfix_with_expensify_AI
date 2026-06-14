import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock prisma to simulate DB disconnection for the 503 path
const mockQueryRaw = vi.hoisted(() => vi.fn().mockResolvedValue([{ 1: 1 }]));

vi.mock('../../../src/db/client.js', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    config: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    notificationRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    $connect: vi.fn(),
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createApp } from '../../../src/app.js';

const app = createApp();

describe('GET /health/ready — error path', () => {
  it('returns 503 when DB query fails', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('SQLITE_CANTOPEN'));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not ready');
    expect(res.body.db).toBe('disconnected');
  });

  it('returns 200 when DB query succeeds', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ 1: 1 }]);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});
