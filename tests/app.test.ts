import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../src/app.js';
import type { BookingRepository } from '../src/repositories/bookingRepository.js';
import type {
  AuditLog,
  AvailabilityRule,
  BlackoutDate,
  Booking,
  CalendarEvent,
  Payment,
  PreReservation,
  ReservationImage,
  Service,
  WebhookEvent
} from '../src/types/domain.js';

const serviceId = '11111111-1111-4111-8111-111111111111';

describe('booking backend', () => {
  it('lists available slots from weekly rules', async () => {
    const repo = new InMemoryRepository();
    const app = createApp(testDependencies(repo));

    const response = await request(app)
      .get('/api/v1/availability')
      .query({
        serviceId,
        from: '2099-01-05T00:00:00.000Z',
        to: '2099-01-06T00:00:00.000Z',
        timezone: 'UTC'
      })
      .expect(200);

    expect(response.body.data).toContainEqual({
      startsAt: '2099-01-05T13:00:00.000Z',
      endsAt: '2099-01-05T14:00:00.000Z',
      timezone: 'UTC'
    });
  });

  it('creates a pre-reservation and protects it with the customer token', async () => {
    const repo = new InMemoryRepository();
    const app = createApp(testDependencies(repo));

    const created = await request(app)
      .post('/api/v1/pre-reservations')
      .send({
        serviceId,
        startsAt: '2099-01-05T13:00:00.000Z',
        timezone: 'UTC',
        client: {
          fullName: 'Ada Lovelace',
          email: 'ada@example.com',
          phone: '+56911111111',
          notes: 'Primera sesion',
          formData: { reason: 'consulta' }
        }
      })
      .expect(201);

    expect(created.body.data.customerToken).toEqual(expect.any(String));
    expect(created.body.data.preReservation.customer_token_hash).toBeUndefined();

    await request(app).get(`/api/v1/pre-reservations/${created.body.data.preReservation.id}`).expect(401);

    const fetched = await request(app)
      .get(`/api/v1/pre-reservations/${created.body.data.preReservation.id}`)
      .set('X-Reservation-Token', created.body.data.customerToken)
      .expect(200);

    expect(fetched.body.data.preReservation.client_email).toBe('ada@example.com');
  });

  it('creates a Mercado Pago preference for an awaiting payment reservation', async () => {
    const repo = new InMemoryRepository();
    const app = createApp(testDependencies(repo));

    const created = await request(app)
      .post('/api/v1/pre-reservations')
      .send({
        serviceId,
        startsAt: '2099-01-05T13:00:00.000Z',
        timezone: 'UTC',
        client: {
          fullName: 'Grace Hopper',
          email: 'grace@example.com',
          formData: {}
        }
      })
      .expect(201);

    const payment = await request(app)
      .post(`/api/v1/pre-reservations/${created.body.data.preReservation.id}/payment`)
      .set('X-Reservation-Token', created.body.data.customerToken)
      .expect(201);

    expect(payment.body.data.preferenceId).toBe('pref_test');
    expect(payment.body.data.initPoint).toBe('https://mercadopago.example/checkout');
  });
});

function testDependencies(repository: InMemoryRepository): AppDependencies {
  return {
    repository,
    googleCalendar: {
      healthCheck: async () => undefined,
      freeBusy: async () => [],
      createEvent: async () => ({
        googleEventId: 'calendar_event_test',
        htmlLink: 'https://calendar.example/event',
        meetLink: null,
        raw: {}
      }),
      updateEvent: async () => ({
        googleEventId: 'calendar_event_test',
        htmlLink: 'https://calendar.example/event',
        meetLink: null,
        raw: {}
      }),
      deleteEvent: async () => undefined
    } as unknown as AppDependencies['googleCalendar'],
    mercadoPago: {
      healthCheck: async () => undefined,
      createPreference: async () => ({
        id: 'pref_test',
        initPoint: 'https://mercadopago.example/checkout',
        sandboxInitPoint: 'https://sandbox.mercadopago.example/checkout',
        raw: {}
      }),
      getPayment: async () => ({
        id: 'mp_payment_test',
        status: 'approved',
        statusDetail: null,
        externalReference: repository.preReservations[0]?.id ?? null,
        transactionAmount: 45000,
        currencyId: 'CLP',
        raw: {}
      }),
      verifyWebhookSignature: () => undefined
    } as unknown as AppDependencies['mercadoPago'],
    imageKit: {
      healthCheck: async () => undefined,
      upload: async () => ({
        fileId: 'file_test',
        path: '/reservations/file.jpg',
        url: 'https://ik.example/file.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        width: null,
        height: null
      }),
      delete: async () => undefined,
      signedUrl: (path: string) => `https://ik.example${path}`
    } as unknown as AppDependencies['imageKit']
  };
}

