import {
  MAX_RECEIPT_IMAGE_BYTES,
  isSupportedReceiptImageType,
  type Receipt,
  type ReceiptImage,
} from '../types/receipt';
import type { ReceiptStore } from './store';

export class CaptureError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface CaptureImageInput {
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface CaptureRequest {
  userId: string;
  image: CaptureImageInput;
}

export interface ReceiptUploadGrant {
  uploadUrl: string;
  key: string;
  bucket: string;
  expiresIn: number;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface CaptureResult {
  receipt: Receipt;
  upload: ReceiptUploadGrant;
}

/** Port for anything that can sign an image upload (S3 today, a local disk later). */
export interface UploadSigner {
  createUploadUrl(input: {
    userId: string;
    receiptId: string;
    contentType: string;
    fileName: string;
  }): Promise<{ uploadUrl: string; key: string; bucket: string; expiresIn: number }>;
}

export interface CaptureDeps {
  store: ReceiptStore;
  uploadSigner: UploadSigner;
  monthlyLimit?: number;
}

export const DEFAULT_MONTHLY_LIMIT = 50;

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function monthlyLimitOf(deps: CaptureDeps): number {
  return deps.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT;
}

export function generateReceiptId(): string {
  return `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function startOfCurrentMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function assertSafeUserId(userId: unknown): string {
  if (typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) {
    throw new CaptureError('userId must be 1-128 chars of A-Z, a-z, 0-9, _ or -', 'VALIDATION_ERROR', 400);
  }
  return userId;
}

function validateImage(image: CaptureImageInput): void {
  if (!image || typeof image !== 'object') {
    throw new CaptureError('image is required', 'VALIDATION_ERROR', 400);
  }
  if (!image.fileName || typeof image.fileName !== 'string' || image.fileName.length > 255) {
    throw new CaptureError('image.fileName is required and must be at most 255 chars', 'VALIDATION_ERROR', 400);
  }
  if (!isSupportedReceiptImageType(image.contentType)) {
    throw new CaptureError(
      `Unsupported image contentType: ${image.contentType}`,
      'VALIDATION_ERROR',
      400
    );
  }
  if (typeof image.size !== 'number' || !Number.isFinite(image.size) || image.size <= 0) {
    throw new CaptureError('image.size must be a positive number of bytes', 'VALIDATION_ERROR', 400);
  }
  if (image.size > MAX_RECEIPT_IMAGE_BYTES) {
    throw new CaptureError(
      `Image exceeds the ${MAX_RECEIPT_IMAGE_BYTES} byte limit`,
      'IMAGE_TOO_LARGE',
      413
    );
  }
}

/** Receipts captured since the first instant of the current UTC calendar month. */
export async function countReceiptsThisMonth(
  userId: string,
  store: ReceiptStore,
  now: Date = new Date()
): Promise<number> {
  const result = await store.list({ userId, startDate: startOfCurrentMonth(now), limit: 1000 });
  return result.count;
}

export interface MonthlyUsage {
  used: number;
  limit: number;
  remaining: number;
}

export async function getMonthlyUsage(userId: string, deps: CaptureDeps): Promise<MonthlyUsage> {
  const safeUserId = assertSafeUserId(userId);
  const limit = monthlyLimitOf(deps);
  const used = await countReceiptsThisMonth(safeUserId, deps.store);
  return { used, limit, remaining: Math.max(limit - used, 0) };
}

/**
 * Step 1 of the capture flow: reserve the receipt record, sign an upload URL for the
 * image, and hand both back to the client. Nothing is persisted unless signing
 * succeeded, so a failed sign never leaves a phantom receipt behind.
 */
export async function captureReceipt(request: CaptureRequest, deps: CaptureDeps): Promise<CaptureResult> {
  const userId = assertSafeUserId(request?.userId);
  validateImage(request.image);

  const limit = monthlyLimitOf(deps);
  const used = await countReceiptsThisMonth(userId, deps.store);
  if (used >= limit) {
    throw new CaptureError(
      `Monthly free-tier limit of ${limit} receipts reached`,
      'MONTHLY_LIMIT_REACHED',
      429
    );
  }

  const receiptId = generateReceiptId();
  const now = new Date().toISOString();

  let signed: { uploadUrl: string; key: string; bucket: string; expiresIn: number };
  try {
    signed = await deps.uploadSigner.createUploadUrl({
      userId,
      receiptId,
      contentType: request.image.contentType,
      fileName: request.image.fileName,
    });
  } catch (error) {
    console.error('Upload signing failed:', error);
    throw new CaptureError('Could not sign an upload URL for the receipt image', 'UPLOAD_SIGNING_FAILED', 502);
  }

  const image: ReceiptImage = {
    s3Key: signed.key,
    s3Bucket: signed.bucket,
    contentType: request.image.contentType,
    size: Math.round(request.image.size),
  };
  if (typeof request.image.width === 'number') image.width = Math.round(request.image.width);
  if (typeof request.image.height === 'number') image.height = Math.round(request.image.height);

  const receipt: Receipt = {
    receiptId,
    userId,
    metadata: {
      merchantName: '',
      transactionDate: now.slice(0, 10),
      subtotal: 0,
      tax: 0,
      total: 0,
      currency: 'USD',
    },
    lineItems: [],
    images: [image],
    categories: [],
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  try {
    const saved = await deps.store.save(receipt);
    return {
      receipt: saved,
      upload: {
        uploadUrl: signed.uploadUrl,
        key: signed.key,
        bucket: signed.bucket,
        expiresIn: signed.expiresIn,
        method: 'PUT',
        headers: { 'Content-Type': request.image.contentType },
      },
    };
  } catch (error) {
    console.error('Receipt store failed during capture:', error);
    throw new CaptureError('Could not store the captured receipt', 'CAPTURE_FAILED', 500);
  }
}

/**
 * Step 2 of the capture flow: the client confirms the bytes landed in S3, so the
 * receipt moves to `processing` and the OCR pipeline is free to pick it up.
 */
export async function completeUpload(receiptId: string, userId: string, deps: CaptureDeps): Promise<Receipt> {
  const safeUserId = assertSafeUserId(userId);
  if (typeof receiptId !== 'string' || receiptId.length === 0 || receiptId.length > 128) {
    throw new CaptureError('receiptId is required', 'VALIDATION_ERROR', 400);
  }

  const current = await deps.store.get(receiptId, safeUserId);
  if (!current) {
    throw new CaptureError(`Receipt not found: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
  }
  if (current.status !== 'pending') {
    throw new CaptureError(
      `Upload already confirmed (status: ${current.status})`,
      'UPLOAD_ALREADY_CONFIRMED',
      409
    );
  }

  const updated = await deps.store.update(receiptId, safeUserId, { status: 'processing' });
  if (!updated) {
    throw new CaptureError(`Receipt not found: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
  }
  return updated;
}
