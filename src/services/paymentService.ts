import { ApiError, assertFound } from '../errors.js';
import type { MercadoPagoClient } from '../integrations/mercadoPago.js';
import type { BookingRepository } from '../repositories/bookingRepository.js';
import type { PreReservationService } from './preReservationService.js';

export class PaymentService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly preReservations: PreReservationService
  ) {}

  async createPreference(preReservationId: string, token: string): Promise<{
    paymentId: string;
    preferenceId: string;
    initPoint: string | null;
    sandboxInitPoint: string | null;
  }> {
    const preReservation = await this.preReservations.getForCustomer(preReservationId, token);
    if (preReservation.status !== 'awaiting_payment') {
      throw new ApiError(409, 'invalid_pre_reservation_status', 'Payment can only be created for awaiting_payment reservations');
    }

    const service = assertFound(await this.repository.getService(preReservation.service_id), 'Service not found');
    const existing = await this.repository.getLatestPaymentForPreReservation(preReservation.id);
    if (existing?.status === 'created' || existing?.status === 'pending') {
      return {
        paymentId: existing.id,
        preferenceId: existing.mercado_pago_preference_id ?? '',
        initPoint: existing.init_point,
        sandboxInitPoint: existing.sandbox_init_point
      };
    }

    const preference = await this.mercadoPago.createPreference(preReservation, service);
    const payment = await this.repository.createPayment({
      pre_reservation_id: preReservation.id,
      mercado_pago_preference_id: preference.id,
      mercado_pago_payment_id: null,
      status: 'created',
      amount: service.price_amount,
      currency: service.currency,
      init_point: preference.initPoint,
      sandbox_init_point: preference.sandboxInitPoint,
      raw_payload: preference.raw
    });

    return {
      paymentId: payment.id,
      preferenceId: preference.id,
      initPoint: preference.initPoint,
      sandboxInitPoint: preference.sandboxInitPoint
    };
  }

  async status(preReservationId: string, token: string): Promise<{
    preReservationStatus: string;
    paymentStatus: string | null;
    bookingId: string | null;
  }> {
    const preReservation = await this.preReservations.getForCustomer(preReservationId, token);
    const payment = await this.repository.getLatestPaymentForPreReservation(preReservationId);
    const booking = await this.repository.getBookingByPreReservationId(preReservationId);
    return {
      preReservationStatus: preReservation.status,
      paymentStatus: payment?.status ?? null,
      bookingId: booking?.id ?? null
    };
  }
}
