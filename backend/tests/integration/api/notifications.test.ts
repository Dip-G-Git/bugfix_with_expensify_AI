import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/app.js';
import { cleanDatabase, seedConfig, seedNotification } from '../../helpers/db.js';
import { prisma } from '../../../src/db/client.js';

const app = createApp();

beforeAll(async () => {
  await cleanDatabase();
  await seedConfig();
});

beforeEach(async () => {
  await prisma.notificationRecord.deleteMany();
});

describe('GET /api/notifications', () => {
  it('returns empty list when no records exist', async () => {
    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('returns all non-deleted records', async () => {
    await seedNotification({ status: 'PENDING' });
    await seedNotification({ status: 'SENT' });
    await seedNotification({ status: 'SENT' });

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination.total).toBe(3);
  });

  it('excludes soft-deleted records by default', async () => {
    await seedNotification({ status: 'SENT' });
    await seedNotification({ status: 'SENT', deletedAt: new Date() });

    const res = await request(app).get('/api/notifications');

    expect(res.body.data).toHaveLength(1);
  });

  it('includes soft-deleted records when includeDeleted=true', async () => {
    await seedNotification({ status: 'SENT' });
    await seedNotification({ status: 'SENT', deletedAt: new Date() });

    const res = await request(app).get('/api/notifications?includeDeleted=true');

    expect(res.body.data).toHaveLength(2);
  });

  it('filters by status=SENT', async () => {
    await seedNotification({ status: 'PENDING' });
    await seedNotification({ status: 'SENT' });
    await seedNotification({ status: 'SENT' });

    const res = await request(app).get('/api/notifications?status=SENT');

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r: { status: string }) => r.status === 'SENT')).toBe(true);
  });

  it('filters by status=PENDING', async () => {
    await seedNotification({ status: 'PENDING' });
    await seedNotification({ status: 'PENDING' });
    await seedNotification({ status: 'SENT' });

    const res = await request(app).get('/api/notifications?status=PENDING');

    expect(res.body.data).toHaveLength(2);
  });

  it('paginates results with page and limit', async () => {
    for (let i = 0; i < 5; i++) await seedNotification({ status: 'SENT' });

    const res = await request(app).get('/api/notifications?page=1&limit=2');

    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.pages).toBe(3);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.page).toBe(1);
  });

  it('returns correct page 2', async () => {
    for (let i = 0; i < 5; i++) await seedNotification({ status: 'SENT' });

    const page1 = await request(app).get('/api/notifications?page=1&limit=2');
    const page2 = await request(app).get('/api/notifications?page=2&limit=2');

    const ids1 = page1.body.data.map((r: { id: string }) => r.id);
    const ids2 = page2.body.data.map((r: { id: string }) => r.id);

    // Pages should have different records
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it('records include all expected fields', async () => {
    const rec = await seedNotification({ status: 'SENT', title: 'Test Issue' });

    const res = await request(app).get('/api/notifications');
    const record = res.body.data[0];

    expect(record.id).toBe(rec.id);
    expect(record.title).toBe('Test Issue');
    expect(record.githubIssueNumber).toBe(rec.githubIssueNumber);
    expect(record.status).toBe('SENT');
    expect(record.repoFullName).toBeDefined();
    expect(record.matchedLabel).toBeDefined();
  });
});

