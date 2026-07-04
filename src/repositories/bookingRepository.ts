import { createClient } from '@insforge/sdk';
import { env } from '../config/env.js';
import { ApiError } from '../errors.js';
import type {
  AuditLog,
  AvailabilityRule,
  BlackoutDate,
  Booking,
  CalendarEvent,
  Payment,
  PaymentStatus,
  PreReservation,
  PreReservationStatus,
  ReservationImage,
  Service,
  WebhookEvent
} from '../types/domain.js';

type InsertPreReservation = Pick<
  PreReservation,
  | 'service_id'
  | 'client_name'
  | 'client_email'
  | 'client_phone'
  | 'client_notes'
  | 'form_data'
  | 'starts_at'
  | 'ends_at'
  | 'timezone'
  | 'status'
  | 'expires_at'
  | 'customer_token_hash'
>;

type InsertImage = Pick<
  ReservationImage,
  | 'pre_reservation_id'
  | 'imagekit_file_id'
  | 'imagekit_path'
  | 'url'
  | 'mime_type'
  | 'size_bytes'
  | 'width'
  | 'height'
  | 'status'
>;

type InsertPayment = Pick<
  Payment,
  | 'pre_reservation_id'
  | 'mercado_pago_preference_id'
  | 'mercado_pago_payment_id'
  | 'status'
  | 'amount'
  | 'currency'
  | 'init_point'
  | 'sandbox_init_point'
  | 'raw_payload'
>;

type InsertBooking = Pick<
  Booking,
  'pre_reservation_id' | 'payment_id' | 'service_id' | 'starts_at' | 'ends_at' | 'timezone' | 'status'
>;

type InsertCalendarEvent = Pick<
  CalendarEvent,
  'booking_id' | 'google_event_id' | 'calendar_id' | 'html_link' | 'meet_link' | 'raw_payload'
>;

export interface BookingRepository {
  healthCheck(): Promise<void>;
  listActiveServices(): Promise<Service[]>;
  listServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | null>;
  createService(input: Partial<Service>): Promise<Service>;
  updateService(id: string, input: Partial<Service>): Promise<Service | null>;
  deleteService(id: string): Promise<void>;

  listAvailabilityRules(): Promise<AvailabilityRule[]>;
  createAvailabilityRule(input: Partial<AvailabilityRule>): Promise<AvailabilityRule>;
  updateAvailabilityRule(id: string, input: Partial<AvailabilityRule>): Promise<AvailabilityRule | null>;
  deleteAvailabilityRule(id: string): Promise<void>;

  listBlackouts(from: string, to: string): Promise<BlackoutDate[]>;
  listAllBlackouts(): Promise<BlackoutDate[]>;
  createBlackout(input: Partial<BlackoutDate>): Promise<BlackoutDate>;
  updateBlackout(id: string, input: Partial<BlackoutDate>): Promise<BlackoutDate | null>;
  deleteBlackout(id: string): Promise<void>;

  listBlockingPreReservations(from: string, to: string): Promise<PreReservation[]>;
  createPreReservation(input: InsertPreReservation): Promise<PreReservation>;
  getPreReservation(id: string): Promise<PreReservation | null>;
  updatePreReservation(id: string, input: Partial<PreReservation>): Promise<PreReservation | null>;
  listPreReservations(): Promise<PreReservation[]>;
  expirePreReservations(nowIso: string): Promise<number>;

  createImage(input: InsertImage): Promise<ReservationImage>;
  listImages(preReservationId: string): Promise<ReservationImage[]>;
  getImage(id: string): Promise<ReservationImage | null>;
  updateImage(id: string, input: Partial<ReservationImage>): Promise<ReservationImage | null>;

  createPayment(input: InsertPayment): Promise<Payment>;
  getLatestPaymentForPreReservation(preReservationId: string): Promise<Payment | null>;
  getPaymentByPreference(preferenceId: string): Promise<Payment | null>;
  getPaymentByMercadoPagoPaymentId(paymentId: string): Promise<Payment | null>;
  updatePayment(id: string, input: Partial<Payment>): Promise<Payment | null>;
  listPayments(): Promise<Payment[]>;

