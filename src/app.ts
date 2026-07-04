import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { errorHandler, assertFound, ApiError } from './errors.js';
import { GoogleCalendarClient } from './integrations/googleCalendar.js';
import { ImageKitClient } from './integrations/imageKit.js';
import { MercadoPagoClient } from './integrations/mercadoPago.js';
import { requireAdminApiKey, requireInternalJobSecret, getReservationToken } from './middleware/auth.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { publicLimiter, uploadLimiter, webhookLimiter } from './middleware/rateLimit.js';
import { validateBody, validateQuery } from './middleware/validation.js';
import { InsForgeBookingRepository, type BookingRepository } from './repositories/bookingRepository.js';
import {
  availabilityQuerySchema,
  createAvailabilityRuleSchema,
  createBlackoutSchema,
  createPreReservationSchema,
  createServiceSchema,
  mercadoPagoWebhookSchema,
  rescheduleBookingSchema,
  updateAvailabilityRuleSchema,
  updateBlackoutSchema,
  updatePreReservationSchema,
  updatePreReservationStatusSchema,
  updateServiceSchema
} from './schemas/apiSchemas.js';
import { AvailabilityService } from './services/availabilityService.js';
import { BookingConfirmationService } from './services/bookingConfirmationService.js';
import { PaymentService } from './services/paymentService.js';
import { PreReservationService } from './services/preReservationService.js';

export type AppDependencies = {
  repository: BookingRepository;
  googleCalendar: GoogleCalendarClient;
  mercadoPago: MercadoPagoClient;
  imageKit: ImageKitClient;
};

