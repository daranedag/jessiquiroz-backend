import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | null | undefined, message = 'Resource not found'): T {
  if (value === null || value === undefined) {
    throw new ApiError(404, 'not_found', message);
  }
  return value;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request payload',
        details: error.flatten()
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json({
    error: {
      code: 'internal_error',
      message
    }
  });
}
