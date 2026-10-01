import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../config';
import { isSupportedReceiptImageType } from '../types/receipt';

export class S3Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
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
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }
  return s3Client;
}

export function resetS3Client(): void {
  s3Client = null;
}

function getBucketName(): string {
  return getConfig().s3.bucketReceipts;
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

const SAFE_EXTENSION = /^[a-z0-9]{1,8}$/;

export function generateReceiptImageKey(input: UploadReceiptImageInput): string {
  const { userId, receiptId, fileName } = input;
  const parts = fileName.split('.');
  const rawExtension = parts.length > 1 ? parts[parts.length - 1] : '';
  const extension = SAFE_EXTENSION.test(rawExtension.toLowerCase()) ? rawExtension.toLowerCase() : 'jpg';
  return `receipts/${userId}/${receiptId}/image_${Date.now()}.${extension}`;
}

export function validateContentType(contentType: string): boolean {
  return isSupportedReceiptImageType(contentType);
}

export function validateFileName(fileName: string): boolean {
  if (!fileName || fileName.length > 255) return false;
  if (/[<>:"|?*]/.test(fileName)) return false;
  for (let index = 0; index < fileName.length; index += 1) {
    if (fileName.charCodeAt(index) < 0x20 || fileName.charCodeAt(index) === 0x7f) return false;
  }
  return true;
}

export function isSafePathSegment(segment: string): boolean {
  return segment.length > 0 && segment.length <= 128 && /^[A-Za-z0-9_.-]+$/.test(segment);
}

export async function createPresignedUploadUrl(input: UploadReceiptImageInput): Promise<PresignedUploadUrlResult> {
  if (typeof input.userId !== 'string' || !isSafePathSegment(input.userId)) {
    throw new S3ValidationError('userId must be a safe path segment');
  }
  if (typeof input.receiptId !== 'string' || !isSafePathSegment(input.receiptId)) {
    throw new S3ValidationError('receiptId must be a safe path segment');
  }
  if (!input.contentType || !validateContentType(input.contentType)) {
    throw new S3ValidationError(`Invalid contentType: ${input.contentType}. Allowed: image/jpeg, image/png, image/webp, image/heic`);
  }
  if (!input.fileName || !validateFileName(input.fileName)) {
    throw new S3ValidationError('Invalid fileName');
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
  if (typeof input.userId !== 'string' || !isSafePathSegment(input.userId)) {
    throw new S3ValidationError('userId is required');
  }
  if (typeof input.receiptId !== 'string' || !isSafePathSegment(input.receiptId)) {
    throw new S3ValidationError('receiptId is required');
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