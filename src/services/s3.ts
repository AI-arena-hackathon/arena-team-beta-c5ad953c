import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsCredentials, getConfig } from '../config';
import { validateFileName, validatePathSegment, validateContentType, extractExtension } from '../utils/validation';
import { AppError } from '../utils/errors';

export class S3Error extends AppError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'S3Error';
  }
}

export class ObjectNotFoundError extends S3Error {
  constructor(key: string) {
    super(`Object not found: ${key}`, 'OBJECT_NOT_FOUND', 404);
    this.name = 'ObjectNotFoundError';
  }
}

export class S3ValidationError extends S3Error {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'S3ValidationError';
  }
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const config = getConfig();
    s3Client = new S3Client({
      region: config.aws.region,
      credentials: awsCredentials(config),
    });
  }
  return s3Client;
}

export function resetS3Client(): void {
  s3Client = null;
}

function getBucketName(): string {
  const bucket = getConfig().s3.bucketReceipts;
  if (!bucket) {
    throw new S3Error(
      'S3_BUCKET_RECEIPTS is not configured — set it to enable image uploads',
      'BUCKET_NOT_CONFIGURED',
      503
    );
  }
  return bucket;
}

function getPresignedUrlExpiry(): number {
  return getConfig().s3.presignedUrlExpiry;
}

export interface PresignedUploadUrlResult {
  uploadUrl: string;
  key: string;
  bucket: string;
  expiresIn: number;
}

export interface PresignedDownloadUrlResult {
  downloadUrl: string;
  key: string;
  bucket: string;
  expiresIn: number;
}

export interface UploadReceiptImageInput {
  userId: string;
  receiptId: string;
  contentType: string;
  fileName: string;
}

export interface DownloadReceiptImageInput {
  userId: string;
  receiptId: string;
  imageIndex: number;
}

export function generateReceiptImageKey(input: UploadReceiptImageInput): string {
  const { userId, receiptId, fileName } = input;
  const extension = extractExtension(fileName);
  return `receipts/${userId}/${receiptId}/image_${Date.now()}.${extension}`;
}

// Re-export validation functions for backward compatibility
export { validateFileName, validatePathSegment, validateContentType, isSafePathSegment } from '../utils/validation';

// Boolean-returning validators for backward compatibility with tests
export function validateContentTypeBoolean(contentType: string): boolean {
  try {
    validateContentType(contentType);
    return true;
  } catch {
    return false;
  }
}

export function validateFileNameBoolean(fileName: string): boolean {
  try {
    validateFileName(fileName);
    return true;
  } catch {
    return false;
  }
}

function wrapValidationError(error: unknown): never {
  if (error instanceof AppError) {
    throw new S3ValidationError(error.message);
  }
  throw error;
}

export async function createPresignedUploadUrl(input: UploadReceiptImageInput): Promise<PresignedUploadUrlResult> {
  try {
    validatePathSegment(input.userId, 'userId');
    validatePathSegment(input.receiptId, 'receiptId');
    validateContentType(input.contentType, 'contentType');
    validateFileName(input.fileName, 'fileName');
  } catch (error) {
    wrapValidationError(error);
  }

  const key = generateReceiptImageKey(input);
  const bucket = getBucketName();
  const expiresIn = getPresignedUrlExpiry();

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: input.contentType,
  });

  try {
    const uploadUrl = await getSignedUrl(client, command, { expiresIn });
    return { uploadUrl, key, bucket, expiresIn };
  } catch (error) {
    throw new S3Error(
      `Failed to create presigned upload URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'PRESIGNED_URL_CREATE_FAILED'
    );
  }
}

export async function createPresignedDownloadUrl(input: DownloadReceiptImageInput): Promise<PresignedDownloadUrlResult> {
  try {
    validatePathSegment(input.userId, 'userId');
    validatePathSegment(input.receiptId, 'receiptId');
  } catch (error) {
    wrapValidationError(error);
  }
  if (!Number.isInteger(input.imageIndex) || input.imageIndex < 0) {
    throw new S3ValidationError('imageIndex must be a non-negative integer');
  }

  const key = `receipts/${input.userId}/${input.receiptId}/image_${input.imageIndex}`;
  const bucket = getBucketName();
  const expiresIn = getPresignedUrlExpiry();

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  try {
    const downloadUrl = await getSignedUrl(client, command, { expiresIn });
    return { downloadUrl, key, bucket, expiresIn };
  } catch (error) {
    throw new S3Error(
      `Failed to create presigned download URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'PRESIGNED_URL_CREATE_FAILED'
    );
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!key || typeof key !== 'string') {
    throw new S3ValidationError('key is required');
  }

  const client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  try {
    await client.send(command);
  } catch (error) {
    throw new S3Error(
      `Failed to delete object: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'DELETE_FAILED'
    );
  }
}

export async function objectExists(key: string): Promise<boolean> {
  if (!key || typeof key !== 'string') {
    throw new S3ValidationError('key is required');
  }

  const client = getS3Client();
  const command = new HeadObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  try {
    await client.send(command);
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFound') {
      return false;
    }
    throw new S3Error(
      `Failed to check object existence: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'HEAD_FAILED'
    );
  }
}

export async function getObjectMetadata(key: string): Promise<{ contentType: string; contentLength: number; lastModified: Date } | null> {
  if (!key || typeof key !== 'string') {
    throw new S3ValidationError('key is required');
  }

  const client = getS3Client();
  const command = new HeadObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  try {
    const result = await client.send(command);
    return {
      contentType: result.ContentType || 'application/octet-stream',
      contentLength: result.ContentLength || 0,
      lastModified: result.LastModified || new Date(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFound') {
      return null;
    }
    throw new S3Error(
      `Failed to get object metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'HEAD_FAILED'
    );
  }
}