import { afterEach, vi } from 'vitest';

// Set test environment variables BEFORE any module imports happen
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'file:./test.db';
process.env['PORT'] = '3002';
process.env['SMTP_HOST'] = 'smtp.ethereal.email';
process.env['SMTP_PORT'] = '587';
process.env['SMTP_SECURE'] = 'false';
process.env['SMTP_USER'] = 'notifier@example.com';
process.env['SMTP_PASS'] = 'test-password-123';
process.env['CORS_ORIGIN'] = '*';

afterEach(() => {
  vi.clearAllMocks();
});
