import { CaptureError } from './capture';
import { MAX_RECEIPT_IMAGE_BYTES, isSupportedReceiptImageType } from '../types/receipt';

export const MEMORY_IMAGE_BUCKET = 'memory-images';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;

export class ImageStoreError extends CaptureError {
  constructor(message: string, code: string, statusCode = 400) {
    super(message, code, statusCode);
    this.name = 'ImageStoreError';
  }
}

export interface StoredImage {
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface ImageOwner {
  userId: string;
  receiptId: string;
}

/**
 * Port for raw receipt image bytes. In production the device PUTs bytes straight
 * to S3 with a presigned URL, so no ImageStore adapter is needed there; this
 * interface exists so local development and tests can run the same capture flow
 * without an AWS account.
 */
export interface ImageStore {
  /** Claim an upload token for an owner before the bytes arrive. */
  reserve(token: string, owner: ImageOwner): void;
  put(token: string, contentType: string, body: Buffer): Promise<StoredImage>;
  get(token: string): Promise<Buffer | null>;
  stat(token: string): Promise<StoredImage | null>;
  ownerOf(token: string): Promise<ImageOwner | null>;
}

export interface MemoryImageStoreOptions {
  maxBytes?: number;
}

export function isValidUploadToken(token: string): boolean {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** In-memory image store: fake for tests, local-dev backend for the capture flow. */
export function createMemoryImageStore(options: MemoryImageStoreOptions = {}): ImageStore {
  const maxBytes = options.maxBytes ?? MAX_RECEIPT_IMAGE_BYTES;
  const objects = new Map<
    string,
    { contentType: string; body: Buffer; uploadedAt: string; owner: ImageOwner | null }
  >();

  const assertToken = (token: string): void => {
    if (!isValidUploadToken(token)) {
      throw new ImageStoreError('Invalid upload token', 'VALIDATION_ERROR', 400);
    }
  };

  return {
    reserve(token: string, owner: ImageOwner): void {
      assertToken(token);
      const existing = objects.get(token);
      objects.set(token, {
        contentType: existing?.contentType ?? '',
        body: existing?.body ?? Buffer.alloc(0),
        uploadedAt: existing?.uploadedAt ?? new Date().toISOString(),
        owner,
      });
    },

    put(token: string, contentType: string, body: Buffer): Promise<StoredImage> {
      // Validation failures become rejected promises so callers only ever need
      // one error path, whether they call this synchronously or await it.
      try {
        assertToken(token);
        if (!isSupportedReceiptImageType(contentType)) {
          throw new ImageStoreError(`Unsupported contentType: ${contentType}`, 'VALIDATION_ERROR', 400);
        }
        if (!Buffer.isBuffer(body) || body.length === 0) {
          throw new ImageStoreError('Uploaded image is empty', 'VALIDATION_ERROR', 400);
        }
        if (body.length > maxBytes) {
          throw new ImageStoreError(`Image exceeds the ${maxBytes} byte limit`, 'IMAGE_TOO_LARGE', 413);
        }
        const reserved = objects.get(token);
        const uploadedAt = new Date().toISOString();
        objects.set(token, { contentType, body, uploadedAt, owner: reserved?.owner ?? null });
        return Promise.resolve({ contentType, size: body.length, uploadedAt });
      } catch (error) {
        return Promise.reject(error);
      }
    },

    get(token: string): Promise<Buffer | null> {
      try {
        assertToken(token);
        const stored = objects.get(token);
        return Promise.resolve(stored && stored.body.length > 0 ? stored.body : null);
      } catch (error) {
        return Promise.reject(error);
      }
    },

    stat(token: string): Promise<StoredImage | null> {
      try {
        assertToken(token);
        const stored = objects.get(token);
        if (!stored || stored.body.length === 0) return Promise.resolve(null);
        return Promise.resolve({
          contentType: stored.contentType,
          size: stored.body.length,
          uploadedAt: stored.uploadedAt,
        });
      } catch (error) {
        return Promise.reject(error);
      }
    },

    ownerOf(token: string): Promise<ImageOwner | null> {
      try {
        assertToken(token);
        return Promise.resolve(objects.get(token)?.owner ?? null);
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
