import { exportAndSync, generateExportFilename, ExportSyncError } from './export-sync';
import { Receipt } from '../types/receipt';

describe('Export Sync Module', () => {
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
    images: [],
    categories: [],
    status: 'completed',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    version: 1,
  };

  describe('exportAndSync', () => {
    it('should export receipts without webhook', async () => {
      const mockStore = {
        query: jest.fn(),
        list: jest.fn().mockResolvedValue({
          items: [sampleReceipt],
          count: 1,
        }),
      };

      const result = await exportAndSync('user_123', {}, {}, { receiptStore: mockStore });

      expect(result.exported.count).toBe(1);
      expect(result.exported.csv).toContain('rcpt_test_123');
      expect(result.receipts).toHaveLength(1);
      expect(result.webhook).toBeUndefined();
    });

    it('should export receipts and send webhook', async () => {
      const mockStore = {
        query: jest.fn(),
        list: jest.fn().mockResolvedValue({
          items: [sampleReceipt],
          count: 1,
        }),
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('OK'),
      });

      const result = await exportAndSync(
        'user_123',
        {},
        { webhookUrl: 'https://example.com/webhook' },
        { receiptStore: mockStore, fetch: mockFetch as any }
      );

      expect(result.exported.count).toBe(1);
      expect(result.webhook?.success).toBe(true);
      expect(result.webhook?.status).toBe(200);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle webhook failure gracefully', async () => {
      const mockStore = {
        query: jest.fn(),
        list: jest.fn().mockResolvedValue({
          items: [sampleReceipt],
          count: 1,
        }),
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Error'),
      });

      const result = await exportAndSync(
        'user_123',
        {},
        { webhookUrl: 'https://example.com/webhook' },
        { receiptStore: mockStore, fetch: mockFetch as any }
      );

      expect(result.exported.count).toBe(1);
      expect(result.webhook?.success).toBe(false);
    });

    it('should pass filters and options correctly', async () => {
      const mockStore = {
        query: jest.fn(),
        list: jest.fn().mockResolvedValue({ items: [], count: 0 }),
      };

      await exportAndSync(
        'user_123',
        { status: 'completed' },
        { includeLineItems: true, includeOcrText: true },
        { receiptStore: mockStore }
      );

      expect(mockStore.list).toHaveBeenCalledWith({ userId: 'user_123', status: 'completed' });
    });
  });

  describe('generateExportFilename', () => {
    it('should generate filename with userId and date', () => {
      const date = new Date('2024-01-15T10:00:00Z');
      const filename = generateExportFilename('user_123', date);
      expect(filename).toBe('receipts_user_123_2024-01-15.csv');
    });

    it('should use current date by default', () => {
      const filename = generateExportFilename('user_123');
      expect(filename).toMatch(/receipts_user_123_\d{4}-\d{2}-\d{2}\.csv/);
    });
  });
});