export function createDefaultDependencies(): AppDependencies {
  return {
    repository: new InsForgeBookingRepository(),
    googleCalendar: new GoogleCalendarClient(),
    mercadoPago: new MercadoPagoClient(),
    imageKit: new ImageKitClient()
  };
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  const availability = new AvailabilityService(dependencies.repository, dependencies.googleCalendar);
  const preReservations = new PreReservationService(dependencies.repository, availability, dependencies.imageKit);
  const payments = new PaymentService(dependencies.repository, dependencies.mercadoPago, preReservations);
  const confirmations = new BookingConfirmationService(
    dependencies.repository,
    dependencies.mercadoPago,
    dependencies.googleCalendar
  );

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: env.UPLOAD_MAX_FILES,
      fileSize: env.UPLOAD_MAX_MB_PER_FILE * 1024 * 1024
    }
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()),
      credentials: false
    })
  );
  app.use(compression() as unknown as express.RequestHandler);
  app.use(pinoHttp() as unknown as express.RequestHandler);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const checks = await Promise.allSettled([
        dependencies.repository.healthCheck(),
        dependencies.googleCalendar.healthCheck(),
        dependencies.mercadoPago.healthCheck(),
        dependencies.imageKit.healthCheck()
      ]);
      const details = checks.map((check, index) => ({
        name: ['database', 'googleCalendar', 'mercadoPago', 'imageKit'][index],
        ok: check.status === 'fulfilled',
        reason: check.status === 'rejected' && check.reason instanceof Error ? check.reason.message : undefined
      }));
      const ok = details.every((detail) => detail.ok);
      res.status(ok ? 200 : 503).json({ ok, details });
    })
  );

  const api = express.Router();
  api.use(publicLimiter);

  api.get(
    '/services',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listActiveServices() });
    })
  );

  api.get(
    '/availability',
    validateQuery(availabilityQuerySchema),
    asyncHandler(async (req, res) => {
      const query = availabilityQuerySchema.parse(req.query);
      const slots = await availability.listSlots(query.serviceId, query.from, query.to, query.timezone);
      res.json({ data: slots });
    })
  );

  api.post(
    '/pre-reservations',
    validateBody(createPreReservationSchema),
    asyncHandler(async (req, res) => {
      const body = createPreReservationSchema.parse(req.body);
      const result = await preReservations.create(body);
      res.status(201).json({
        data: {
          preReservation: redactPreReservation(result.preReservation),
          customerToken: result.customerToken
        }
      });
    })
  );

  api.get(
    '/pre-reservations/:id',
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      const preReservation = await preReservations.getForCustomer(req.params.id, token);
      const images = await dependencies.repository.listImages(req.params.id);
      res.json({ data: { preReservation: redactPreReservation(preReservation), images } });
    })
  );

  api.patch(
    '/pre-reservations/:id',
    validateBody(updatePreReservationSchema),
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      const body = updatePreReservationSchema.parse(req.body);
      const updated = await preReservations.updateForCustomer(req.params.id, token, {
        fullName: body.client?.fullName,
        email: body.client?.email,
        phone: body.client?.phone ?? undefined,
        notes: body.client?.notes ?? undefined,
        formData: body.client?.formData
      });
      res.json({ data: redactPreReservation(updated) });
    })
  );

  api.post(
    '/pre-reservations/:id/images',
    uploadLimiter,
    upload.array('images', env.UPLOAD_MAX_FILES),
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      const files = Array.isArray(req.files) ? req.files : [];
      const images = await preReservations.uploadImages(req.params.id, token, files);
      res.status(201).json({ data: images });
    })
  );

  api.delete(
    '/pre-reservations/:id/images/:imageId',
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      await preReservations.deleteImage(req.params.id, token, req.params.imageId);
      res.status(204).send();
    })
  );

  api.post(
    '/pre-reservations/:id/payment',
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      res.status(201).json({ data: await payments.createPreference(req.params.id, token) });
    })
  );

  api.get(
    '/pre-reservations/:id/payment-status',
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      res.json({ data: await payments.status(req.params.id, token) });
    })
  );

  api.get(
    '/bookings/:id',
    asyncHandler(async (req, res) => {
      const token = getReservationToken(req);
      const booking = assertFound(await dependencies.repository.getBooking(req.params.id), 'Booking not found');
      const preReservation = assertFound(
        await dependencies.repository.getPreReservation(booking.pre_reservation_id),
        'Pre-reservation not found'
      );
      preReservations.assertValidToken(preReservation, token);
      const calendarEvent = await dependencies.repository.getCalendarEventByBookingId(booking.id);
      res.json({ data: { booking, preReservation: redactPreReservation(preReservation), calendarEvent } });
    })
  );

  api.post(
    '/webhooks/mercadopago',
    webhookLimiter,
    validateBody(mercadoPagoWebhookSchema),
    asyncHandler(async (req, res) => {
      const result = await confirmations.handleMercadoPagoWebhook(req.body, req.headers);
      res.json({ ok: true, ...result });
    })
  );

  api.post(
    '/internal/jobs/expire-pre-reservations',
    requireInternalJobSecret,
    asyncHandler(async (_req, res) => {
      const expired = await dependencies.repository.expirePreReservations(new Date().toISOString());
      res.json({ data: { expired } });
    })
  );

  const admin = express.Router();
  admin.use(requireAdminApiKey);

  admin.get(
    '/services',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listServices() });
    })
  );
  admin.post('/services', validateBody(createServiceSchema), crudCreate(dependencies.repository.createService.bind(dependencies.repository)));
  admin.patch('/services/:id', validateBody(updateServiceSchema), crudUpdate(dependencies.repository.updateService.bind(dependencies.repository)));
  admin.delete('/services/:id', crudDelete(dependencies.repository.deleteService.bind(dependencies.repository)));

  admin.get(
    '/availability-rules',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listAvailabilityRules() });
    })
  );
  admin.post(
    '/availability-rules',
    validateBody(createAvailabilityRuleSchema),
    crudCreate(dependencies.repository.createAvailabilityRule.bind(dependencies.repository))
  );
  admin.patch(
    '/availability-rules/:id',
    validateBody(updateAvailabilityRuleSchema),
    crudUpdate(dependencies.repository.updateAvailabilityRule.bind(dependencies.repository))
  );
  admin.delete('/availability-rules/:id', crudDelete(dependencies.repository.deleteAvailabilityRule.bind(dependencies.repository)));

  admin.get(
    '/blackout-dates',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listAllBlackouts() });
    })
  );
  admin.post('/blackout-dates', validateBody(createBlackoutSchema), crudCreate(dependencies.repository.createBlackout.bind(dependencies.repository)));
  admin.patch('/blackout-dates/:id', validateBody(updateBlackoutSchema), crudUpdate(dependencies.repository.updateBlackout.bind(dependencies.repository)));
  admin.delete('/blackout-dates/:id', crudDelete(dependencies.repository.deleteBlackout.bind(dependencies.repository)));

  admin.get(
    '/pre-reservations',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listPreReservations() });
    })
  );

  admin.get(
    '/pre-reservations/:id',
    asyncHandler(async (req, res) => {
      const preReservation = assertFound(await dependencies.repository.getPreReservation(req.params.id), 'Pre-reservation not found');
      const images = await dependencies.repository.listImages(req.params.id);
      res.json({
        data: {
          preReservation: redactPreReservation(preReservation),
          images: images.map((image) => ({ ...image, signedUrl: dependencies.imageKit.signedUrl(image.imagekit_path) }))
        }
      });
    })
  );

  admin.patch(
    '/pre-reservations/:id/status',
    validateBody(updatePreReservationStatusSchema),
    asyncHandler(async (req, res) => {
      const body = updatePreReservationStatusSchema.parse(req.body);
      const updated = assertFound(
        await dependencies.repository.updatePreReservation(req.params.id, { status: body.status }),
        'Pre-reservation not found'
      );
      await dependencies.repository.createAuditLog({
        actor: 'admin_api_key',
        action: `pre_reservation.${body.status}`,
        entity_type: 'pre_reservation',
        entity_id: req.params.id,
        metadata: {}
      });
      res.json({ data: redactPreReservation(updated) });
    })
  );

  admin.get(
    '/bookings',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listBookings() });
    })
  );

  admin.patch(
    '/bookings/:id/reschedule',
    validateBody(rescheduleBookingSchema),
    asyncHandler(async (req, res) => {
      const body = rescheduleBookingSchema.parse(req.body);
      const booking = assertFound(await dependencies.repository.getBooking(req.params.id), 'Booking not found');
      const service = assertFound(await dependencies.repository.getService(booking.service_id), 'Service not found');
      const slot = await availability.assertSlotAvailable(service, body.startsAt, body.timezone);
      const updated = assertFound(
        await dependencies.repository.updateBooking(booking.id, {
          starts_at: slot.startsAt,
          ends_at: slot.endsAt,
          timezone: body.timezone,
          status: 'rescheduled'
        }),
        'Booking not found'
      );
      await dependencies.repository.updatePreReservation(booking.pre_reservation_id, {
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        timezone: body.timezone
      });
      const calendarEvent = await dependencies.repository.getCalendarEventByBookingId(booking.id);
      if (calendarEvent) {
        const synced = await dependencies.googleCalendar.updateEvent(
          calendarEvent.google_event_id,
          slot.startsAt,
          slot.endsAt,
          body.timezone
        );
        await dependencies.repository.updateCalendarEvent(calendarEvent.id, {
          html_link: synced.htmlLink,
          meet_link: synced.meetLink,
          raw_payload: synced.raw
        });
      }
      await dependencies.repository.createAuditLog({
        actor: 'admin_api_key',
        action: 'booking.reschedule',
        entity_type: 'booking',
        entity_id: booking.id,
        metadata: { startsAt: slot.startsAt, endsAt: slot.endsAt }
      });
      res.json({ data: updated });
    })
  );

  admin.patch(
    '/bookings/:id/cancel',
    asyncHandler(async (req, res) => {
      const booking = assertFound(await dependencies.repository.getBooking(req.params.id), 'Booking not found');
      const updated = assertFound(
        await dependencies.repository.updateBooking(booking.id, { status: 'cancelled' }),
        'Booking not found'
      );
      await dependencies.repository.updatePreReservation(booking.pre_reservation_id, { status: 'cancelled' });
      const calendarEvent = await dependencies.repository.getCalendarEventByBookingId(booking.id);
      if (calendarEvent) {
        await dependencies.googleCalendar.deleteEvent(calendarEvent.google_event_id);
      }
      await dependencies.repository.createAuditLog({
        actor: 'admin_api_key',
        action: 'booking.cancel',
        entity_type: 'booking',
        entity_id: booking.id,
        metadata: {}
      });
      res.json({ data: updated });
    })
  );

  admin.post(
    '/bookings/:id/calendar/resync',
    asyncHandler(async (req, res) => {
      const booking = assertFound(await dependencies.repository.getBooking(req.params.id), 'Booking not found');
      const preReservation = assertFound(
        await dependencies.repository.getPreReservation(booking.pre_reservation_id),
        'Pre-reservation not found'
      );
      const service = assertFound(await dependencies.repository.getService(booking.service_id), 'Service not found');
      const existing = await dependencies.repository.getCalendarEventByBookingId(booking.id);
      const synced = existing
        ? await dependencies.googleCalendar.updateEvent(
            existing.google_event_id,
            booking.starts_at,
            booking.ends_at,
            booking.timezone
          )
        : await dependencies.googleCalendar.createEvent(preReservation, service);
      const calendarEvent = existing
        ? await dependencies.repository.updateCalendarEvent(existing.id, {
            html_link: synced.htmlLink,
            meet_link: synced.meetLink,
            raw_payload: synced.raw
          })
        : await dependencies.repository.createCalendarEvent({
            booking_id: booking.id,
            google_event_id: synced.googleEventId,
            calendar_id: env.GOOGLE_CALENDAR_ID,
            html_link: synced.htmlLink,
            meet_link: synced.meetLink,
            raw_payload: synced.raw
          });
      await dependencies.repository.updatePreReservation(preReservation.id, { status: 'confirmed' });
      res.json({ data: calendarEvent });
    })
  );

  admin.get(
    '/payments',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listPayments() });
    })
  );

  admin.get(
    '/audit-logs',
    asyncHandler(async (_req, res) => {
      res.json({ data: await dependencies.repository.listAuditLogs() });
    })
  );

  api.use('/admin', admin);
  app.use('/api/v1', api);
  app.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Route not found')));
  app.use(errorHandler);

  return app;
}

function crudCreate<T>(handler: (input: T) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    res.status(201).json({ data: await handler(req.body as T) });
  });
}

function crudUpdate<T>(handler: (id: string, input: T) => Promise<unknown | null>) {
  return asyncHandler(async (req, res) => {
    res.json({ data: assertFound(await handler(req.params.id, req.body as T), 'Resource not found') });
  });
}

function crudDelete(handler: (id: string) => Promise<void>) {
  return asyncHandler(async (req, res) => {
    await handler(req.params.id);
    res.status(204).send();
  });
}

function redactPreReservation<T extends { customer_token_hash?: string }>(preReservation: T): Omit<T, 'customer_token_hash'> {
  const { customer_token_hash: _customerTokenHash, ...safe } = preReservation;
  return safe;
}
