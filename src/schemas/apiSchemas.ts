import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid()
});

export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  timezone: z.string().optional()
});

export const createPreReservationSchema = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime(),
  timezone: z.string().default('America/Santiago'),
  client: z.object({
    fullName: z.string().min(2).max(160),
    email: z.string().email(),
    phone: z.string().max(40).optional(),
    notes: z.string().max(3000).optional(),
    formData: z.record(z.unknown()).default({})
  })
});

export const updatePreReservationSchema = z.object({
  client: z
    .object({
      fullName: z.string().min(2).max(160).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(40).nullable().optional(),
      notes: z.string().max(3000).nullable().optional(),
      formData: z.record(z.unknown()).optional()
    })
    .optional()
});

export const createServiceSchema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(2000).nullable().optional(),
  duration_minutes: z.number().int().positive(),
  buffer_before_minutes: z.number().int().min(0).default(0),
  buffer_after_minutes: z.number().int().min(0).default(0),
  price_amount: z.number().positive(),
  currency: z.string().min(3).max(3).default('CLP'),
  active: z.boolean().default(true)
});

export const updateServiceSchema = createServiceSchema.partial();

export const createAvailabilityRuleSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  timezone: z.string().default('America/Santiago'),
  active: z.boolean().default(true)
});

export const updateAvailabilityRuleSchema = createAvailabilityRuleSchema.partial();

export const createBlackoutSchema = z.object({
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  reason: z.string().max(500).nullable().optional()
});

export const updateBlackoutSchema = createBlackoutSchema.partial();

export const updatePreReservationStatusSchema = z.object({
  status: z.enum(['cancelled', 'manual_review', 'expired'])
});

export const rescheduleBookingSchema = z.object({
  startsAt: z.string().datetime(),
  timezone: z.string().default('America/Santiago')
});

export const mercadoPagoWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  action: z.string().optional(),
  data: z
    .object({
      id: z.union([z.string(), z.number()]).optional()
    })
    .optional()
});
