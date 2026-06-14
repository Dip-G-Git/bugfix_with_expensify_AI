import { describe, it, expect } from 'vitest';
import { connectDatabase } from '../../../src/db/client.js';

describe('connectDatabase()', () => {
  it('resolves without throwing when database is accessible', async () => {
    await expect(connectDatabase()).resolves.not.toThrow();
  });
});
