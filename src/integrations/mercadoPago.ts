import { createHmac, timingSafeEqual } from 'node:crypto';
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import { env, requireEnv } from '../config/env.js';
import { ApiError } from '../errors.js';
import type { PreReservation, Service } from '../types/domain.js';

export type MercadoPreference = {
  id: string;
  initPoint: string | null;
  sandboxInitPoint: string | null;
  raw: Record<string, unknown>;
};

export type MercadoPayment = {
  id: string;
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  raw: Record<string, unknown>;
};

export class MercadoPagoClient {
  private readonly preference: Preference | null;
  private readonly payment: Payment | null;

  constructor() {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      this.preference = null;
      this.payment = null;
      return;
    }
    const client = new MercadoPagoConfig({ accessToken: env.MERCADOPAGO_ACCESS_TOKEN });
    this.preference = new Preference(client);
    this.payment = new Payment(client);
  }

  async healthCheck(): Promise<void> {
    requireEnv('MERCADOPAGO_ACCESS_TOKEN');
  }

  async createPreference(preReservation: PreReservation, service: Service): Promise<MercadoPreference> {
    if (!this.preference) {
      throw new ApiError(503, 'mercadopago_not_configured', 'Mercado Pago is not configured');
    }

    const response = await this.preference.create({
      body: {
        items: [
          {
            id: service.id,
            title: service.name,
            description: service.description ?? undefined,
            quantity: 1,
            unit_price: service.price_amount,
            currency_id: service.currency
          }
        ],
        payer: {
          name: preReservation.client_name,
          email: preReservation.client_email,
          phone: preReservation.client_phone ? { number: preReservation.client_phone } : undefined
        },
        external_reference: preReservation.id,
        notification_url: `${env.PUBLIC_API_BASE_URL}/api/v1/webhooks/mercadopago`,
        back_urls: {
          success: env.MERCADOPAGO_SUCCESS_URL,
          pending: env.MERCADOPAGO_PENDING_URL,
          failure: env.MERCADOPAGO_FAILURE_URL
        },
        auto_return: 'approved',
        expires: true,
        expiration_date_to: preReservation.expires_at,
        metadata: {
          preReservationId: preReservation.id,
          serviceId: service.id
        }
      }
    });

    return {
      id: response.id ?? '',
      initPoint: response.init_point ?? null,
      sandboxInitPoint: response.sandbox_init_point ?? null,
      raw: response as unknown as Record<string, unknown>
    };
  }

  async getPayment(paymentId: string): Promise<MercadoPayment> {
    if (!this.payment) {
      throw new ApiError(503, 'mercadopago_not_configured', 'Mercado Pago is not configured');
    }
    const response = await this.payment.get({ id: paymentId });
    return {
      id: String(response.id),
      status: response.status ?? 'pending',
      statusDetail: response.status_detail ?? null,
      externalReference: response.external_reference ?? null,
      transactionAmount: response.transaction_amount ?? null,
      currencyId: response.currency_id ?? null,
      raw: response as unknown as Record<string, unknown>
    };
  }

  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, dataId?: string): void {
    const secret = env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
      return;
    }

    const signatureHeader = headerValue(headers['x-signature']);
    const requestId = headerValue(headers['x-request-id']);
    if (!signatureHeader || !requestId) {
      throw new ApiError(401, 'invalid_webhook_signature', 'Mercado Pago signature headers are required');
    }

    const ts = signatureHeader
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.startsWith('ts='))
      ?.slice(3);
    const received = signatureHeader
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.startsWith('v1='))
      ?.slice(3);

    if (!ts || !received || !dataId) {
      throw new ApiError(401, 'invalid_webhook_signature', 'Invalid Mercado Pago signature format');
    }

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    const actualBuffer = Buffer.from(received, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new ApiError(401, 'invalid_webhook_signature', 'Invalid Mercado Pago webhook signature');
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
