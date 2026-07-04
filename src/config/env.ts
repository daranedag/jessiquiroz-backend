import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),

  ADMIN_API_KEY: z.string().default('change-me'),
  RESERVATION_TOKEN_PEPPER: z.string().default('change-me'),
  INTERNAL_JOB_SECRET: z.string().default('change-me'),

  INSFORGE_URL: z.string().url().optional(),
  INSFORGE_ANON_KEY: z.string().optional(),
  INSFORGE_API_KEY: z.string().optional(),

  GOOGLE_CALENDAR_ID: z.string().default('primary'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_TIMEZONE: z.string().default('America/Santiago'),
  GOOGLE_CREATE_MEET: z.coerce.boolean().default(false),

  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  MERCADOPAGO_PUBLIC_KEY: z.string().optional(),
  MERCADOPAGO_SUCCESS_URL: z.string().url().default('http://localhost:5173/pago/exito'),
  MERCADOPAGO_PENDING_URL: z.string().url().default('http://localhost:5173/pago/pendiente'),
  MERCADOPAGO_FAILURE_URL: z.string().url().default('http://localhost:5173/pago/error'),

  IMAGEKIT_PRIVATE_KEY: z.string().optional(),
  IMAGEKIT_PUBLIC_KEY: z.string().optional(),
  IMAGEKIT_URL_ENDPOINT: z.string().url().optional(),
  IMAGEKIT_FOLDER: z.string().default('/reservations'),

  PRE_RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().default(6),
  UPLOAD_MAX_MB_PER_FILE: z.coerce.number().int().positive().default(8)
});

export const env = envSchema.parse(process.env);

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
