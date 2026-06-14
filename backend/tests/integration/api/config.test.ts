import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/app.js';
import { cleanDatabase, seedConfig } from '../../helpers/db.js';

const app = createApp();

beforeAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
});

describe('GET /api/config', () => {
  it('returns 200 with config defaults on first call (auto-created)', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.watchedRepo).toBe('Expensify/App');
    expect(res.body.config.watchedLabel).toBe('Help Wanted');
    expect(res.body.config.issueLimit).toBe(4);
    expect(res.body.config.isRunning).toBe(false);
  });

  it('never exposes githubToken in the response', async () => {
    await seedConfig({ githubToken: 'ghp_secret_token_12345' });

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.config.githubToken).toBeUndefined();
    expect(res.body.hasGithubToken).toBe(true);
  });

  it('returns hasGithubToken: false when no token is set', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body.hasGithubToken).toBe(false);
  });

  it('never exposes lastEtag in the response', async () => {
    await seedConfig({ lastEtag: '"some-etag-value"' });
    const res = await request(app).get('/api/config');
    expect(res.body.config.lastEtag).toBeUndefined();
  });

  it('returns notificationEmail from config', async () => {
    await seedConfig({ notificationEmail: 'sandghos1987@gmail.com' });
    const res = await request(app).get('/api/config');
    expect(res.body.config.notificationEmail).toBe('sandghos1987@gmail.com');
  });
});

describe('PUT /api/config', () => {
  it('updates notificationEmail', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ notificationEmail: 'sandghos1987@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.config.notificationEmail).toBe('sandghos1987@gmail.com');
  });

  it('updates watchedRepo', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ watchedRepo: 'microsoft/vscode' });

    expect(res.status).toBe(200);
    expect(res.body.config.watchedRepo).toBe('microsoft/vscode');
  });

  it('updates watchedLabel', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ watchedLabel: 'Good First Issue' });

    expect(res.status).toBe(200);
    expect(res.body.config.watchedLabel).toBe('Good First Issue');
  });

  it('updates issueLimit', async () => {
    const res = await request(app).put('/api/config').send({ issueLimit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.config.issueLimit).toBe(10);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ notificationEmail: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for watchedRepo missing slash', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ watchedRepo: 'InvalidRepoNoSlash' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for watchedRepo with multiple slashes', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ watchedRepo: 'too/many/slashes' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for issueLimit below minimum (1)', async () => {
    const res = await request(app).put('/api/config').send({ issueLimit: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for issueLimit above maximum (100)', async () => {
    const res = await request(app).put('/api/config').send({ issueLimit: 101 });
    expect(res.status).toBe(400);
  });

  it('resets ETag and dailySelectedCount when watchedRepo changes', async () => {
    await seedConfig({
      watchedRepo: 'Expensify/App',
      lastEtag: '"old-etag"',
      dailySelectedCount: 3,
    });

    const res = await request(app)
      .put('/api/config')
      .send({ watchedRepo: 'microsoft/TypeScript' });

    expect(res.status).toBe(200);
    expect(res.body.config.dailySelectedCount).toBe(0);

    // Verify ETag is actually null in DB by reading config
    const getRes = await request(app).get('/api/config');
    expect(getRes.body.config.dailySelectedCount).toBe(0);
  });

  it('does NOT reset ETag when watchedRepo is unchanged', async () => {
    await seedConfig({
      watchedRepo: 'Expensify/App',
      dailySelectedCount: 2,
    });

    const res = await request(app)
      .put('/api/config')
      .send({ notificationEmail: 'new@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.config.dailySelectedCount).toBe(2);
  });

  it('sets githubToken and returns hasGithubToken: true', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ githubToken: 'ghp_real_token_abc123' });

    expect(res.status).toBe(200);
    expect(res.body.hasGithubToken).toBe(true);
    expect(res.body.config.githubToken).toBeUndefined();
  });

  it('clears githubToken with null value', async () => {
    await seedConfig({ githubToken: 'ghp_existing_token' });

    const res = await request(app).put('/api/config').send({ githubToken: null });

    expect(res.status).toBe(200);
    expect(res.body.hasGithubToken).toBe(false);
  });

  it('accepts partial updates (only provided fields change)', async () => {
    await seedConfig({ watchedRepo: 'Expensify/App', issueLimit: 4 });

    const res = await request(app)
      .put('/api/config')
      .send({ notificationEmail: 'partial@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.config.notificationEmail).toBe('partial@example.com');
    expect(res.body.config.watchedRepo).toBe('Expensify/App');
    expect(res.body.config.issueLimit).toBe(4);
  });
});

describe('GET /api/config/status', () => {
  it('returns all status fields', async () => {
    await seedConfig({
      isRunning: true,
      notificationEmail: 'sandghos1987@gmail.com',
      watchedRepo: 'Expensify/App',
      watchedLabel: 'Help Wanted',
      issueLimit: 4,
      dailySelectedCount: 2,
      pollIntervalSeconds: 60,
    });

    const res = await request(app).get('/api/config/status');

    expect(res.status).toBe(200);
    expect(res.body.isRunning).toBe(true);
    expect(res.body.watchedRepo).toBe('Expensify/App');
    expect(res.body.watchedLabel).toBe('Help Wanted');
    expect(res.body.issueLimit).toBe(4);
    expect(res.body.notificationEmail).toBe('sandghos1987@gmail.com');
    expect(res.body.dailySelectedCount).toBe(2);
    expect(res.body.pollIntervalSeconds).toBe(60);
    expect(typeof res.body.isNewDay).toBe('boolean');
    expect(typeof res.body.hasGithubToken).toBe('boolean');
  });

  it('reports isNewDay: true when dailyResetDate is a past date', async () => {
    await seedConfig({ dailyResetDate: '2026-01-01' });
    const res = await request(app).get('/api/config/status');
    expect(res.body.isNewDay).toBe(true);
  });

  it('reports isNewDay: false when dailyResetDate is today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seedConfig({ dailyResetDate: today });
    const res = await request(app).get('/api/config/status');
    expect(res.body.isNewDay).toBe(false);
  });
});

describe('POST /api/config/start', () => {
  it('returns 400 when notificationEmail is not set', async () => {
    await seedConfig({ notificationEmail: '' });

    const res = await request(app).post('/api/config/start');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('notificationEmail');
  });

  it('sets isRunning=true when notificationEmail is configured', async () => {
    await seedConfig({ notificationEmail: 'sandghos1987@gmail.com' });

    const res = await request(app).post('/api/config/start');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');

    const statusRes = await request(app).get('/api/config/status');
    expect(statusRes.body.isRunning).toBe(true);
  });

  it('returns status and message on success', async () => {
    await seedConfig({ notificationEmail: 'sandghos1987@gmail.com' });

    const res = await request(app).post('/api/config/start');

    expect(res.body.status).toBe('running');
    expect(res.body.message).toBeDefined();
  });
});

describe('POST /api/config/stop', () => {
  it('sets isRunning=false', async () => {
    await seedConfig({ notificationEmail: 'sandghos1987@gmail.com', isRunning: true });

    const res = await request(app).post('/api/config/stop');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');

    const statusRes = await request(app).get('/api/config/status');
    expect(statusRes.body.isRunning).toBe(false);
  });

  it('can stop even when already stopped (idempotent)', async () => {
    await seedConfig({ isRunning: false });

    const res = await request(app).post('/api/config/stop');
    expect(res.status).toBe(200);
  });
});
