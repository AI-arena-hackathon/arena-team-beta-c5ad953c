import {
  MAX_RECEIPT_IMAGE_BYTES,
  type Receipt,
  type ReceiptImage,
} from '../types/receipt';
import type { ReceiptStore } from './store';
import {
  validateUserId,
  validatePositiveNumber,
  validateFileName,
  validateContentType,
  validateReceiptId,
  startOfCurrentMonth as sharedStartOfCurrentMonth,
} from '../utils/validation';
import { AppError } from '../utils/errors';

export class CaptureError extends AppError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
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

function monthlyLimitOf(deps: CaptureDeps): number {
  return deps.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT;
}

export function generateReceiptId(): string {
  return `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function startOfCurrentMonth(now: Date = new Date()): string {
  return sharedStartOfCurrentMonth(now);
}

function assertSafeUserId(userId: unknown): string {
  try {
    return validateUserId(userId, 'userId');
  } catch (error) {
    if (error instanceof AppError) {
      throw new CaptureError(error.message, error.code, error.statusCode);
    }
    throw error;
  }
}

function validateImage(image: CaptureImageInput): void {
  if (!image || typeof image !== 'object') {
    throw new CaptureError('image is required', 'VALIDATION_ERROR', 400);
  }
  try {
    validateFileName(image.fileName, 'image.fileName');
    validateContentType(image.contentType, 'image.contentType');
    const size = validatePositiveNumber(image.size, 'image.size');
    if (size > MAX_RECEIPT_IMAGE_BYTES) {
      throw new CaptureError(
        `Image exceeds the ${MAX_RECEIPT_IMAGE_BYTES} byte limit`,
        'IMAGE_TOO_LARGE',
        413
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw new CaptureError(error.message, error.code, error.statusCode);
    }
    throw error;
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
 * Escape hatch for the client: a receipt that never got its bytes (a dropped
 * connection, a bad photo) is deleted instead of lingering as a `pending` row
 * that silently eats one of the month's receipts. Only `pending` receipts may
 * be discarded — once the upload is confirmed the record is real data.
 */
export async function discardPendingUpload(
  receiptId: string,
  userId: string,
  deps: CaptureDeps
): Promise<Receipt> {
  const safeUserId = assertSafeUserId(userId);
  validateReceiptId(receiptId, 'receiptId');

  let current: Receipt | null;
  try {
    current = await deps.store.get(receiptId, safeUserId);
  } catch (error) {
    console.error('Receipt store failed while loading a pending upload for discard:', error);
    throw new CaptureError('Could not load the pending upload', 'DISCARD_FAILED', 500);
  }
  if (!current) {
    throw new CaptureError(`Receipt not found: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
  }
  if (current.status !== 'pending') {
    throw new CaptureError(
      `Only a pending upload can be discarded (status: ${current.status})`,
      'UPLOAD_NOT_PENDING',
      409
    );
  }

  let removed: boolean;
  try {
    removed = await deps.store.remove(receiptId, safeUserId);
  } catch (error) {
    console.error('Receipt store failed while discarding a pending upload:', error);
    throw new CaptureError('Could not discard the pending upload', 'DISCARD_FAILED', 500);
  }
  if (!removed) {
    // The row vanished between the read and the delete; treat it as a miss
    // rather than a server fault so the client can stop offering the reclaim.
    throw new CaptureError(`Receipt not found: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
  }

  // Destructive and identity-scoped: leave a trail even though auth is a dev
  // placeholder, so the audit exists before real auth does.
  console.info(
    JSON.stringify({
      event: 'receipt.discard',
      receiptId: current.receiptId,
      userId: safeUserId,
      images: current.images.length,
    })
  );
  return current;
}

/**
 * Step 2 of the capture flow: the client confirms the bytes landed in S3, so the
 * receipt moves to `processing` and the OCR pipeline is free to pick it up.
 */
export async function completeUpload(receiptId: string, userId: string, deps: CaptureDeps): Promise<Receipt> {
  const safeUserId = assertSafeUserId(userId);
  validateReceiptId(receiptId, 'receiptId');

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
