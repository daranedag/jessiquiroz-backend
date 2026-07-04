import ImageKit, { toFile } from '@imagekit/nodejs';
import { fileTypeFromBuffer } from 'file-type';
import { env, requireEnv } from '../config/env.js';
import { ApiError } from '../errors.js';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export type UploadedImage = {
  fileId: string;
  path: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export class ImageKitClient {
  private readonly client: ImageKit | null;

  constructor() {
    if (!env.IMAGEKIT_PRIVATE_KEY) {
      this.client = null;
      return;
    }
    this.client = new ImageKit({
      privateKey: env.IMAGEKIT_PRIVATE_KEY
    });
  }

  async healthCheck(): Promise<void> {
    requireEnv('IMAGEKIT_PRIVATE_KEY');
    requireEnv('IMAGEKIT_URL_ENDPOINT');
  }

  async upload(buffer: Buffer, originalName: string, preReservationId: string): Promise<UploadedImage> {
    if (!this.client) {
      throw new ApiError(503, 'imagekit_not_configured', 'ImageKit is not configured');
    }

    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !allowedMimeTypes.has(detected.mime)) {
      throw new ApiError(400, 'invalid_file_type', 'Only jpeg, png, webp, heic and heif images are allowed');
    }

    const maxBytes = env.UPLOAD_MAX_MB_PER_FILE * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      throw new ApiError(400, 'file_too_large', `Each image must be at most ${env.UPLOAD_MAX_MB_PER_FILE} MB`);
    }

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const response = await this.client.files.upload({
      file: await toFile(buffer, safeName),
      fileName: safeName,
      folder: `${env.IMAGEKIT_FOLDER}/${preReservationId}`,
      useUniqueFileName: true
    });

    return {
      fileId: response.fileId ?? '',
      path: response.filePath ?? '',
      url: response.url ?? '',
      mimeType: detected.mime,
      sizeBytes: response.size ?? buffer.byteLength,
      width: response.width ?? null,
      height: response.height ?? null
    };
  }

  async delete(fileId: string): Promise<void> {
    if (!this.client) {
      throw new ApiError(503, 'imagekit_not_configured', 'ImageKit is not configured');
    }
    await this.client.files.delete(fileId);
  }

  signedUrl(pathOrUrl: string): string {
    if (!this.client || !env.IMAGEKIT_URL_ENDPOINT) {
      return pathOrUrl;
    }
    return this.client.helper.buildSrc({
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
      src: pathOrUrl,
      signed: true,
      expiresIn: 60 * 30
    });
  }
}
