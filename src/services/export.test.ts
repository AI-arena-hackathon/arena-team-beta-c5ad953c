import { receiptsToCsv, exportReceipts, sendWebhook, formatCsvValue, ExportError, WebhookError } from './export';
import { Receipt } from '../types/receipt';

describe('Export Service', () => {
  const sampleReceipt: Receipt = {
    receiptId: 'rcpt_test_123',
    userId: 'user_123',
    metadata: {
      merchantName: 'Test Merchant',
      merchantAddress: '123 Main St, City, State 12345',
      merchantPhone: '+1 (555) 123-4567',
      transactionDate: '2024-01-15',
      transactionTime: '14:30:00',
      subtotal: 1000,
      tax: 100,
      tip: 50,
      total: 1150,
      currency: 'USD',
      paymentMethod: 'Credit Card',
      cardLast4: '1234',
    },
    lineItems: [
      { description: 'Item 1', quantity: 1, unitPrice: 500, total: 500 },
      { description: 'Item 2', quantity: 2, unitPrice: 250, total: 500 },
    ],
    images: [],
    categories: [
      { id: 'cat_food', name: 'Food & Dining', confidence: 0.85, source: 'rule' as const },
    ],
    status: 'completed',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T12:00:00.000Z',
    version: 1,
  };

  describe('formatCsvValue', () => {
    it('should format simple strings', () => {
      expect(formatCsvValue('test')).toBe('test');
    });

    it('should format numbers', () => {
      expect(formatCsvValue(100)).toBe('100');
    });

    it('should handle null and undefined', () => {
      expect(formatCsvValue(null)).toBe('');
      expect(formatCsvValue(undefined)).toBe('');
    });

    it('should escape values with commas', () => {
      expect(formatCsvValue('Test, Store')).toBe('"Test, Store"');
    });

    it('should escape values with quotes', () => {
      expect(formatCsvValue('Test "Store"')).toBe('"Test ""Store"""');
    });

    it('should escape values with newlines', () => {
      expect(formatCsvValue('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });
  });

  describe('receiptsToCsv', () => {
    it('should convert receipts to CSV', () => {
      const csv = receiptsToCsv([sampleReceipt]);
      expect(csv).toContain('receiptId');
      expect(csv).toContain('rcpt_test_123');
      expect(csv).toContain('Test Merchant');
      expect(csv).toContain('1150');
    });

    it('should handle empty receipts array', () => {
      const csv = receiptsToCsv([]);
      expect(csv).toContain('receiptId');
      expect(csv).toContain('merchantName');
    });

    it('should include line items JSON when requested', () => {
      const csv = receiptsToCsv([sampleReceipt], { includeLineItems: true });
      expect(csv).toContain('lineItemsJson');
      expect(csv).toContain('"Item 1"');
    });

    it('should include OCR text when requested', () => {
      const receiptWithOcr = {
        ...sampleReceipt,
        ocrResult: {
          rawText: 'Test Merchant\nTotal: $11.50',
          confidence: 95,
          extractedFields: {},
          lineItems: [],
          processingTimeMs: 1000,
          engine: 'textract' as const,
        },
      };
      const csv = receiptsToCsv([receiptWithOcr], { includeOcrText: true });
      expect(csv).toContain('ocrRawText');
      expect(csv).toContain('Test Merchant');
    });
  });

  describe('exportReceipts', () => {
    it('should export receipts for a user', async () => {
      const mockStore = {
        query: jest.fn(),
        list: jest.fn().mockResolvedValue({
          items: [sampleReceipt],
          count: 1,
        }),
      };

      const result = await exportReceipts('user_123', {}, {}, { receiptStore: mockStore });

      expect(result.csv).toContain('rcpt_test_123');
      expect(result.receipts).toHaveLength(1);
      expect(result.count).toBe(1);
      expect(mockStore.list).toHaveBeenCalledWith({ userId: 'user_123' });
    });

    it('should pass filters to store', async () => {
      const mockStore = {
        query: jest.fn(),
        list: jest.fn().mockResolvedValue({ items: [], count: 0 }),
      };

      await exportReceipts('user_123', { status: 'completed' }, {}, { receiptStore: mockStore });

      expect(mockStore.list).toHaveBeenCalledWith({ userId: 'user_123', status: 'completed' });
    });
  });

  describe('sendWebhook', () => {
    it('should send webhook successfully', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('OK'),
      });

      const result = await sendWebhook(
        {
          receipts: [sampleReceipt],
          webhookUrl: 'https://example.com/webhook',
        },
        { fetch: mockFetch as any }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle webhook failure', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Error'),
      });

      await expect(
        sendWebhook(
          {
            receipts: [sampleReceipt],
            webhookUrl: 'https://example.com/webhook',
          },
          { fetch: mockFetch as any }
        )
      ).rejects.toThrow(WebhookError);
    });

    it('should handle network errors', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        sendWebhook(
          {
            receipts: [sampleReceipt],
            webhookUrl: 'https://example.com/webhook',
          },
          { fetch: mockFetch as any }
        )
      ).rejects.toThrow(WebhookError);
    });
  });
});
