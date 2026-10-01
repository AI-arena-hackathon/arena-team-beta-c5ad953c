import { captureReceipt, completeUpload, getMonthlyUsage, CaptureError } from './capture';
import { createMemoryStore, type ReceiptStore } from './store';
import type { Receipt } from '../types/receipt';

function createFakeSigner(): {
  createUploadUrl: jest.Mock;
  calls: Array<{ userId: string; receiptId: string; contentType: string; fileName: string }>;
} {
  const calls: Array<{ userId: string; receiptId: string; contentType: string; fileName: string }> = [];
  const createUploadUrl = jest.fn(
    async (input: { userId: string; receiptId: string; contentType: string; fileName: string }) => {
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

function createDeps(overrides: { store?: ReceiptStore; signer?: ReturnType<typeof createFakeSigner> } = {}) {
  const store = overrides.store ?? createMemoryStore();
  const signer = overrides.signer ?? createFakeSigner();
  return { store, signer, deps: { store, uploadSigner: signer } };
}

const validRequest = {
  userId: 'user_123',
  image: { fileName: 'lunch.jpg', contentType: 'image/jpeg', size: 20481 },
};

describe('captureReceipt', () => {
  it('creates a pending receipt with the image attached and returns an upload url', async () => {
    const { store, signer, deps } = createDeps();

    const result = await captureReceipt(validRequest, deps);

    expect(result.receipt.status).toBe('pending');
    expect(result.receipt.receiptId).toMatch(/^rcpt_/);
    expect(result.receipt.images).toHaveLength(1);
    expect(result.upload.uploadUrl).toBe(
      `https://s3.example.test/user_123/${result.receipt.receiptId}/upload`
    );
    expect(result.upload.expiresIn).toBe(3600);
    expect(await store.get(result.receipt.receiptId, 'user_123')).toEqual(result.receipt);
  });

  it('hands the signer the receipt id so the s3 key is scoped to the new receipt', async () => {
    const { signer, deps } = createDeps();

    const result = await captureReceipt(validRequest, deps);

    expect(signer.calls).toHaveLength(1);
    expect(signer.calls[0]).toMatchObject({
      userId: 'user_123',
      receiptId: result.receipt.receiptId,
      contentType: 'image/jpeg',
      fileName: 'lunch.jpg',
    });
  });

  it('attaches the object key returned by the signer to the stored receipt image', async () => {
    const { deps } = createDeps();

    const result = await captureReceipt(validRequest, deps);

    expect(result.receipt.images[0].s3Key).toBe(
      `receipts/user_123/${result.receipt.receiptId}/image_1.jpg`
    );
    expect(result.receipt.images[0].s3Bucket).toBe('test-bucket');
    expect(result.receipt.images[0].size).toBe(20481);
  });

  it('starts with empty line items and no categories so OCR can fill them in later', async () => {
    const { deps } = createDeps();

    const result = await captureReceipt(validRequest, deps);

    expect(result.receipt.lineItems).toEqual([]);
    expect(result.receipt.categories).toEqual([]);
    expect(result.receipt.ocrResult).toBeUndefined();
  });

  it('rejects a missing userId with a 400 CaptureError', async () => {
    const { signer, deps } = createDeps();

    await expect(captureReceipt({ ...validRequest, userId: '' }, deps)).rejects.toMatchObject({
      name: 'CaptureError',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(signer.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image content type with a 400 CaptureError', async () => {
    const { deps } = createDeps();

    await expect(
      captureReceipt({ ...validRequest, image: { ...validRequest.image, contentType: 'application/pdf' } }, deps)
    ).rejects.toBeInstanceOf(CaptureError);
  });

  it('rejects an oversized image before it reaches s3', async () => {
    const { signer, deps } = createDeps();

    await expect(
      captureReceipt({ ...validRequest, image: { ...validRequest.image, size: 12 * 1024 * 1024 } }, deps)
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(signer.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a negative or non-numeric image size', async () => {
    const { deps } = createDeps();

    await expect(
      captureReceipt({ ...validRequest, image: { ...validRequest.image, size: -1 } }, deps)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      captureReceipt(
        { ...validRequest, image: { ...validRequest.image, size: 'big' as unknown as number } },
        deps
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('enforces the monthly free-tier limit and rejects the capture that would exceed it', async () => {
    const { store, deps: depsBase } = createDeps();
    const deps = { ...depsBase, monthlyLimit: 2 };

    await captureReceipt(validRequest, deps);
    await captureReceipt(validRequest, deps);

    await expect(captureReceipt(validRequest, deps)).rejects.toMatchObject({
      code: 'MONTHLY_LIMIT_REACHED',
      statusCode: 429,
    });
    expect((await store.list({ userId: 'user_123' })).items).toHaveLength(2);
  });

  it('counts only the current calendar month against the limit', async () => {
    const store = createMemoryStore();
    const { deps: depsBase } = createDeps({ store });
    const deps = { ...depsBase, monthlyLimit: 1 };

    await store.save(previousMonthReceipt());
    await expect(captureReceipt(validRequest, deps)).resolves.toMatchObject({
      receipt: { status: 'pending' },
    });
  });

  it('does not persist a receipt when the signer fails', async () => {
    const signer = createFakeSigner();
    signer.createUploadUrl.mockRejectedValueOnce(new Error('s3 unavailable'));
    const { store, deps } = createDeps({ signer });

    await expect(captureReceipt(validRequest, deps)).rejects.toBeInstanceOf(CaptureError);
    expect((await store.list({ userId: 'user_123' })).items).toHaveLength(0);
  });
});

describe('completeUpload', () => {
  it('moves the receipt to processing once the client confirms the upload', async () => {
    const { deps } = createDeps();
    const { receipt } = await captureReceipt(validRequest, deps);

    const updated = await completeUpload(receipt.receiptId, 'user_123', deps);

    expect(updated.status).toBe('processing');
    expect(updated.version).toBe(2);
  });

  it('reports 404 when confirming an unknown receipt', async () => {
    const { deps } = createDeps();

    await expect(completeUpload('rcpt_missing', 'user_123', deps)).rejects.toMatchObject({
      code: 'RECEIPT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('refuses to confirm an upload for a different user', async () => {
    const { deps } = createDeps();
    const { receipt } = await captureReceipt(validRequest, deps);

    await expect(completeUpload(receipt.receiptId, 'user_other', deps)).rejects.toMatchObject({
      code: 'RECEIPT_NOT_FOUND',
    });
  });
});

describe('getMonthlyUsage', () => {
  it('returns the capture count and remaining allowance for the current month', async () => {
    const { store, deps: depsBase } = createDeps();
    const deps = { ...depsBase, monthlyLimit: 3 };

    await captureReceipt(validRequest, deps);
    await captureReceipt(validRequest, deps);

    await expect(getMonthlyUsage('user_123', deps)).resolves.toEqual({
      used: 2,
      limit: 3,
      remaining: 1,
    });
  });
});

function previousMonthReceipt(): Receipt {
  const createdAt = new Date();
  createdAt.setMonth(createdAt.getMonth() - 1);
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
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    version: 1,
  };
}
