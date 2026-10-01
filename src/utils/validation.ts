import { AppError } from './errors';

export const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
export const UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
export const FILE_NAME_MAX_LENGTH = 255;

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type SupportedImageType = typeof SUPPORTED_IMAGE_TYPES[number];

export const RECEIPT_STATUS_VALUES = ['pending', 'processing', 'completed', 'failed', 'archived'] as const;
export type ReceiptStatus = typeof RECEIPT_STATUS_VALUES[number];

export function isSupportedImageType(contentType: string): contentType is SupportedImageType {
  return SUPPORTED_IMAGE_TYPES.includes(contentType as SupportedImageType);
}

export function isSafeUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && USER_ID_PATTERN.test(userId);
}

export function isSafePathSegment(segment: unknown): segment is string {
  return typeof segment === 'string' && SAFE_PATH_SEGMENT_PATTERN.test(segment);
}

export function isValidUploadToken(token: unknown): token is string {
  return typeof token === 'string' && UPLOAD_TOKEN_PATTERN.test(token);
}

export function validateUserId(userId: unknown, paramName = 'userId'): string {
  if (!isSafeUserId(userId)) {
    throw new AppError(`${paramName} must be 1-128 chars of A-Z, a-z, 0-9, _ or -`, 'VALIDATION_ERROR', 400);
  }
  return userId;
}

export function validatePathSegment(segment: unknown, paramName = 'segment'): string {
  if (!isSafePathSegment(segment)) {
    throw new AppError(`${paramName} must be a safe path segment (1-128 chars, A-Z, a-z, 0-9, _, ., -)`, 'VALIDATION_ERROR', 400);
  }
  return segment;
}

export function validateUploadToken(token: unknown, paramName = 'token'): string {
  if (!isValidUploadToken(token)) {
    throw new AppError(`${paramName} must be a valid upload token`, 'VALIDATION_ERROR', 400);
  }
  return token;
}

export function validateFileName(fileName: unknown, paramName = 'fileName'): string {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > FILE_NAME_MAX_LENGTH) {
    throw new AppError(`${paramName} is required and must be at most ${FILE_NAME_MAX_LENGTH} chars`, 'VALIDATION_ERROR', 400);
  }
  if (/[<>:"|?*]/.test(fileName)) {
    throw new AppError(`${paramName} contains invalid characters`, 'VALIDATION_ERROR', 400);
  }
  for (let i = 0; i < fileName.length; i++) {
    if (fileName.charCodeAt(i) < 0x20 || fileName.charCodeAt(i) === 0x7f) {
      throw new AppError(`${paramName} contains control characters`, 'VALIDATION_ERROR', 400);
    }
  }
  return fileName;
}

export function validateContentType(contentType: unknown, paramName = 'contentType'): SupportedImageType {
  if (typeof contentType !== 'string' || !isSupportedImageType(contentType)) {
    throw new AppError(`Unsupported ${paramName}: ${String(contentType)}`, 'VALIDATION_ERROR', 400);
  }
  return contentType;
}

export function validatePositiveNumber(value: unknown, paramName = 'value'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AppError(`${paramName} must be a positive number`, 'VALIDATION_ERROR', 400);
  }
  return value;
}

export function validatePositiveInteger(value: unknown, paramName = 'value', max?: number): number {
  const num = validatePositiveNumber(value, paramName);
  if (!Number.isInteger(num)) {
    throw new AppError(`${paramName} must be an integer`, 'VALIDATION_ERROR', 400);
  }
  if (max !== undefined && num > max) {
    throw new AppError(`${paramName} must be at most ${max}`, 'VALIDATION_ERROR', 400);
  }
  return num;
}

export function validateReceiptId(receiptId: unknown, paramName = 'receiptId'): string {
  // Receipt ids are also path segments in the S3 key, so the same rule applies.
  return validatePathSegment(receiptId, paramName);
}

export function validateStatus(status: unknown, paramName = 'status'): ReceiptStatus | undefined {
  if (status === undefined) return undefined;
  const candidate: unknown = Array.isArray(status) ? status[0] : status;
  if (typeof candidate !== 'string' || !RECEIPT_STATUS_VALUES.includes(candidate as ReceiptStatus)) {
    throw new AppError(`${paramName} must be one of: ${RECEIPT_STATUS_VALUES.join(', ')}`, 'VALIDATION_ERROR', 400);
  }
  return candidate as ReceiptStatus;
}

export function extractExtension(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length <= 1) return 'jpg';
  const ext = parts[parts.length - 1].toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'jpg';
}

export function generateReceiptImageKey(userId: string, receiptId: string, fileName: string): string {
  const extension = extractExtension(fileName);
  return `receipts/${userId}/${receiptId}/image_${Date.now()}.${extension}`;
}

export function startOfCurrentMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}