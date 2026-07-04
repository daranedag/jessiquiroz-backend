import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../errors.js';

export function requireAdminApiKey(req: Request, _res: Response, next: NextFunction): void {
  const apiKey = req.header('X-Admin-Api-Key');
  if (!apiKey || apiKey !== env.ADMIN_API_KEY) {
    throw new ApiError(401, 'unauthorized', 'Invalid admin API key');
  }
  next();
}

export function requireInternalJobSecret(req: Request, _res: Response, next: NextFunction): void {
  const secret = req.header('X-Internal-Job-Secret');
  if (!secret || secret !== env.INTERNAL_JOB_SECRET) {
    throw new ApiError(401, 'unauthorized', 'Invalid internal job secret');
  }
  next();
}

export function getReservationToken(req: Request): string {
  const token = req.header('X-Reservation-Token');
  if (!token) {
    throw new ApiError(401, 'missing_reservation_token', 'X-Reservation-Token header is required');
  }
  return token;
}
