import { processReceipt, reprocessReceipt, processReceiptBatch, ProcessingError, ReceiptNotFoundForProcessingError, ReceiptNotPendingError } from './processing';
import { createMemoryStore, type ReceiptStore } from './store';
import { createMemoryImageStore, type ImageStore } from './object-store';
import { Receipt, ReceiptMetadata, ReceiptLineItem, ReceiptImage, ReceiptOcrResult, ReceiptCategory } from '../types/receipt';
import { OcrError, OcrFallbackError } from './ocr';
import { createJpegBuffer } from '../utils/test-helpers';

jest.mock('./ocr', () => {
  const actual = jest.requireActual('./ocr');
  return {
    ...actual,
    processReceiptOcr: jest.fn(),
    OcrError: actual.OcrError,
    OcrFallbackError: actual.OcrFallbackError,
  };
});

jest.mock('./categorize', () => {
  const actual = jest.requireActual('./categorize');
  return {
    ...actual,
    categorizeReceipt: jest.fn(),
  };
});

import * as ocrModule from './ocr';
import * as categorizeModule from './categorize';

describe('Receipt Processing Pipeline', () => {
  let store: ReceiptStore;
  let imageStore: ImageStore;
  let deps: { receiptStore: ReceiptStore; imageStore: ImageStore };

  const sampleReceipt: Receipt = {
    receiptId: 'rcpt_test_123',
    userId: 'user_123',
    metadata: {
      merchantName: 'Test Merchant',
      transactionDate: '2024-01-15',
      subtotal: 1000,
      tax: 100,
      total: 1100,
      currency: 'USD',
    },
    lineItems: [],
    images: [
      {
        s3Key: 'memory://test-token-123',
        s3Bucket: 'memory-images',
        contentType: 'image/jpeg',
        size: 20481,
      } as ReceiptImage,
    ],
    categories: [],
    status: 'pending',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    version: 1,
  };

  const sampleOcrResult: ReceiptOcrResult = {
    rawText: 'Test Merchant\nItem 1 $10.00\nItem 2 $20.00\nTotal $30.00',
    confidence: 95,
    extractedFields: { Merchant: 'Test Merchant', Total: '$30.00' },
    lineItems: [
      { description: 'Item 1', quantity: 1, unitPrice: 10, total: 10 },
      { description: 'Item 2', quantity: 1, unitPrice: 20, total: 20 },
    ],
    processingTimeMs: 1000,
    engine: 'textract',
  };

  const sampleCategorization = {
    categories: [
      { id: 'cat_food', name: 'Food & Dining', confidence: 0.85, source: 'rule' as const },
    ],
    categorizedLineItems: [
      { description: 'Item 1', quantity: 1, unitPrice: 10, total: 10, category: 'Food & Dining' },
      { description: 'Item 2', quantity: 1, unitPrice: 20, total: 20, category: 'Food & Dining' },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    store = createMemoryStore();
    imageStore = createMemoryImageStore();
    deps = { receiptStore: store, imageStore };

    await store.save(sampleReceipt);
    await imageStore.reserve('test-token-123', { userId: 'user_123', receiptId: 'rcpt_test_123' });
    await imageStore.put('test-token-123', 'image/jpeg', createJpegBuffer());

    (ocrModule.processReceiptOcr as jest.Mock).mockResolvedValue({
      ocrResult: sampleOcrResult,
      engine: 'textract',
      warnings: [],
    });

    (categorizeModule.categorizeReceipt as jest.Mock).mockReturnValue(sampleCategorization);
  });

  describe('processReceipt', () => {
    it('should process a pending receipt through OCR and categorization', async () => {
      const result = await processReceipt('rcpt_test_123', 'user_123', deps);

      expect(result.receipt.status).toBe('completed');
      expect(result.receipt.ocrResult).toEqual(sampleOcrResult);
      expect(result.receipt.categories).toEqual(sampleCategorization.categories);
      expect(result.receipt.lineItems).toEqual(sampleCategorization.categorizedLineItems);
      expect(result.ocrWarnings).toEqual([]);
      expect(result.categorization).toEqual(sampleCategorization);
    });

    it('should update metadata from OCR extracted fields', async () => {
      const ocrWithFields: ReceiptOcrResult = {
        ...sampleOcrResult,
        extractedFields: {
          Merchant: 'Updated Merchant',
          Address: '123 New St',
          Total: '$50.00',
          Tax: '$5.00',
        },
      };
      (ocrModule.processReceiptOcr as jest.Mock).mockResolvedValue({
        ocrResult: ocrWithFields,
        engine: 'textract',
        warnings: [],
      });

      const result = await processReceipt('rcpt_test_123', 'user_123', deps);

      expect(result.receipt.metadata.merchantName).toBe('Updated Merchant');
      expect(result.receipt.metadata.merchantAddress).toBe('123 New St');
      expect(result.receipt.metadata.total).toBe(50);
      expect(result.receipt.metadata.tax).toBe(5);
    });

    it('should include OCR warnings in result', async () => {
      (ocrModule.processReceiptOcr as jest.Mock).mockResolvedValue({
        ocrResult: sampleOcrResult,
        engine: 'tesseract',
        warnings: ['Textract throttled, falling back to Tesseract'],
      });

      const result = await processReceipt('rcpt_test_123', 'user_123', deps);

      expect(result.ocrWarnings).toContain('Textract throttled, falling back to Tesseract');
    });

    it('should throw ReceiptNotFoundForProcessingError for non-existent receipt', async () => {
      await expect(processReceipt('rcpt_nonexistent', 'user_123', deps)).rejects.toThrow(ReceiptNotFoundForProcessingError);
    });

    it('should throw ReceiptNotPendingError for completed receipt', async () => {
      const completedReceipt = { ...sampleReceipt, status: 'completed' as const, receiptId: 'rcpt_completed' };
      await store.save(completedReceipt);
      await imageStore.reserve('test-token-456', { userId: 'user_123', receiptId: 'rcpt_completed' });
      await imageStore.put('test-token-456', 'image/jpeg', createJpegBuffer());

      await expect(processReceipt('rcpt_completed', 'user_123', deps)).rejects.toThrow(ReceiptNotPendingError);
    });

    it('should throw ReceiptNotPendingError for archived receipt', async () => {
      const archivedReceipt = { ...sampleReceipt, status: 'archived' as const, receiptId: 'rcpt_archived' };
      await store.save(archivedReceipt);
      await imageStore.reserve('test-token-789', { userId: 'user_123', receiptId: 'rcpt_archived' });
      await imageStore.put('test-token-789', 'image/jpeg', createJpegBuffer());

      await expect(processReceipt('rcpt_archived', 'user_123', deps)).rejects.toThrow(ReceiptNotPendingError);
    });

    it('should allow processing of receipt already in processing status', async () => {
      const processingReceipt = { ...sampleReceipt, status: 'processing' as const, receiptId: 'rcpt_processing' };
      await store.save(processingReceipt);
      await imageStore.reserve('test-token-999', { userId: 'user_123', receiptId: 'rcpt_processing' });
      await imageStore.put('test-token-999', 'image/jpeg', createJpegBuffer());

      const result = await processReceipt('rcpt_processing', 'user_123', deps);
      expect(result.receipt.status).toBe('completed');
    });

    it('should mark receipt as failed when OcrError occurs', async () => {
      (ocrModule.processReceiptOcr as jest.Mock).mockRejectedValue(new OcrError('OCR failed', 'OCR_FAILED'));

      await expect(processReceipt('rcpt_test_123', 'user_123', deps)).rejects.toThrow(ProcessingError);

      const failedReceipt = await store.get('rcpt_test_123', 'user_123');
      expect(failedReceipt?.status).toBe('failed');
    });

    it('should mark receipt as failed when OcrFallbackError occurs', async () => {
      (ocrModule.processReceiptOcr as jest.Mock).mockRejectedValue(new OcrFallbackError('Fallback failed', new Error('Tesseract error')));

      await expect(processReceipt('rcpt_test_123', 'user_123', deps)).rejects.toThrow(ProcessingError);

      const failedReceipt = await store.get('rcpt_test_123', 'user_123');
      expect(failedReceipt?.status).toBe('failed');
    });

    it('should mark receipt as failed when categorization fails', async () => {
      (categorizeModule.categorizeReceipt as jest.Mock).mockImplementation(() => {
        throw new Error('Categorization error');
      });

      await expect(processReceipt('rcpt_test_123', 'user_123', deps)).rejects.toThrow(ProcessingError);

      const failedReceipt = await store.get('rcpt_test_123', 'user_123');
      expect(failedReceipt?.status).toBe('failed');
    });

    it('should use custom categorization rules when provided', async () => {
      const customRules = [{ id: 'custom', name: 'Custom', patterns: ['test'], categoryId: 'cat_custom', categoryName: 'Custom', priority: 100 }];
      await processReceipt('rcpt_test_123', 'user_123', deps, { customCategorizationRules: customRules });

      expect(categorizeModule.categorizeReceipt).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Array),
        expect.any(Object),
        customRules
      );
    });

    it('should pass useTextract and useOcrFallback options to OCR', async () => {
      await processReceipt('rcpt_test_123', 'user_123', deps, { useTextract: false, useOcrFallback: false });

      expect(ocrModule.processReceiptOcr).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ useTextract: false, useFallback: false })
      );
    });
  });

  describe('reprocessReceipt', () => {
    it('should reprocess a completed receipt', async () => {
      const completedReceipt = { ...sampleReceipt, status: 'completed' as const, receiptId: 'rcpt_completed_2' };
      await store.save(completedReceipt);
      await imageStore.reserve('test-token-reprocess', { userId: 'user_123', receiptId: 'rcpt_completed_2' });
      await imageStore.put('test-token-reprocess', 'image/jpeg', createJpegBuffer());

      const result = await reprocessReceipt('rcpt_completed_2', 'user_123', deps);

      expect(result.receipt.status).toBe('completed');
    });

    it('should reprocess a failed receipt', async () => {
      const failedReceipt = { ...sampleReceipt, status: 'failed' as const, receiptId: 'rcpt_failed_2' };
      await store.save(failedReceipt);
      await imageStore.reserve('test-token-reprocess2', { userId: 'user_123', receiptId: 'rcpt_failed_2' });
      await imageStore.put('test-token-reprocess2', 'image/jpeg', createJpegBuffer());

      const result = await reprocessReceipt('rcpt_failed_2', 'user_123', deps);

      expect(result.receipt.status).toBe('completed');
    });

    it('should throw for pending receipt', async () => {
      await expect(reprocessReceipt('rcpt_test_123', 'user_123', deps)).rejects.toThrow(ReceiptNotPendingError);
    });

    it('should throw for non-existent receipt', async () => {
      await expect(reprocessReceipt('rcpt_nonexistent', 'user_123', deps)).rejects.toThrow(ReceiptNotFoundForProcessingError);
    });
  });

  describe('processReceiptBatch', () => {
    it('should process multiple receipts', async () => {
      const receipt2 = { ...sampleReceipt, receiptId: 'rcpt_batch_2', images: [{ ...sampleReceipt.images[0], s3Key: 'memory://token2' }] };
      await store.save(receipt2);
      await imageStore.reserve('token2', { userId: 'user_123', receiptId: 'rcpt_batch_2' });
      await imageStore.put('token2', 'image/jpeg', createJpegBuffer());

      const receipt3 = { ...sampleReceipt, receiptId: 'rcpt_batch_3', images: [{ ...sampleReceipt.images[0], s3Key: 'memory://token3' }] };
      await store.save(receipt3);
      await imageStore.reserve('token3', { userId: 'user_123', receiptId: 'rcpt_batch_3' });
      await imageStore.put('token3', 'image/jpeg', createJpegBuffer());

      const results = await processReceiptBatch(['rcpt_test_123', 'rcpt_batch_2', 'rcpt_batch_3'], 'user_123', deps);

      expect(results).toHaveLength(3);
      expect(results[0].result).toBeDefined();
      expect(results[1].result).toBeDefined();
      expect(results[2].result).toBeDefined();
      expect(results.every((r) => r.result?.receipt.status === 'completed')).toBe(true);
    });

    it('should return errors for failed receipts without stopping', async () => {
      const receipt2 = { ...sampleReceipt, receiptId: 'rcpt_batch_fail', images: [{ ...sampleReceipt.images[0], s3Key: 'memory://token_fail' }] };
      await store.save(receipt2);
      await imageStore.reserve('token_fail', { userId: 'user_123', receiptId: 'rcpt_batch_fail' });
      await imageStore.put('token_fail', 'image/jpeg', createJpegBuffer());

      (ocrModule.processReceiptOcr as jest.Mock)
        .mockResolvedValueOnce({ ocrResult: sampleOcrResult, engine: 'textract', warnings: [] })
        .mockRejectedValueOnce(new OcrError('OCR failed', 'OCR_FAILED'));

      const results = await processReceiptBatch(['rcpt_test_123', 'rcpt_batch_fail'], 'user_123', deps);

      expect(results).toHaveLength(2);
      expect(results[0].result).toBeDefined();
      expect(results[1].error).toBeDefined();
      expect(results[1].error).toBeInstanceOf(ProcessingError);
    });
  });
});