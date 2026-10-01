import { captureReceipt, completeUpload, discardPendingUpload, getMonthlyUsage, CaptureError } from './capture';
import { createMemoryStore, type ReceiptStore } from './store';
import type { Receipt } from '../types/receipt';
import {
  createFakeSigner,
  createTestDeps,
  validCaptureRequest,
  previousMonthReceipt,
} from '../utils/test-helpers';

describe('captureReceipt', () => {
  it('creates a pending receipt with the image attached and returns an upload url', async () => {
    const { store, signer, deps } = createTestDeps();

    const result = await captureReceipt(validCaptureRequest, deps);

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
    const { signer, deps } = createTestDeps();

    const result = await captureReceipt(validCaptureRequest, deps);

    expect(signer.calls).toHaveLength(1);
    expect(signer.calls[0]).toMatchObject({
      userId: 'user_123',
      receiptId: result.receipt.receiptId,
      contentType: 'image/jpeg',
      fileName: 'lunch.jpg',
    });
  });

  it('attaches the object key returned by the signer to the stored receipt image', async () => {
    const { deps } = createTestDeps();

    const result = await captureReceipt(validCaptureRequest, deps);

    expect(result.receipt.images[0].s3Key).toBe(
      `receipts/user_123/${result.receipt.receiptId}/image_1.jpg`
    );
    expect(result.receipt.images[0].s3Bucket).toBe('test-bucket');
    expect(result.receipt.images[0].size).toBe(20481);
  });

  it('starts with empty line items and no categories so OCR can fill them in later', async () => {
    const { deps } = createTestDeps();

    const result = await captureReceipt(validCaptureRequest, deps);

    expect(result.receipt.lineItems).toEqual([]);
    expect(result.receipt.categories).toEqual([]);
    expect(result.receipt.ocrResult).toBeUndefined();
  });

  it('rejects a missing userId with a 400 CaptureError', async () => {
    const { signer, deps } = createTestDeps();

    await expect(captureReceipt({ ...validCaptureRequest, userId: '' }, deps)).rejects.toMatchObject({
      name: 'CaptureError',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(signer.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image content type with a 400 CaptureError', async () => {
    const { deps } = createTestDeps();

    await expect(
      captureReceipt({ ...validCaptureRequest, image: { ...validCaptureRequest.image, contentType: 'application/pdf' } }, deps)
    ).rejects.toBeInstanceOf(CaptureError);
  });

  it('rejects an oversized image before it reaches s3', async () => {
    const { signer, deps } = createTestDeps();

    await expect(
      captureReceipt({ ...validCaptureRequest, image: { ...validCaptureRequest.image, size: 12 * 1024 * 1024 } }, deps)
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(signer.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a negative or non-numeric image size', async () => {
    const { deps } = createTestDeps();

    await expect(
      captureReceipt({ ...validCaptureRequest, image: { ...validCaptureRequest.image, size: -1 } }, deps)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      captureReceipt(
        { ...validCaptureRequest, image: { ...validCaptureRequest.image, size: 'big' as unknown as number } },
        deps
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('enforces the monthly free-tier limit and rejects the capture that would exceed it', async () => {
    const { store, deps: depsBase } = createTestDeps();
    const deps = { ...depsBase, monthlyLimit: 2 };

    await captureReceipt(validCaptureRequest, deps);
    await captureReceipt(validCaptureRequest, deps);

    await expect(captureReceipt(validCaptureRequest, deps)).rejects.toMatchObject({
      code: 'MONTHLY_LIMIT_REACHED',
      statusCode: 429,
    });
    expect((await store.list({ userId: 'user_123' })).items).toHaveLength(2);
  });

  it('counts only the current calendar month against the limit', async () => {
    const store = createMemoryStore();
    const { deps: depsBase } = createTestDeps({ store });
    const deps = { ...depsBase, monthlyLimit: 1 };

    await store.save(previousMonthReceipt());
    await expect(captureReceipt(validCaptureRequest, deps)).resolves.toMatchObject({
      receipt: { status: 'pending' },
    });
  });

  it('does not persist a receipt when the signer fails', async () => {
    const signer = createFakeSigner();
    signer.createUploadUrl.mockRejectedValueOnce(new Error('s3 unavailable'));
    const { store, deps } = createTestDeps({ signer });

    await expect(captureReceipt(validCaptureRequest, deps)).rejects.toBeInstanceOf(CaptureError);
    expect((await store.list({ userId: 'user_123' })).items).toHaveLength(0);
  });
});

describe('completeUpload', () => {
  it('moves the receipt to processing once the client confirms the upload', async () => {
    const { deps } = createTestDeps();
    const { receipt } = await captureReceipt(validCaptureRequest, deps);

    const updated = await completeUpload(receipt.receiptId, 'user_123', deps);

    expect(updated.status).toBe('processing');
    expect(updated.version).toBe(2);
  });

  it('reports 404 when confirming an unknown receipt', async () => {
    const { deps } = createTestDeps();

    await expect(completeUpload('rcpt_missing', 'user_123', deps)).rejects.toMatchObject({
      code: 'RECEIPT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('refuses to confirm an upload for a different user', async () => {
    const { deps } = createTestDeps();
    const { receipt } = await captureReceipt(validCaptureRequest, deps);

    await expect(completeUpload(receipt.receiptId, 'user_other', deps)).rejects.toMatchObject({
      code: 'RECEIPT_NOT_FOUND',
    });
  });
});

describe('discardPendingUpload', () => {
  it('deletes a pending receipt so a failed upload does not consume the monthly quota', async () => {
    const { store, deps } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, deps);

    await discardPendingUpload(pending.receiptId, 'user_123', deps);

    expect(await store.get(pending.receiptId, 'user_123')).toBeNull();
    expect((await getMonthlyUsage('user_123', deps)).remaining).toBe(50);
  });

  it('refuses to discard a receipt that has already moved past pending', async () => {
    const { store, deps } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, deps);
    await completeUpload(pending.receiptId, 'user_123', deps);

    await expect(discardPendingUpload(pending.receiptId, 'user_123', deps)).rejects.toMatchObject({
      code: 'UPLOAD_NOT_PENDING',
      statusCode: 409,
    });
    expect(await store.get(pending.receiptId, 'user_123')).not.toBeNull();
  });

  it('reports 404 for an unknown receipt and for another user’s receipt', async () => {
    const { store, deps } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, deps);

    await expect(discardPendingUpload('rcpt_missing', 'user_123', deps)).rejects.toMatchObject({
      code: 'RECEIPT_NOT_FOUND',
      statusCode: 404,
    });
    await expect(discardPendingUpload(pending.receiptId, 'user_other', deps)).rejects.toMatchObject({
      code: 'RECEIPT_NOT_FOUND',
      statusCode: 404,
    });
    expect((await store.list({ userId: 'user_123' })).count).toBe(1);
  });

  it('rejects an unsafe receipt id before touching the store', async () => {
    const { store, deps } = createTestDeps();

    await expect(discardPendingUpload('../../etc/passwd', 'user_123', deps)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect((await store.list({ userId: 'user_123' })).count).toBe(0);
  });

  it('returns the discarded receipt so the caller can echo the stored id', async () => {
    const { deps } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, deps);

    const discarded = await discardPendingUpload(pending.receiptId, 'user_123', deps);

    expect(discarded.receiptId).toBe(pending.receiptId);
    expect(discarded.status).toBe('pending');
    expect(discarded.images).toHaveLength(1);
  });

  it('treats a row that vanished between read and delete as gone, not as a server fault', async () => {
    const { store, deps: depsBase } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, depsBase);
    const vanishing: ReceiptStore = { ...store, remove: () => Promise.resolve(false) };

    await expect(
      discardPendingUpload(pending.receiptId, 'user_123', { ...depsBase, store: vanishing })
    ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND', statusCode: 404 });
  });

  it('surfaces a store read failure as a coded 500 rather than a phantom 404', async () => {
    const { store, deps: depsBase } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, depsBase);
    const failing: ReceiptStore = {
      ...store,
      get: () => Promise.reject(new Error('dynamo unavailable')),
    };

    await expect(
      discardPendingUpload(pending.receiptId, 'user_123', { ...depsBase, store: failing })
    ).rejects.toMatchObject({ code: 'DISCARD_FAILED', statusCode: 500 });
  });

  it('surfaces a store delete failure as a coded 500 rather than a phantom success', async () => {
    const { store, deps: depsBase } = createTestDeps();
    const { receipt: pending } = await captureReceipt(validCaptureRequest, depsBase);
    const failing: ReceiptStore = { ...store, remove: () => Promise.reject(new Error('dynamo unavailable')) };

    await expect(
      discardPendingUpload(pending.receiptId, 'user_123', { ...depsBase, store: failing })
    ).rejects.toMatchObject({ code: 'DISCARD_FAILED', statusCode: 500 });
  });
});

describe('getMonthlyUsage', () => {
  it('returns the capture count and remaining allowance for the current month', async () => {
    const { store, deps: depsBase } = createTestDeps();
    const deps = { ...depsBase, monthlyLimit: 3 };

    await captureReceipt(validCaptureRequest, deps);
    await captureReceipt(validCaptureRequest, deps);

    await expect(getMonthlyUsage('user_123', deps)).resolves.toEqual({
      used: 2,
      limit: 3,
      remaining: 1,
    });
  });
});