describe('GET /api/notifications/:id', () => {
  it('returns single record by ID', async () => {
    const rec = await seedNotification({ status: 'SENT', title: 'Expensify Issue' });

    const res = await request(app).get(`/api/notifications/${rec.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(rec.id);
    expect(res.body.data.title).toBe('Expensify Issue');
  });

  it('returns 404 for non-existent ID', async () => {
    const res = await request(app).get('/api/notifications/non-existent-id-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('DELETE /api/notifications/:id (soft delete)', () => {
  it('soft-deletes a record by setting deletedAt', async () => {
    const rec = await seedNotification({ status: 'SENT' });

    const res = await request(app).delete(`/api/notifications/${rec.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).not.toBeNull();
    expect(res.body.message).toContain('soft-deleted');
  });

  it('returns 404 for non-existent ID', async () => {
    const res = await request(app).delete('/api/notifications/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 409 when trying to soft-delete an already-deleted record', async () => {
    const rec = await seedNotification({ status: 'SENT', deletedAt: new Date() });

    const res = await request(app).delete(`/api/notifications/${rec.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already soft-deleted');
  });

  it('soft-deleted record no longer appears in default list', async () => {
    const rec = await seedNotification({ status: 'SENT' });
    await request(app).delete(`/api/notifications/${rec.id}`);

    const listRes = await request(app).get('/api/notifications');
    const found = listRes.body.data.find((r: { id: string }) => r.id === rec.id);
    expect(found).toBeUndefined();
  });

  it('soft-deleted record appears when includeDeleted=true', async () => {
    const rec = await seedNotification({ status: 'SENT' });
    await request(app).delete(`/api/notifications/${rec.id}`);

    const listRes = await request(app).get('/api/notifications?includeDeleted=true');
    const found = listRes.body.data.find((r: { id: string }) => r.id === rec.id);
    expect(found).toBeDefined();
  });
});

describe('DELETE /api/notifications/:id/hard', () => {
  it('permanently deletes a record', async () => {
    const rec = await seedNotification({ status: 'SENT' });

    const res = await request(app).delete(`/api/notifications/${rec.id}/hard`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('permanently deleted');
  });

  it('record is gone after hard delete — GET returns 404', async () => {
    const rec = await seedNotification({ status: 'SENT' });
    await request(app).delete(`/api/notifications/${rec.id}/hard`);

    const getRes = await request(app).get(`/api/notifications/${rec.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for non-existent ID on hard delete', async () => {
    const res = await request(app).delete('/api/notifications/ghost-id/hard');
    expect(res.status).toBe(404);
  });

  it('can hard delete a soft-deleted record', async () => {
    const rec = await seedNotification({ status: 'SENT', deletedAt: new Date() });

    const res = await request(app).delete(`/api/notifications/${rec.id}/hard`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/notifications/:id/restore', () => {
  it('restores a soft-deleted record by clearing deletedAt', async () => {
    const rec = await seedNotification({ status: 'SENT', deletedAt: new Date() });

    const res = await request(app).post(`/api/notifications/${rec.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).toBeNull();
    expect(res.body.message).toContain('restored');
  });

  it('restored record appears in default list again', async () => {
    const rec = await seedNotification({ status: 'SENT', deletedAt: new Date() });
    await request(app).post(`/api/notifications/${rec.id}/restore`);

    const listRes = await request(app).get('/api/notifications');
    const found = listRes.body.data.find((r: { id: string }) => r.id === rec.id);
    expect(found).toBeDefined();
  });

  it('returns 409 when record is not soft-deleted', async () => {
    const rec = await seedNotification({ status: 'SENT' });

    const res = await request(app).post(`/api/notifications/${rec.id}/restore`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('not soft-deleted');
  });

  it('returns 404 for non-existent ID on restore', async () => {
    const res = await request(app).post('/api/notifications/no-such-id/restore');
    expect(res.status).toBe(404);
  });
});

describe('Notification record lifecycle (end-to-end)', () => {
  it('PENDING → soft-delete → restore → hard-delete flow', async () => {
    // Create a PENDING record
    const rec = await seedNotification({ status: 'PENDING' });

    // Appears in default list
    let listRes = await request(app).get('/api/notifications');
    expect(listRes.body.data.some((r: { id: string }) => r.id === rec.id)).toBe(true);

    // Soft delete
    let res = await request(app).delete(`/api/notifications/${rec.id}`);
    expect(res.status).toBe(200);

    // No longer in default list
    listRes = await request(app).get('/api/notifications');
    expect(listRes.body.data.some((r: { id: string }) => r.id === rec.id)).toBe(false);

    // Restore
    res = await request(app).post(`/api/notifications/${rec.id}/restore`);
    expect(res.status).toBe(200);

    // Back in default list
    listRes = await request(app).get('/api/notifications');
    expect(listRes.body.data.some((r: { id: string }) => r.id === rec.id)).toBe(true);

    // Hard delete
    res = await request(app).delete(`/api/notifications/${rec.id}/hard`);
    expect(res.status).toBe(200);

    // Gone permanently
    const getRes = await request(app).get(`/api/notifications/${rec.id}`);
    expect(getRes.status).toBe(404);
  });
});
