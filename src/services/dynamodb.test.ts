import {
  ReceiptMetadata,
  ReceiptLineItem,
  ReceiptImage,
  ReceiptOcrResult,
  ReceiptCategory,
  CreateReceiptInput,
  Receipt,
} from '../types/receipt';

const validMetadata: ReceiptMetadata = {
  merchantName: 'Starbucks',
  transactionDate: '2024-01-15',
  subtotal: 10.0,
  tax: 1.0,
  total: 13.0,
  currency: 'USD',
};

const validLineItem: ReceiptLineItem = {
  description: 'Coffee',
  quantity: 2,
  unitPrice: 3.5,
  total: 7.0,
};

const validImage: ReceiptImage = {
  s3Key: 'receipts/user123/receipt_123.jpg',
  s3Bucket: 'receipts-bucket',
  contentType: 'image/jpeg',
  size: 102400,
};

const validOcrResult: ReceiptOcrResult = {
  rawText: 'STARBUCKS\nCoffee 2x $3.50\nTotal $13.00',
  confidence: 0.95,
  extractedFields: { merchant: 'Starbucks', total: '13.00' },
  lineItems: [validLineItem],
  processingTimeMs: 1500,
  engine: 'textract',
};

const validCreateInput: CreateReceiptInput = {
  userId: 'user_456',
  metadata: validMetadata,
  lineItems: [validLineItem],
  images: [validImage],
  ocrResult: validOcrResult,
};

const mockReceipt: Receipt = {
  receiptId: 'receipt_123',
  userId: 'user_456',
  metadata: validMetadata,
  lineItems: [validLineItem],
  images: [validImage],
  ocrResult: validOcrResult,
  categories: [],
  status: 'pending',
  createdAt: '2024-01-15T14:30:00.000Z',
  updatedAt: '2024-01-15T14:30:00.000Z',
  version: 1,
};

const mockSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn().mockImplementation((args) => args),
  GetCommand: jest.fn().mockImplementation((args) => args),
  UpdateCommand: jest.fn().mockImplementation((args) => args),
  DeleteCommand: jest.fn().mockImplementation((args) => args),
  QueryCommand: jest.fn().mockImplementation((args) => args),
  ScanCommand: jest.fn().mockImplementation((args) => args),
}));

jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({
    aws: {
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
    dynamodb: {
      tableReceipts: 'test-receipts',
      tableUsers: 'test-users',
      endpoint: 'http://localhost:8000',
    },
  })),
}));

import * as dynamodbModule from './dynamodb';

