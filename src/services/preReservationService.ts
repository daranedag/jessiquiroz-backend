import { addMinutes } from 'date-fns';
import { env } from '../config/env.js';
import { ApiError, assertFound } from '../errors.js';
import type { ImageKitClient } from '../integrations/imageKit.js';
import type { BookingRepository } from '../repositories/bookingRepository.js';
import { createCustomerToken, hashReservationToken, verifyReservationToken } from '../security/tokens.js';
import type { ClientInfo, PreReservation, ReservationImage } from '../types/domain.js';
import type { AvailabilityService } from './availabilityService.js';

export class PreReservationService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly availability: AvailabilityService,
    private readonly imageKit: ImageKitClient
  ) {}

  async create(input: {
    serviceId: string;
    startsAt: string;
    timezone: string;
    client: ClientInfo;
  }): Promise<{ preReservation: PreReservation; customerToken: string }> {
    const service = assertFound(await this.repository.getService(input.serviceId), 'Service not found');
    const slot = await this.availability.assertSlotAvailable(service, input.startsAt, input.timezone);
    const customerToken = createCustomerToken();

    const preReservation = await this.repository.createPreReservation({
      service_id: service.id,
      client_name: input.client.fullName,
      client_email: input.client.email,
      client_phone: input.client.phone ?? null,
      client_notes: input.client.notes ?? null,
      form_data: input.client.formData ?? {},
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      timezone: input.timezone,
      status: 'awaiting_payment',
      expires_at: addMinutes(new Date(), env.PRE_RESERVATION_TTL_MINUTES).toISOString(),
      customer_token_hash: hashReservationToken(customerToken)
    });

    return { preReservation, customerToken };
  }

  async getForCustomer(id: string, token: string): Promise<PreReservation> {
    const preReservation = assertFound(await this.repository.getPreReservation(id), 'Pre-reservation not found');
    this.assertValidToken(preReservation, token);
    return preReservation;
  }

  async updateForCustomer(id: string, token: string, input: Partial<ClientInfo>): Promise<PreReservation> {
    const preReservation = await this.getForCustomer(id, token);
    if (preReservation.status !== 'awaiting_payment' && preReservation.status !== 'draft') {
      throw new ApiError(409, 'pre_reservation_locked', 'Only draft or awaiting_payment pre-reservations can be edited');
    }

    const updated = await this.repository.updatePreReservation(id, {
      client_name: input.fullName ?? preReservation.client_name,
      client_email: input.email ?? preReservation.client_email,
      client_phone: input.phone === undefined ? preReservation.client_phone : input.phone,
      client_notes: input.notes === undefined ? preReservation.client_notes : input.notes,
      form_data: input.formData ?? preReservation.form_data
    });
    return assertFound(updated, 'Pre-reservation not found');
  }

  async uploadImages(id: string, token: string, files: Express.Multer.File[]): Promise<ReservationImage[]> {
    const preReservation = await this.getForCustomer(id, token);
    if (preReservation.status !== 'awaiting_payment' && preReservation.status !== 'draft') {
      throw new ApiError(409, 'pre_reservation_locked', 'Images can only be uploaded before payment confirmation');
    }
    if (files.length === 0) {
      throw new ApiError(400, 'missing_files', 'At least one image is required');
    }

    const existing = await this.repository.listImages(id);
    if (existing.length + files.length > env.UPLOAD_MAX_FILES) {
      throw new ApiError(400, 'too_many_files', `A maximum of ${env.UPLOAD_MAX_FILES} images is allowed`);
    }

    const images: ReservationImage[] = [];
    for (const file of files) {
      const uploaded = await this.imageKit.upload(file.buffer, file.originalname, id);
      images.push(
        await this.repository.createImage({
          pre_reservation_id: id,
          imagekit_file_id: uploaded.fileId,
          imagekit_path: uploaded.path,
          url: uploaded.url,
          mime_type: uploaded.mimeType,
          size_bytes: uploaded.sizeBytes,
          width: uploaded.width,
          height: uploaded.height,
          status: 'active'
        })
      );
    }
    return images;
  }

  async deleteImage(id: string, token: string, imageId: string): Promise<void> {
    const preReservation = await this.getForCustomer(id, token);
    if (preReservation.status !== 'awaiting_payment' && preReservation.status !== 'draft') {
      throw new ApiError(409, 'pre_reservation_locked', 'Images can only be deleted before payment confirmation');
    }
    const image = assertFound(await this.repository.getImage(imageId), 'Image not found');
    if (image.pre_reservation_id !== id) {
      throw new ApiError(404, 'image_not_found', 'Image not found');
    }
    await this.imageKit.delete(image.imagekit_file_id);
    await this.repository.updateImage(imageId, { status: 'deleted' });
  }

  assertValidToken(preReservation: PreReservation, token: string): void {
    if (!verifyReservationToken(token, preReservation.customer_token_hash)) {
      throw new ApiError(401, 'invalid_reservation_token', 'Invalid reservation token');
    }
  }
}
