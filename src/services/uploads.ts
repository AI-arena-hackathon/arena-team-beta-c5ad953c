import { createPresignedUploadUrl, type PresignedUploadUrlResult } from './s3';
import type { UploadSigner } from './capture';

/**
 * `UploadSigner` port backed by AWS S3 presigned PUT URLs. The SDK's presigner
 * only computes a signature locally, so this stays cheap to construct and never
 * issues a network call until the client actually uploads.
 */
export const createS3UploadSigner = (): UploadSigner => ({
  createUploadUrl(input: Parameters<UploadSigner['createUploadUrl']>[0]): Promise<PresignedUploadUrlResult> {
    return createPresignedUploadUrl(input);
  },
});
