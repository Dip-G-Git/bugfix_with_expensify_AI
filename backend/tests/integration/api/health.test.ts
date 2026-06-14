import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/app.js';

const app = createApp();

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('includes uptime as a number', async () => {
    const res = await request(app).get('/health');

    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThan(0);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when database is connected', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.db).toBe('connected');
  });
});

describe('404 handling', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns JSON body for 404', async () => {
    const res = await request(app).get('/unknown-path');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
