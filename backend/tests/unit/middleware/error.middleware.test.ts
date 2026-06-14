import { describe, it, expect, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { errorHandler } from '../../../src/middleware/error.middleware.js';
import { notFoundHandler } from '../../../src/middleware/not-found.middleware.js';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnThis();
  return { json, status } as unknown as Response;
}

const mockReq = {} as Request;
const mockNext = vi.fn() as NextFunction;

describe('errorHandler middleware', () => {
  it('returns 400 with field errors for ZodError', () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: 'not-an-email' });
    const zodErr = (result as { error: ZodError }).error;

    const res = makeRes();
    errorHandler(zodErr, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation error',
        details: expect.any(Object),
      })
    );
  });

  it('returns 500 for a regular Error', () => {
    const res = makeRes();
    errorHandler(new Error('Unexpected DB error'), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('returns 500 for a non-Error thrown value (string)', () => {
    const res = makeRes();
    errorHandler('some string error', mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('returns 500 for undefined error', () => {
    const res = makeRes();
    errorHandler(undefined, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('notFoundHandler middleware', () => {
  it('returns 404 with error message', () => {
    const res = makeRes();
    notFoundHandler(mockReq, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });
});