class InMemoryRepository implements BookingRepository {
  services: Service[] = [
    {
      id: serviceId,
      name: 'Sesion inicial',
      description: 'Consulta',
      duration_minutes: 60,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      price_amount: 45000,
      currency: 'CLP',
      active: true,
      created_at: now(),
      updated_at: now()
    }
  ];

  rules: AvailabilityRule[] = [
    {
      id: randomUUID(),
      day_of_week: 1,
      start_time: '09:00:00',
      end_time: '17:00:00',
      timezone: 'UTC',
      active: true,
      created_at: now(),
      updated_at: now()
    }
  ];

  blackouts: BlackoutDate[] = [];
  preReservations: PreReservation[] = [];
  images: ReservationImage[] = [];
  payments: Payment[] = [];
  bookings: Booking[] = [];
  calendarEvents: CalendarEvent[] = [];
  webhookEvents: WebhookEvent[] = [];
  auditLogs: AuditLog[] = [];

  async healthCheck(): Promise<void> {}
  async listActiveServices(): Promise<Service[]> {
    return this.services.filter((service) => service.active);
  }
  async listServices(): Promise<Service[]> {
    return this.services;
  }
  async getService(id: string): Promise<Service | null> {
    return this.services.find((service) => service.id === id) ?? null;
  }
  async createService(input: Partial<Service>): Promise<Service> {
    const service = { id: randomUUID(), created_at: now(), updated_at: now(), ...input } as Service;
    this.services.push(service);
    return service;
  }
  async updateService(id: string, input: Partial<Service>): Promise<Service | null> {
    return updateById(this.services, id, input);
  }
  async deleteService(id: string): Promise<void> {
    this.services = this.services.filter((service) => service.id !== id);
  }
  async listAvailabilityRules(): Promise<AvailabilityRule[]> {
    return this.rules;
  }
  async createAvailabilityRule(input: Partial<AvailabilityRule>): Promise<AvailabilityRule> {
    const rule = { id: randomUUID(), created_at: now(), updated_at: now(), ...input } as AvailabilityRule;
    this.rules.push(rule);
    return rule;
  }
  async updateAvailabilityRule(id: string, input: Partial<AvailabilityRule>): Promise<AvailabilityRule | null> {
    return updateById(this.rules, id, input);
  }
  async deleteAvailabilityRule(id: string): Promise<void> {
    this.rules = this.rules.filter((rule) => rule.id !== id);
  }
  async listBlackouts(): Promise<BlackoutDate[]> {
    return this.blackouts;
  }
  async listAllBlackouts(): Promise<BlackoutDate[]> {
    return this.blackouts;
  }
  async createBlackout(input: Partial<BlackoutDate>): Promise<BlackoutDate> {
    const blackout = { id: randomUUID(), created_at: now(), updated_at: now(), ...input } as BlackoutDate;
    this.blackouts.push(blackout);
    return blackout;
  }
  async updateBlackout(id: string, input: Partial<BlackoutDate>): Promise<BlackoutDate | null> {
    return updateById(this.blackouts, id, input);
  }
  async deleteBlackout(id: string): Promise<void> {
    this.blackouts = this.blackouts.filter((blackout) => blackout.id !== id);
  }
  async listBlockingPreReservations(): Promise<PreReservation[]> {
    return this.preReservations.filter((item) => ['awaiting_payment', 'paid_pending_calendar', 'confirmed'].includes(item.status));
  }
  async createPreReservation(input: Omit<PreReservation, 'id' | 'created_at' | 'updated_at'>): Promise<PreReservation> {
    const preReservation = { id: randomUUID(), created_at: now(), updated_at: now(), ...input };
    this.preReservations.push(preReservation);
    return preReservation;
  }
  async getPreReservation(id: string): Promise<PreReservation | null> {
    return this.preReservations.find((item) => item.id === id) ?? null;
  }
  async updatePreReservation(id: string, input: Partial<PreReservation>): Promise<PreReservation | null> {
    return updateById(this.preReservations, id, input);
  }
  async listPreReservations(): Promise<PreReservation[]> {
    return this.preReservations;
  }
  async expirePreReservations(): Promise<number> {
    return 0;
  }
  async createImage(input: Omit<ReservationImage, 'id' | 'created_at' | 'updated_at'>): Promise<ReservationImage> {
    const image = { id: randomUUID(), created_at: now(), updated_at: now(), ...input };
    this.images.push(image);
    return image;
  }
  async listImages(preReservationId: string): Promise<ReservationImage[]> {
    return this.images.filter((image) => image.pre_reservation_id === preReservationId && image.status === 'active');
  }
  async getImage(id: string): Promise<ReservationImage | null> {
    return this.images.find((image) => image.id === id) ?? null;
  }
  async updateImage(id: string, input: Partial<ReservationImage>): Promise<ReservationImage | null> {
    return updateById(this.images, id, input);
  }
  async createPayment(input: Omit<Payment, 'id' | 'created_at' | 'updated_at'>): Promise<Payment> {
    const payment = { id: randomUUID(), created_at: now(), updated_at: now(), ...input };
    this.payments.push(payment);
    return payment;
  }
  async getLatestPaymentForPreReservation(preReservationId: string): Promise<Payment | null> {
    return this.payments.find((payment) => payment.pre_reservation_id === preReservationId) ?? null;
  }
  async getPaymentByPreference(preferenceId: string): Promise<Payment | null> {
    return this.payments.find((payment) => payment.mercado_pago_preference_id === preferenceId) ?? null;
  }
  async getPaymentByMercadoPagoPaymentId(paymentId: string): Promise<Payment | null> {
    return this.payments.find((payment) => payment.mercado_pago_payment_id === paymentId) ?? null;
  }
  async updatePayment(id: string, input: Partial<Payment>): Promise<Payment | null> {
    return updateById(this.payments, id, input);
  }
  async listPayments(): Promise<Payment[]> {
    return this.payments;
  }
  async createBooking(input: Omit<Booking, 'id' | 'created_at' | 'updated_at'>): Promise<Booking> {
    const booking = { id: randomUUID(), created_at: now(), updated_at: now(), ...input };
    this.bookings.push(booking);
    return booking;
  }
  async getBooking(id: string): Promise<Booking | null> {
    return this.bookings.find((booking) => booking.id === id) ?? null;
  }
  async getBookingByPreReservationId(preReservationId: string): Promise<Booking | null> {
    return this.bookings.find((booking) => booking.pre_reservation_id === preReservationId) ?? null;
  }
  async updateBooking(id: string, input: Partial<Booking>): Promise<Booking | null> {
    return updateById(this.bookings, id, input);
  }
  async listBookings(): Promise<Booking[]> {
    return this.bookings;
  }
  async createCalendarEvent(input: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): Promise<CalendarEvent> {
    const event = { id: randomUUID(), created_at: now(), updated_at: now(), ...input };
    this.calendarEvents.push(event);
    return event;
  }
  async getCalendarEventByBookingId(bookingId: string): Promise<CalendarEvent | null> {
    return this.calendarEvents.find((event) => event.booking_id === bookingId) ?? null;
  }
  async updateCalendarEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent | null> {
    return updateById(this.calendarEvents, id, input);
  }
  async createWebhookEvent(input: Omit<WebhookEvent, 'id' | 'created_at'>): Promise<WebhookEvent | null> {
    const event = { id: randomUUID(), created_at: now(), ...input };
    this.webhookEvents.push(event);
    return event;
  }
  async markWebhookProcessed(id: string): Promise<void> {
    updateById(this.webhookEvents, id, { processed_at: now() });
  }
  async createAuditLog(input: Omit<AuditLog, 'id' | 'created_at'>): Promise<void> {
    this.auditLogs.push({ id: randomUUID(), created_at: now(), ...input });
  }
  async listAuditLogs(): Promise<AuditLog[]> {
    return this.auditLogs;
  }
}

function updateById<T extends { id: string; updated_at?: string }>(items: T[], id: string, input: Partial<T>): T | null {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    return null;
  }
  Object.assign(item, input, 'updated_at' in item ? { updated_at: now() } : {});
  return item;
}

function now(): string {
  return new Date().toISOString();
}