  createBooking(input: InsertBooking): Promise<Booking>;
  getBooking(id: string): Promise<Booking | null>;
  getBookingByPreReservationId(preReservationId: string): Promise<Booking | null>;
  updateBooking(id: string, input: Partial<Booking>): Promise<Booking | null>;
  listBookings(): Promise<Booking[]>;

  createCalendarEvent(input: InsertCalendarEvent): Promise<CalendarEvent>;
  getCalendarEventByBookingId(bookingId: string): Promise<CalendarEvent | null>;
  updateCalendarEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent | null>;

  createWebhookEvent(input: Omit<WebhookEvent, 'id' | 'created_at'>): Promise<WebhookEvent | null>;
  markWebhookProcessed(id: string): Promise<void>;
  createAuditLog(input: Omit<AuditLog, 'id' | 'created_at'>): Promise<void>;
  listAuditLogs(): Promise<AuditLog[]>;
}

export class InsForgeBookingRepository implements BookingRepository {
  private readonly client: any;

  constructor() {
    const key = env.INSFORGE_API_KEY ?? env.INSFORGE_ANON_KEY;
    this.client = env.INSFORGE_URL && key ? createClient({ baseUrl: env.INSFORGE_URL, anonKey: key }) : null;
  }

  async healthCheck(): Promise<void> {
    const { error } = await this.table('services').select('id').limit(1);
    this.throwIfError(error);
  }

  async listActiveServices(): Promise<Service[]> {
    return this.selectMany<Service>(this.table('services').select().eq('active', true).order('name'));
  }

  async listServices(): Promise<Service[]> {
    return this.selectMany<Service>(this.table('services').select().order('name'));
  }

  async getService(id: string): Promise<Service | null> {
    return this.selectMaybe<Service>(this.table('services').select().eq('id', id).maybeSingle());
  }

  async createService(input: Partial<Service>): Promise<Service> {
    return this.insertOne<Service>('services', input);
  }

  async updateService(id: string, input: Partial<Service>): Promise<Service | null> {
    return this.updateOne<Service>('services', id, input);
  }

  async deleteService(id: string): Promise<void> {
    await this.deleteOne('services', id);
  }

  async listAvailabilityRules(): Promise<AvailabilityRule[]> {
    return this.selectMany<AvailabilityRule>(
      this.table('availability_rules').select().eq('active', true).order('day_of_week')
    );
  }

  async createAvailabilityRule(input: Partial<AvailabilityRule>): Promise<AvailabilityRule> {
    return this.insertOne<AvailabilityRule>('availability_rules', input);
  }

  async updateAvailabilityRule(id: string, input: Partial<AvailabilityRule>): Promise<AvailabilityRule | null> {
    return this.updateOne<AvailabilityRule>('availability_rules', id, input);
  }

  async deleteAvailabilityRule(id: string): Promise<void> {
    await this.deleteOne('availability_rules', id);
  }

  async listBlackouts(from: string, to: string): Promise<BlackoutDate[]> {
    return this.selectMany<BlackoutDate>(
      this.table('blackout_dates').select().lt('starts_at', to).gt('ends_at', from).order('starts_at')
    );
  }

  async listAllBlackouts(): Promise<BlackoutDate[]> {
    return this.selectMany<BlackoutDate>(this.table('blackout_dates').select().order('starts_at'));
  }

  async createBlackout(input: Partial<BlackoutDate>): Promise<BlackoutDate> {
    return this.insertOne<BlackoutDate>('blackout_dates', input);
  }

  async updateBlackout(id: string, input: Partial<BlackoutDate>): Promise<BlackoutDate | null> {
    return this.updateOne<BlackoutDate>('blackout_dates', id, input);
  }

