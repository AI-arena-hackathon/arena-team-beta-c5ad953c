import { randomBytes } from 'crypto';
import { createPresignedUploadUrl, type PresignedUploadUrlResult } from './s3';
import { CaptureError, type UploadSigner } from './capture';
import { MEMORY_IMAGE_BUCKET, type ImageStore } from './object-store';
import { isSafePathSegment } from './s3';

export type UploadSignerInput = Parameters<UploadSigner['createUploadUrl']>[0];

/**
 * `UploadSigner` port backed by AWS S3 presigned PUT URLs. The SDK's presigner
 * only computes a signature locally, so this stays cheap to construct and never
 * issues a network call until the client actually uploads.
 */
export const createS3UploadSigner = (): UploadSigner => ({
  createUploadUrl(input: UploadSignerInput): Promise<PresignedUploadUrlResult> {
    return createPresignedUploadUrl(input);
  },
});

/**
 * `UploadSigner` port backed by the local image store: hands back a same-origin
 * PUT URL served by `/api/uploads/:token`. Lets the whole capture flow run with
 * no AWS account (`UPLOAD_SIGNER=memory`, the default in development).
 */
export function createMemoryUploadSigner(imageStore: ImageStore, ttlSeconds = 3600): UploadSigner {
  return {
    createUploadUrl(input: UploadSignerInput) {
      try {
        if (!isSafePathSegment(input.userId) || !isSafePathSegment(input.receiptId)) {
          throw new CaptureError('userId and receiptId must be safe path segments', 'VALIDATION_ERROR', 400);
        }
      } catch (error) {
        return Promise.reject(error);
      }
      const token = randomBytes(16).toString('hex');
      imageStore.reserve(token, { userId: input.userId, receiptId: input.receiptId });
      return Promise.resolve({
        uploadUrl: `/api/uploads/${token}`,
        key: `memory://${token}`,
        bucket: MEMORY_IMAGE_BUCKET,
        expiresIn: ttlSeconds,
      });
    },
  };
}
