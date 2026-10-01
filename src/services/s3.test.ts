import {
  UploadReceiptImageInput,
  DownloadReceiptImageInput,
  PresignedUploadUrlResult,
  PresignedDownloadUrlResult,
} from './s3';

const validUploadInput: UploadReceiptImageInput = {
  userId: 'user_456',
  receiptId: 'receipt_123',
  contentType: 'image/jpeg',
  fileName: 'receipt.jpg',
};

const validDownloadInput: DownloadReceiptImageInput = {
  userId: 'user_456',
  receiptId: 'receipt_123',
  imageIndex: 0,
};

const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((args) => args),
  GetObjectCommand: jest.fn().mockImplementation((args) => args),
  DeleteObjectCommand: jest.fn().mockImplementation((args) => args),
  HeadObjectCommand: jest.fn().mockImplementation((args) => args),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

jest.mock('../config', () => ({
  awsCredentials: jest.fn((config: { aws: { accessKeyId?: string; secretAccessKey?: string } }) =>
    config.aws.accessKeyId && config.aws.secretAccessKey
      ? { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey }
      : undefined
  ),
  getConfig: jest.fn(() => ({
    aws: {
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
    s3: {
      bucketReceipts: 'test-receipts-bucket',
      presignedUrlExpiry: 3600,
    },
  })),
}));

import * as s3Module from './s3';
import { getConfig } from '../config';

describe('S3 Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
    s3Module.resetS3Client();
  });

  describe('generateReceiptImageKey', () => {
    it('should generate a key with userId, receiptId, and timestamp', () => {
      const key = s3Module.generateReceiptImageKey(validUploadInput);
      expect(key).toMatch(/^receipts\/user_456\/receipt_123\/image_\d+\.jpg$/);
    });

    it('should handle different file extensions', () => {
      const input = { ...validUploadInput, fileName: 'receipt.png' };
      const key = s3Module.generateReceiptImageKey(input);
      expect(key).toMatch(/\.png$/);
    });

    it('should handle file names without extension', () => {
      const input = { ...validUploadInput, fileName: 'receipt' };
      const key = s3Module.generateReceiptImageKey(input);
      expect(key).toMatch(/\.jpg$/);
    });
  });

  describe('validateContentTypeBoolean', () => {
    it('should return true for allowed content types', () => {
      expect(s3Module.validateContentTypeBoolean('image/jpeg')).toBe(true);
      expect(s3Module.validateContentTypeBoolean('image/png')).toBe(true);
      expect(s3Module.validateContentTypeBoolean('image/webp')).toBe(true);
      expect(s3Module.validateContentTypeBoolean('image/heic')).toBe(true);
    });

    it('should return false for disallowed content types', () => {
      expect(s3Module.validateContentTypeBoolean('application/pdf')).toBe(false);
      expect(s3Module.validateContentTypeBoolean('text/plain')).toBe(false);
      expect(s3Module.validateContentTypeBoolean('video/mp4')).toBe(false);
      expect(s3Module.validateContentTypeBoolean('')).toBe(false);
    });
  });

  describe('validateFileNameBoolean', () => {
    it('should return true for valid file names', () => {
      expect(s3Module.validateFileNameBoolean('receipt.jpg')).toBe(true);
      expect(s3Module.validateFileNameBoolean('my-receipt_123.png')).toBe(true);
      expect(s3Module.validateFileNameBoolean('a'.repeat(255))).toBe(true);
    });

    it('should return false for invalid file names', () => {
      expect(s3Module.validateFileNameBoolean('')).toBe(false);
      expect(s3Module.validateFileNameBoolean('a'.repeat(256))).toBe(false);
      expect(s3Module.validateFileNameBoolean('file<name>.jpg')).toBe(false);
      expect(s3Module.validateFileNameBoolean('file>name.jpg')).toBe(false);
      expect(s3Module.validateFileNameBoolean('file:name.jpg')).toBe(false);
      expect(s3Module.validateFileNameBoolean('file"name.jpg')).toBe(false);
      expect(s3Module.validateFileNameBoolean('file|name.jpg')).toBe(false);
      expect(s3Module.validateFileNameBoolean('file?name.jpg')).toBe(false);
      expect(s3Module.validateFileNameBoolean('file*name.jpg')).toBe(false);
    });
  });

  describe('createPresignedUploadUrl', () => {
    it('should create a presigned upload URL successfully', async () => {
      const mockUrl = 'https://test-bucket.s3.amazonaws.com/receipts/user_456/receipt_123/image_123.jpg?signature=abc';
      mockGetSignedUrl.mockResolvedValueOnce(mockUrl);

      const result = await s3Module.createPresignedUploadUrl(validUploadInput);

      expect(result).toEqual({
        uploadUrl: mockUrl,
        key: expect.stringMatching(/^receipts\/user_456\/receipt_123\/image_\d+\.jpg$/),
        bucket: 'test-receipts-bucket',
        expiresIn: 3600,
      });
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should throw S3ValidationError for missing userId', async () => {
      const input = { ...validUploadInput, userId: '' };
      await expect(s3Module.createPresignedUploadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3ValidationError for missing receiptId', async () => {
      const input = { ...validUploadInput, receiptId: '' };
      await expect(s3Module.createPresignedUploadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3ValidationError for invalid contentType', async () => {
      const input = { ...validUploadInput, contentType: 'application/pdf' };
      await expect(s3Module.createPresignedUploadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3ValidationError for invalid fileName', async () => {
      const input = { ...validUploadInput, fileName: 'file<name>.jpg' };
      await expect(s3Module.createPresignedUploadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3Error when getSignedUrl fails', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Network error'));

      await expect(s3Module.createPresignedUploadUrl(validUploadInput)).rejects.toThrow(s3Module.S3Error);
      try {
        await s3Module.createPresignedUploadUrl(validUploadInput);
      } catch (err) {
        expect(err).toBeInstanceOf(s3Module.S3Error);
        expect((err as s3Module.S3Error).code).toBe('PRESIGNED_URL_CREATE_FAILED');
      }
    });
  });

  describe('createPresignedDownloadUrl', () => {
    it('should create a presigned download URL successfully', async () => {
      const mockUrl = 'https://test-bucket.s3.amazonaws.com/receipts/user_456/receipt_123/image_0?signature=abc';
      mockGetSignedUrl.mockResolvedValueOnce(mockUrl);

      const result = await s3Module.createPresignedDownloadUrl(validDownloadInput);

      expect(result).toEqual({
        downloadUrl: mockUrl,
        key: 'receipts/user_456/receipt_123/image_0',
        bucket: 'test-receipts-bucket',
        expiresIn: 3600,
      });
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should throw S3ValidationError for missing userId', async () => {
      const input = { ...validDownloadInput, userId: '' };
      await expect(s3Module.createPresignedDownloadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3ValidationError for missing receiptId', async () => {
      const input = { ...validDownloadInput, receiptId: '' };
      await expect(s3Module.createPresignedDownloadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3ValidationError for negative imageIndex', async () => {
      const input = { ...validDownloadInput, imageIndex: -1 };
      await expect(s3Module.createPresignedDownloadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3ValidationError for non-integer imageIndex', async () => {
      const input = { ...validDownloadInput, imageIndex: 1.5 as any };
      await expect(s3Module.createPresignedDownloadUrl(input)).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3Error when getSignedUrl fails', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Network error'));

      await expect(s3Module.createPresignedDownloadUrl(validDownloadInput)).rejects.toThrow(s3Module.S3Error);
    });
  });

  describe('deleteObject', () => {
    it('should delete an object successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(s3Module.deleteObject('receipts/user_456/receipt_123/image_0')).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw S3ValidationError for missing key', async () => {
      await expect(s3Module.deleteObject('')).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3Error when delete fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      try {
        await s3Module.deleteObject('receipts/user_456/receipt_123/image_0');
        fail('Expected S3Error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(s3Module.S3Error);
        expect((err as s3Module.S3Error).code).toBe('DELETE_FAILED');
      }
    });
  });

  describe('objectExists', () => {
    it('should return true when object exists', async () => {
      mockSend.mockResolvedValueOnce({});

      const exists = await s3Module.objectExists('receipts/user_456/receipt_123/image_0');
      expect(exists).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      const error = new Error('Not Found');
      error.name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      const exists = await s3Module.objectExists('receipts/user_456/receipt_123/image_0');
      expect(exists).toBe(false);
    });

    it('should throw S3ValidationError for missing key', async () => {
      await expect(s3Module.objectExists('')).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3Error for other errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      try {
        await s3Module.objectExists('receipts/user_456/receipt_123/image_0');
        fail('Expected S3Error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(s3Module.S3Error);
        expect((err as s3Module.S3Error).code).toBe('HEAD_FAILED');
      }
    });
  });

  describe('getObjectMetadata', () => {
    it('should return object metadata when object exists', async () => {
      mockSend.mockResolvedValueOnce({
        ContentType: 'image/jpeg',
        ContentLength: 102400,
        LastModified: new Date('2024-01-15T14:30:00.000Z'),
      });

      const metadata = await s3Module.getObjectMetadata('receipts/user_456/receipt_123/image_0');
      expect(metadata).toEqual({
        contentType: 'image/jpeg',
        contentLength: 102400,
        lastModified: new Date('2024-01-15T14:30:00.000Z'),
      });
    });

    it('should return null when object does not exist', async () => {
      const error = new Error('Not Found');
      error.name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      const metadata = await s3Module.getObjectMetadata('receipts/user_456/receipt_123/image_0');
      expect(metadata).toBeNull();
    });

    it('should throw S3ValidationError for missing key', async () => {
      await expect(s3Module.getObjectMetadata('')).rejects.toThrow(s3Module.S3ValidationError);
    });

    it('should throw S3Error for other errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      try {
        await s3Module.getObjectMetadata('receipts/user_456/receipt_123/image_0');
        fail('Expected S3Error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(s3Module.S3Error);
        expect((err as s3Module.S3Error).code).toBe('HEAD_FAILED');
      }
    });
  });

  describe('Error Classes', () => {
    it('S3Error should have correct properties', () => {
      const error = new s3Module.S3Error('Test error', 'TEST_CODE', 400);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('S3Error');
    });

    it('ObjectNotFoundError should have correct properties', () => {
      const error = new s3Module.ObjectNotFoundError('receipts/user_456/image_0');
      expect(error.message).toBe('Object not found: receipts/user_456/image_0');
      expect(error.code).toBe('OBJECT_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('ObjectNotFoundError');
    });

    it('S3ValidationError should have correct properties', () => {
      const error = new s3Module.S3ValidationError('Invalid input');
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('S3ValidationError');
    });
  });
  describe('missing bucket configuration', () => {
    it('should throw a clear S3Error when S3_BUCKET_RECEIPTS is not configured', async () => {
      (getConfig as jest.Mock).mockReturnValueOnce({
        aws: { region: 'us-east-1' },
        s3: { bucketReceipts: undefined, presignedUrlExpiry: 3600 },
      });

      await expect(s3Module.createPresignedUploadUrl(validUploadInput)).rejects.toMatchObject({
        name: 'S3Error',
        code: 'BUCKET_NOT_CONFIGURED',
      });
    });

    it('should throw a clear S3Error when signing a download without a bucket', async () => {
      (getConfig as jest.Mock).mockReturnValueOnce({
        aws: { region: 'us-east-1' },
        s3: { bucketReceipts: undefined, presignedUrlExpiry: 3600 },
      });

      await expect(s3Module.createPresignedDownloadUrl(validDownloadInput)).rejects.toMatchObject({
        code: 'BUCKET_NOT_CONFIGURED',
      });
    });
  });
});