  async deleteBlackout(id: string): Promise<void> {
    await this.deleteOne('blackout_dates', id);
  }

  async listBlockingPreReservations(from: string, to: string): Promise<PreReservation[]> {
    return this.selectMany<PreReservation>(
      this.table('pre_reservations')
        .select()
        .in('status', ['awaiting_payment', 'paid_pending_calendar', 'confirmed', 'manual_review'])
        .lt('starts_at', to)
        .gt('ends_at', from)
        .gt('expires_at', new Date().toISOString())
    );
  }

  async createPreReservation(input: InsertPreReservation): Promise<PreReservation> {
    return this.insertOne<PreReservation>('pre_reservations', input);
  }

  async getPreReservation(id: string): Promise<PreReservation | null> {
    return this.selectMaybe<PreReservation>(this.table('pre_reservations').select().eq('id', id).maybeSingle());
  }

  async updatePreReservation(id: string, input: Partial<PreReservation>): Promise<PreReservation | null> {
    return this.updateOne<PreReservation>('pre_reservations', id, input);
  }

  async listPreReservations(): Promise<PreReservation[]> {
    return this.selectMany<PreReservation>(this.table('pre_reservations').select().order('created_at', { ascending: false }));
  }

  async expirePreReservations(nowIso: string): Promise<number> {
    const { data, error } = await this.table('pre_reservations')
      .update({ status: 'expired' satisfies PreReservationStatus })
      .in('status', ['draft', 'awaiting_payment'])
      .lt('expires_at', nowIso)
      .select();
    this.throwIfError(error);
    return Array.isArray(data) ? data.length : 0;
  }

  async createImage(input: InsertImage): Promise<ReservationImage> {
    return this.insertOne<ReservationImage>('reservation_images', input);
  }

  async listImages(preReservationId: string): Promise<ReservationImage[]> {
    return this.selectMany<ReservationImage>(
      this.table('reservation_images').select().eq('pre_reservation_id', preReservationId).eq('status', 'active')
    );
  }

  async getImage(id: string): Promise<ReservationImage | null> {
    return this.selectMaybe<ReservationImage>(this.table('reservation_images').select().eq('id', id).maybeSingle());
  }

  async updateImage(id: string, input: Partial<ReservationImage>): Promise<ReservationImage | null> {
    return this.updateOne<ReservationImage>('reservation_images', id, input);
  }

  async createPayment(input: InsertPayment): Promise<Payment> {
    return this.insertOne<Payment>('payments', input);
  }

