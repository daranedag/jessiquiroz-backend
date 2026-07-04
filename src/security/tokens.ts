import { createHash, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { env } from '../config/env.js';

export function createCustomerToken(): string {
  return nanoid(40);
}

export function hashReservationToken(token: string): string {
  return createHash('sha256')
    .update(`${token}:${env.RESERVATION_TOKEN_PEPPER}`)
    .digest('hex');
}

export function verifyReservationToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashReservationToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
