import { randomBytes } from 'crypto';
import type { ReceiptStore } from '../services/store';
import { createMemoryStore } from '../services/store';
import type { ImageStore } from '../services/object-store';
import { createMemoryImageStore } from '../services/object-store';
import type { UploadSigner } from '../services/capture';
import type { Receipt, ReceiptImage } from '../types/receipt';

export function createFakeSigner(): {
  createUploadUrl: jest.Mock;
  calls: Array<{ userId: string; receiptId: string; contentType: string; fileName: string }>;
} {
  const calls: Array<{ userId: string; receiptId: string; contentType: string; fileName: string }> = [];
  const createUploadUrl = jest.fn(
    (input: { userId: string; receiptId: string; contentType: string; fileName: string }) => {
      calls.push(input);
      return {
        uploadUrl: `https://s3.example.test/${input.userId}/${input.receiptId}/upload`,
        key: `receipts/${input.userId}/${input.receiptId}/image_1.jpg`,
        bucket: 'test-bucket',
        expiresIn: 3600,
      };
    }
  );
  return { createUploadUrl, calls };
}

export function createMemoryUploadSigner(imageStore: ImageStore, ttlSeconds = 3600): UploadSigner {
  return {
    createUploadUrl(input: { userId: string; receiptId: string; contentType: string; fileName: string }) {
      const token = randomBytes(16).toString('hex');
      imageStore.reserve(token, { userId: input.userId, receiptId: input.receiptId });
      return Promise.resolve({
        uploadUrl: `/api/uploads/${token}`,
        key: `memory://${token}`,
        bucket: 'memory-images',
        expiresIn: ttlSeconds,
      });
    },
  };
}

export function createTestDeps(overrides: {
  store?: ReceiptStore;
  signer?: ReturnType<typeof createFakeSigner>;
  imageStore?: ImageStore;
} = {}) {
  const store = overrides.store ?? createMemoryStore();
  const signer = overrides.signer ?? createFakeSigner();
  const imageStore = overrides.imageStore ?? createMemoryImageStore();
  return { store, signer, imageStore, deps: { store, uploadSigner: signer, monthlyLimit: 50 } };
}

export const validImageInput = {
  fileName: 'lunch.jpg',
  contentType: 'image/jpeg',
  size: 20481,
};

export const validCaptureRequest = {
  userId: 'user_123',
  image: validImageInput,
};

export function createTestReceipt(overrides: Partial<Receipt> = {}): Receipt {
  const now = new Date().toISOString();
  return {
    receiptId: 'rcpt_test',
    userId: 'user_123',
    metadata: {
      merchantName: 'Test Merchant',
      transactionDate: now.slice(0, 10),
      subtotal: 1000,
      tax: 100,
      total: 1100,
      currency: 'USD',
    },
    lineItems: [],
    images: [
      {
        s3Key: 'receipts/user_123/rcpt_test/image_1.jpg',
        s3Bucket: 'test-bucket',
        contentType: 'image/jpeg',
        size: 20481,
      } as ReceiptImage,
    ],
    categories: [],
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

export function previousMonthReceipt(): Receipt {
  const createdAt = new Date();
  createdAt.setMonth(createdAt.getMonth() - 1);
  const now = createdAt.toISOString();
  return {
    receiptId: 'rcpt_old',
    userId: 'user_123',
    metadata: {
      merchantName: 'Old Shop',
      transactionDate: '2024-01-01',
      subtotal: 10,
      tax: 1,
      total: 11,
      currency: 'USD',
    },
    lineItems: [],
    images: [],
    categories: [],
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function createJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}