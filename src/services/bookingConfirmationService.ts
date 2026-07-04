import { env } from '../config/env.js';
import { ApiError, assertFound } from '../errors.js';
import type { GoogleCalendarClient } from '../integrations/googleCalendar.js';
import type { MercadoPagoClient } from '../integrations/mercadoPago.js';
import { mapMercadoPagoStatus, type BookingRepository } from '../repositories/bookingRepository.js';

export class BookingConfirmationService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly googleCalendar: GoogleCalendarClient
  ) {}

  async handleMercadoPagoWebhook(payload: unknown, headers: Record<string, string | string[] | undefined>): Promise<{ processed: boolean }> {
    const body = payload as { id?: string | number; type?: string; action?: string; data?: { id?: string | number } };
    const paymentId = String(body.data?.id ?? body.id ?? '');
    if (!paymentId) {
      throw new ApiError(400, 'missing_payment_id', 'Mercado Pago webhook does not include a payment id');
    }

    this.mercadoPago.verifyWebhookSignature(headers, paymentId);
    const eventKey = `${body.type ?? body.action ?? 'payment'}:${paymentId}`;
    const event = await this.repository.createWebhookEvent({
      provider: 'mercadopago',
      event_key: eventKey,
      processed_at: null,
      raw_payload: body as Record<string, unknown>
    });
    if (!event) {
      return { processed: false };
    }

    const mercadoPayment = await this.mercadoPago.getPayment(paymentId);
    const preReservationId = mercadoPayment.externalReference;
    if (!preReservationId) {
      throw new ApiError(400, 'missing_external_reference', 'Mercado Pago payment has no external_reference');
    }

    const localPayment =
      (await this.repository.getPaymentByMercadoPagoPaymentId(paymentId)) ??
      (await this.repository.getLatestPaymentForPreReservation(preReservationId));
    const preReservation = assertFound(await this.repository.getPreReservation(preReservationId), 'Pre-reservation not found');
    const status = mapMercadoPagoStatus(mercadoPayment.status);

    const payment = localPayment
      ? assertFound(
          await this.repository.updatePayment(localPayment.id, {
            mercado_pago_payment_id: paymentId,
            status,
            raw_payload: mercadoPayment.raw
          }),
          'Payment not found'
        )
      : await this.repository.createPayment({
          pre_reservation_id: preReservation.id,
          mercado_pago_preference_id: null,
          mercado_pago_payment_id: paymentId,
          status,
          amount: mercadoPayment.transactionAmount ?? 0,
          currency: mercadoPayment.currencyId ?? 'CLP',
          init_point: null,
          sandbox_init_point: null,
          raw_payload: mercadoPayment.raw
        });

    if (payment.status !== 'approved') {
      await this.repository.markWebhookProcessed(event.id);
      return { processed: true };
    }

    const existingBooking = await this.repository.getBookingByPreReservationId(preReservation.id);
    if (existingBooking) {
      await this.repository.markWebhookProcessed(event.id);
      return { processed: true };
    }

    await this.repository.updatePreReservation(preReservation.id, { status: 'paid_pending_calendar' });
    const service = assertFound(await this.repository.getService(preReservation.service_id), 'Service not found');
    const booking = await this.repository.createBooking({
      pre_reservation_id: preReservation.id,
      payment_id: payment.id,
      service_id: service.id,
      starts_at: preReservation.starts_at,
      ends_at: preReservation.ends_at,
      timezone: preReservation.timezone,
      status: 'confirmed'
    });

    try {
      const calendarEvent = await this.googleCalendar.createEvent(preReservation, service);
      await this.repository.createCalendarEvent({
        booking_id: booking.id,
        google_event_id: calendarEvent.googleEventId,
        calendar_id: env.GOOGLE_CALENDAR_ID,
        html_link: calendarEvent.htmlLink,
        meet_link: calendarEvent.meetLink,
        raw_payload: calendarEvent.raw
      });
      await this.repository.updatePreReservation(preReservation.id, { status: 'confirmed' });
    } catch (error) {
      await this.repository.updatePreReservation(preReservation.id, { status: 'manual_review' });
      throw error;
    } finally {
      await this.repository.markWebhookProcessed(event.id);
    }

    return { processed: true };
  }
}