describe('DynamoDB Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    dynamodbModule.resetDocumentClient();
  });

  describe('createReceipt', () => {
    it('should create a receipt successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await dynamodbModule.createReceipt(validCreateInput);

      expect(result).toMatchObject({
        userId: 'user_456',
        metadata: validMetadata,
        lineItems: [validLineItem],
        images: [validImage],
        ocrResult: validOcrResult,
        categories: [],
        status: 'pending',
        version: 1,
      });
      expect(result.receiptId).toMatch(/^receipt_\d+_[a-z0-9]+$/);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw ReceiptValidationError for invalid input (non-string userId)', async () => {
      const invalidInput = { ...validCreateInput, userId: 123 as any };

      await expect(dynamodbModule.createReceipt(invalidInput)).rejects.toThrow(dynamodbModule.ReceiptValidationError);
    });

    it('should throw ReceiptValidationError for invalid input (missing metadata)', async () => {
      const invalidInput = { ...validCreateInput };
      delete (invalidInput as any).metadata;

      await expect(dynamodbModule.createReceipt(invalidInput)).rejects.toThrow(dynamodbModule.ReceiptValidationError);
    });

    it('should throw DynamoDBError when receipt already exists', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      try {
        await dynamodbModule.createReceipt(validCreateInput);
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('RECEIPT_EXISTS');
      }
    });

    it('should throw DynamoDBError for other errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      try {
        await dynamodbModule.createReceipt(validCreateInput);
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('CREATE_FAILED');
      }
    });
  });

  describe('getReceipt', () => {
    it('should get a receipt successfully', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockReceipt });

      const result = await dynamodbModule.getReceipt('receipt_123', 'user_456');

      expect(result).toEqual(mockReceipt);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw ReceiptNotFoundError when receipt does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(dynamodbModule.getReceipt('receipt_123', 'user_456')).rejects.toThrow(dynamodbModule.ReceiptNotFoundError);
    });

    it('should throw DynamoDBError for invalid receipt data', async () => {
      mockSend.mockResolvedValueOnce({ Item: { receiptId: 'bad', userId: 'user' } });

      try {
        await dynamodbModule.getReceipt('receipt_123', 'user_456');
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('DATA_CORRUPTION');
      }
    });

    it('should throw DynamoDBError for other errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      try {
        await dynamodbModule.getReceipt('receipt_123', 'user_456');
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('GET_FAILED');
      }
    });
  });

  describe('updateReceipt', () => {
    it('should update a receipt successfully', async () => {
      const updatedReceipt = { ...mockReceipt, status: 'completed' as const, version: 2, updatedAt: '2024-01-15T15:00:00.000Z' };
      mockSend
        .mockResolvedValueOnce({ Item: mockReceipt })
        .mockResolvedValueOnce({ Attributes: updatedReceipt });

      const result = await dynamodbModule.updateReceipt('receipt_123', 'user_456', { status: 'completed' });

      expect(result).toEqual(updatedReceipt);
      expect(result.version).toBe(2);
      expect(result.status).toBe('completed');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw ReceiptValidationError for invalid update input', async () => {
      await expect(dynamodbModule.updateReceipt('receipt_123', 'user_456', { status: 'invalid' as Receipt['status'] })).rejects.toThrow(dynamodbModule.ReceiptValidationError);
    });

    it('should throw ReceiptNotFoundError when receipt does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(dynamodbModule.updateReceipt('receipt_123', 'user_456', { status: 'completed' })).rejects.toThrow(dynamodbModule.ReceiptNotFoundError);
    });

    it('should throw OptimisticLockError when version mismatch', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend
        .mockResolvedValueOnce({ Item: mockReceipt })
        .mockRejectedValueOnce(error);

      await expect(dynamodbModule.updateReceipt('receipt_123', 'user_456', { status: 'completed' })).rejects.toThrow(dynamodbModule.OptimisticLockError);
    });

    it('should throw DynamoDBError for invalid data after update', async () => {
      const badReceipt = { receiptId: 'bad', userId: 'user' };
      mockSend
        .mockResolvedValueOnce({ Item: mockReceipt })
        .mockResolvedValueOnce({ Attributes: badReceipt });

      try {
        await dynamodbModule.updateReceipt('receipt_123', 'user_456', { status: 'completed' });
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('DATA_CORRUPTION');
      }
    });

    it('should update multiple fields at once', async () => {
      const updatedReceipt = {
        ...mockReceipt,
        metadata: { ...validMetadata, total: 20 },
        lineItems: [{ ...validLineItem, total: 20 }],
        version: 2,
        updatedAt: '2024-01-15T15:00:00.000Z',
      };
      mockSend
        .mockResolvedValueOnce({ Item: mockReceipt })
        .mockResolvedValueOnce({ Attributes: updatedReceipt });

      const result = await dynamodbModule.updateReceipt('receipt_123', 'user_456', {
        metadata: { ...validMetadata, total: 20 },
        lineItems: [{ ...validLineItem, total: 20 }],
      });

      expect(result.metadata.total).toBe(20);
      expect(result.lineItems[0].total).toBe(20);
    });
  });

  describe('deleteReceipt', () => {
    it('should delete a receipt successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(dynamodbModule.deleteReceipt('receipt_123', 'user_456')).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw ReceiptNotFoundError when receipt does not exist', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      await expect(dynamodbModule.deleteReceipt('receipt_123', 'user_456')).rejects.toThrow(dynamodbModule.ReceiptNotFoundError);
    });

    it('should throw DynamoDBError for other errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      try {
        await dynamodbModule.deleteReceipt('receipt_123', 'user_456');
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('DELETE_FAILED');
      }
    });
  });

  describe('queryReceipts', () => {
    it('should query receipts with filters', async () => {
      const mockResult = {
        Items: [mockReceipt],
        LastEvaluatedKey: undefined,
        Count: 1,
      };
      mockSend.mockResolvedValueOnce(mockResult);

      const result = await dynamodbModule.queryReceipts({
        userId: 'user_456',
        status: 'completed',
        limit: 10,
      });

      expect(result.items).toEqual([mockReceipt]);
      expect(result.count).toBe(1);
      expect(result.lastEvaluatedKey).toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should filter out invalid receipts from results', async () => {
      const badReceipt = { receiptId: 'bad', userId: 'user' };
      const mockResult = {
        Items: [mockReceipt, badReceipt],
        LastEvaluatedKey: undefined,
        Count: 2,
      };
      mockSend.mockResolvedValueOnce(mockResult);

      const result = await dynamodbModule.queryReceipts({ userId: 'user_456' });

      expect(result.items).toEqual([mockReceipt]);
      expect(result.count).toBe(1);
    });

    it('should return lastEvaluatedKey for pagination', async () => {
      const mockResult = {
        Items: [mockReceipt],
        LastEvaluatedKey: { receiptId: 'next', userId: 'user_456' },
        Count: 1,
      };
      mockSend.mockResolvedValueOnce(mockResult);

      const result = await dynamodbModule.queryReceipts({ userId: 'user_456' });

      expect(result.lastEvaluatedKey).toEqual({ receiptId: 'next', userId: 'user_456' });
    });

    it('should throw DynamoDBError for query errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Query failed'));

      try {
        await dynamodbModule.queryReceipts({ userId: 'user_456' });
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('QUERY_FAILED');
      }
    });

    it('should build correct filter expressions for all filter types', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

      await dynamodbModule.queryReceipts({
        userId: 'user_456',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        status: 'completed',
        categoryId: 'cat_food',
        minAmount: 10,
        maxAmount: 100,
        limit: 25,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      // The mock returns the input directly, so callArgs is the QueryCommand input
      expect(callArgs.FilterExpression).toContain('createdAt >= :startDate');
      expect(callArgs.FilterExpression).toContain('createdAt <= :endDate');
      expect(callArgs.FilterExpression).toContain('#status = :status');
      expect(callArgs.FilterExpression).toContain('contains(#categories, :categoryId)');
      expect(callArgs.FilterExpression).toContain('#total >= :minAmount');
      expect(callArgs.FilterExpression).toContain('#total <= :maxAmount');
      expect(callArgs.Limit).toBe(25);
    });
  });

  describe('scanReceipts', () => {
    it('should scan receipts with filters', async () => {
      const mockResult = {
        Items: [mockReceipt],
        LastEvaluatedKey: undefined,
        Count: 1,
      };
      mockSend.mockResolvedValueOnce(mockResult);

      const result = await dynamodbModule.scanReceipts('user_456', { status: 'completed' }, 10);

      expect(result.items).toEqual([mockReceipt]);
      expect(result.count).toBe(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw DynamoDBError for scan errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Scan failed'));

      try {
        await dynamodbModule.scanReceipts('user_456');
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('SCAN_FAILED');
      }
    });
  });

  describe('getReceiptCountByUser', () => {
    it('should return receipt count for user', async () => {
      mockSend.mockResolvedValueOnce({ Count: 5 });

      const count = await dynamodbModule.getReceiptCountByUser('user_456');

      expect(count).toBe(5);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return 0 when no receipts', async () => {
      mockSend.mockResolvedValueOnce({ Count: 0 });

      const count = await dynamodbModule.getReceiptCountByUser('user_456');

      expect(count).toBe(0);
    });

    it('should throw DynamoDBError for count errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Count failed'));

      try {
        await dynamodbModule.getReceiptCountByUser('user_456');
        fail('Expected DynamoDBError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(dynamodbModule.DynamoDBError);
        expect((err as dynamodbModule.DynamoDBError).code).toBe('COUNT_FAILED');
      }
    });
  });

  describe('getReceiptsByStatus', () => {
    it('should call queryReceipts with status filter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockReceipt], Count: 1 });

      const result = await dynamodbModule.getReceiptsByStatus('user_456', 'completed', 10);

      expect(result.items).toEqual([mockReceipt]);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Classes', () => {
    it('DynamoDBError should have correct properties', () => {
      const error = new dynamodbModule.DynamoDBError('Test error', 'TEST_CODE', 400);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('DynamoDBError');
    });

    it('ReceiptNotFoundError should have correct properties', () => {
      const error = new dynamodbModule.ReceiptNotFoundError('receipt_123');
      expect(error.message).toBe('Receipt not found: receipt_123');
      expect(error.code).toBe('RECEIPT_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('ReceiptNotFoundError');
    });

    it('ReceiptValidationError should have correct properties', () => {
      const error = new dynamodbModule.ReceiptValidationError('Invalid data');
      expect(error.message).toBe('Invalid data');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ReceiptValidationError');
    });

    it('OptimisticLockError should have correct properties', () => {
      const error = new dynamodbModule.OptimisticLockError('receipt_123');
      expect(error.message).toBe('Receipt has been modified by another process: receipt_123');
      expect(error.code).toBe('OPTIMISTIC_LOCK_ERROR');
      expect(error.statusCode).toBe(409);
      expect(error.name).toBe('OptimisticLockError');
    });
  });
});