  async getLatestPaymentForPreReservation(preReservationId: string): Promise<Payment | null> {
    return this.selectMaybe<Payment>(
      this.table('payments')
        .select()
        .eq('pre_reservation_id', preReservationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );
  }

  async getPaymentByPreference(preferenceId: string): Promise<Payment | null> {
    return this.selectMaybe<Payment>(
      this.table('payments').select().eq('mercado_pago_preference_id', preferenceId).maybeSingle()
    );
  }

  async getPaymentByMercadoPagoPaymentId(paymentId: string): Promise<Payment | null> {
    return this.selectMaybe<Payment>(
      this.table('payments').select().eq('mercado_pago_payment_id', paymentId).maybeSingle()
    );
  }

  async updatePayment(id: string, input: Partial<Payment>): Promise<Payment | null> {
    return this.updateOne<Payment>('payments', id, input);
  }

  async listPayments(): Promise<Payment[]> {
    return this.selectMany<Payment>(this.table('payments').select().order('created_at', { ascending: false }));
  }

  async createBooking(input: InsertBooking): Promise<Booking> {
    return this.insertOne<Booking>('bookings', input);
  }

  async getBooking(id: string): Promise<Booking | null> {
    return this.selectMaybe<Booking>(this.table('bookings').select().eq('id', id).maybeSingle());
  }

  async getBookingByPreReservationId(preReservationId: string): Promise<Booking | null> {
    return this.selectMaybe<Booking>(
      this.table('bookings').select().eq('pre_reservation_id', preReservationId).maybeSingle()
    );
  }

  async updateBooking(id: string, input: Partial<Booking>): Promise<Booking | null> {
    return this.updateOne<Booking>('bookings', id, input);
  }

  async listBookings(): Promise<Booking[]> {
    return this.selectMany<Booking>(this.table('bookings').select().order('created_at', { ascending: false }));
  }

  async createCalendarEvent(input: InsertCalendarEvent): Promise<CalendarEvent> {
    return this.insertOne<CalendarEvent>('calendar_events', input);
  }

  async getCalendarEventByBookingId(bookingId: string): Promise<CalendarEvent | null> {
    return this.selectMaybe<CalendarEvent>(
      this.table('calendar_events').select().eq('booking_id', bookingId).maybeSingle()
    );
  }

  async updateCalendarEvent(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent | null> {
    return this.updateOne<CalendarEvent>('calendar_events', id, input);
  }

  async createWebhookEvent(input: Omit<WebhookEvent, 'id' | 'created_at'>): Promise<WebhookEvent | null> {
    const { data, error } = await this.table('webhook_events').insert([input]).select();
    if (error) {
      const message = String(error.message ?? error);
      if (message.includes('duplicate') || message.includes('unique')) {
        return null;
      }
      this.throwIfError(error);
    }
    return first<WebhookEvent>(data);
  }

  async markWebhookProcessed(id: string): Promise<void> {
    await this.updateOne<WebhookEvent>('webhook_events', id, { processed_at: new Date().toISOString() });
  }

  async createAuditLog(input: Omit<AuditLog, 'id' | 'created_at'>): Promise<void> {
    const { error } = await this.table('audit_logs').insert([input]);
    this.throwIfError(error);
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    return this.selectMany<AuditLog>(this.table('audit_logs').select().order('created_at', { ascending: false }));
  }

  private table(name: string): any {
    if (!this.client) {
      throw new ApiError(503, 'insforge_not_configured', 'INSFORGE_URL and INSFORGE_API_KEY or INSFORGE_ANON_KEY are required');
    }
    return this.client.database.from(name);
  }

  private async selectMany<T>(query: PromiseLike<{ data: unknown; error?: unknown }>): Promise<T[]> {
    const { data, error } = await query;
    this.throwIfError(error);
    return Array.isArray(data) ? (data as T[]) : [];
  }

  private async selectMaybe<T>(query: PromiseLike<{ data: unknown; error?: unknown }>): Promise<T | null> {
    const { data, error } = await query;
    if (error) {
      const message = String((error as { message?: string }).message ?? error);
      if (message.toLowerCase().includes('no rows')) {
        return null;
      }
      this.throwIfError(error);
    }
    return (data as T | null) ?? null;
  }

  private async insertOne<T>(table: string, input: unknown): Promise<T> {
    const { data, error } = await this.table(table).insert([input]).select();
    this.throwIfError(error);
    return first<T>(data);
  }

  private async updateOne<T>(table: string, id: string, input: unknown): Promise<T | null> {
    const { data, error } = await this.table(table).update(input).eq('id', id).select();
    this.throwIfError(error);
    return first<T>(data, true);
  }

  private async deleteOne(table: string, id: string): Promise<void> {
    const { error } = await this.table(table).delete().eq('id', id);
    this.throwIfError(error);
  }

  private throwIfError(error: unknown): void {
    if (error) {
      const message = String((error as { message?: string }).message ?? error);
      throw new ApiError(502, 'insforge_error', message, error);
    }
  }
}

function first<T>(data: unknown, allowNull = false): T {
  if (Array.isArray(data) && data[0]) {
    return data[0] as T;
  }
  if (allowNull) {
    return null as T;
  }
  throw new ApiError(502, 'insforge_empty_response', 'InsForge did not return a row');
}

export function mapMercadoPagoStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      return 'pending';
  }
}
