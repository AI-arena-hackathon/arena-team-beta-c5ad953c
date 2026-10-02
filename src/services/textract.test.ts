import { TextractClient, AnalyzeDocumentCommand, DetectDocumentTextCommand } from '@aws-sdk/client-textract';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(() => ({ send: mockSend })),
  AnalyzeDocumentCommand: jest.fn().mockImplementation((args) => args),
  DetectDocumentTextCommand: jest.fn().mockImplementation((args) => args),
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
    textract: {
      enabled: true,
      region: 'us-east-1',
    },
  })),
}));

import * as textractModule from './textract';
import { getConfig } from '../config';

describe('Textract Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    textractModule.resetTextractClient();
  });

  describe('detectDocumentText', () => {
    const validInput = {
      documentBytes: Buffer.from('fake-image-data'),
    };

    it('should return blocks from Textract', async () => {
      const mockBlocks = [
        { BlockType: 'LINE', Id: '1', Text: 'Merchant Name', Confidence: 99 },
        { BlockType: 'LINE', Id: '2', Text: 'Total: $100.00', Confidence: 98 },
        { BlockType: 'WORD', Id: '3', Text: 'Merchant', Confidence: 99 },
      ];
      mockSend.mockResolvedValue({
        Blocks: mockBlocks,
        DocumentMetadata: { Pages: 1 },
      });

      const result = await textractModule.detectDocumentText(validInput);

      expect(result.Blocks).toEqual(mockBlocks);
      expect(result.DocumentMetadata).toEqual({ Pages: 1 });
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(DetectDocumentTextCommand));
    });

    it('should throw TextractValidationError for empty documentBytes', async () => {
      await expect(textractModule.detectDocumentText({ documentBytes: Buffer.alloc(0) })).rejects.toThrow(
        'documentBytes is required and must not be empty'
      );
    });

    it('should throw TextractValidationError for missing documentBytes', async () => {
      await expect(textractModule.detectDocumentText({ documentBytes: null as any })).rejects.toThrow(
        'documentBytes is required and must not be empty'
      );
    });

    it('should throw TextractThrottledError on throttling', async () => {
      const error = new Error('Rate exceeded');
      error.name = 'ThrottlingException';
      mockSend.mockRejectedValue(error);

      await expect(textractModule.detectDocumentText(validInput)).rejects.toThrow('Textract request was throttled');
    });

    it('should throw TextractValidationError on invalid parameter', async () => {
      const error = new Error('Invalid parameter');
      error.name = 'InvalidParameterException';
      mockSend.mockRejectedValue(error);

      await expect(textractModule.detectDocumentText(validInput)).rejects.toThrow('Invalid parameter');
    });

    it('should throw TextractError on other errors', async () => {
      const error = new Error('Internal server error');
      error.name = 'InternalServerError';
      mockSend.mockRejectedValue(error);

      await expect(textractModule.detectDocumentText(validInput)).rejects.toThrow('Textract detect document text failed');
    });
  });

  describe('analyzeDocument', () => {
    const validInput = {
      documentBytes: Buffer.from('fake-image-data'),
      featureTypes: ['TABLES', 'FORMS'] as ('TABLES' | 'FORMS')[],
    };

    it('should return blocks from Textract analyze', async () => {
      const mockBlocks = [
        { BlockType: 'TABLE', Id: 'table1', Relationships: [{ Type: 'CHILD', Ids: ['cell1'] }] },
        { BlockType: 'CELL', Id: 'cell1', RowIndex: 1, ColumnIndex: 1, Text: 'Item', Confidence: 95 },
        { BlockType: 'KEY_VALUE_SET', Id: 'kv1', EntityTypes: ['KEY'], Relationships: [{ Type: 'CHILD', Ids: ['word1'] }, { Type: 'VALUE', Ids: ['kv2'] }] },
        { BlockType: 'WORD', Id: 'word1', Text: 'Total' },
        { BlockType: 'KEY_VALUE_SET', Id: 'kv2', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['word2'] }] },
        { BlockType: 'WORD', Id: 'word2', Text: '$100.00' },
      ];
      mockSend.mockResolvedValue({
        Blocks: mockBlocks,
        DocumentMetadata: { Pages: 1 },
        AnalyzeDocumentModelVersion: '1.0',
      });

      const result = await textractModule.analyzeDocument(validInput);

      expect(result.Blocks).toEqual(mockBlocks);
      expect(result.DocumentMetadata).toEqual({ Pages: 1 });
      expect(result.AnalyzeDocumentModelVersion).toBe('1.0');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(AnalyzeDocumentCommand));
    });

    it('should throw TextractValidationError for empty documentBytes', async () => {
      await expect(textractModule.analyzeDocument({ documentBytes: Buffer.alloc(0), featureTypes: ['TABLES'] })).rejects.toThrow(
        'documentBytes is required and must not be empty'
      );
    });

    it('should throw TextractValidationError for empty featureTypes', async () => {
      await expect(textractModule.analyzeDocument({ documentBytes: Buffer.from('data'), featureTypes: [] })).rejects.toThrow(
        'featureTypes must include at least one of TABLES or FORMS'
      );
    });

    it('should throw TextractThrottledError on throttling', async () => {
      const error = new Error('Rate exceeded');
      error.name = 'TooManyRequestsException';
      mockSend.mockRejectedValue(error);

      await expect(textractModule.analyzeDocument(validInput)).rejects.toThrow('Textract request was throttled');
    });
  });

  describe('extractRawText', () => {
    it('should extract and join LINE block texts', () => {
      const blocks = [
        { BlockType: 'LINE', Id: '1', Text: 'Line 1', Confidence: 99 },
        { BlockType: 'LINE', Id: '2', Text: 'Line 2', Confidence: 98 },
        { BlockType: 'WORD', Id: '3', Text: 'Not a line', Confidence: 97 },
      ];
      const result = textractModule.extractRawText(blocks);
      expect(result).toBe('Line 1\nLine 2');
    });

    it('should return empty string for no LINE blocks', () => {
      const blocks = [
        { BlockType: 'WORD', Id: '1', Text: 'Word', Confidence: 99 },
        { BlockType: 'PAGE', Id: '2' },
      ];
      const result = textractModule.extractRawText(blocks);
      expect(result).toBe('');
    });

    it('should handle LINE blocks without Text', () => {
      const blocks = [
        { BlockType: 'LINE', Id: '1', Text: 'Has text', Confidence: 99 },
        { BlockType: 'LINE', Id: '2', Confidence: 98 },
      ];
      const result = textractModule.extractRawText(blocks);
      expect(result).toBe('Has text');
    });
  });

  describe('extractKeyValuePairs', () => {
    it('should extract key-value pairs from KEY_VALUE_SET blocks', () => {
      const blocks = [
        { BlockType: 'KEY_VALUE_SET', Id: 'kv1', EntityTypes: ['KEY'], Relationships: [{ Type: 'CHILD', Ids: ['w1'] }, { Type: 'VALUE', Ids: ['kv2'] }] },
        { BlockType: 'WORD', Id: 'w1', Text: 'Total' },
        { BlockType: 'KEY_VALUE_SET', Id: 'kv2', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
        { BlockType: 'WORD', Id: 'w2', Text: '$100.00' },
      ];
      const result = textractModule.extractKeyValuePairs(blocks);
      expect(result).toEqual({ Total: '$100.00' });
    });

    it('should handle multiple key-value pairs', () => {
      const blocks = [
        { BlockType: 'KEY_VALUE_SET', Id: 'kv1', EntityTypes: ['KEY'], Relationships: [{ Type: 'CHILD', Ids: ['w1'] }, { Type: 'VALUE', Ids: ['kv2'] }] },
        { BlockType: 'WORD', Id: 'w1', Text: 'Merchant' },
        { BlockType: 'KEY_VALUE_SET', Id: 'kv2', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
        { BlockType: 'WORD', Id: 'w2', Text: 'Store ABC' },
        { BlockType: 'KEY_VALUE_SET', Id: 'kv3', EntityTypes: ['KEY'], Relationships: [{ Type: 'CHILD', Ids: ['w3'] }, { Type: 'VALUE', Ids: ['kv4'] }] },
        { BlockType: 'WORD', Id: 'w3', Text: 'Date' },
        { BlockType: 'KEY_VALUE_SET', Id: 'kv4', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: ['w4'] }] },
        { BlockType: 'WORD', Id: 'w4', Text: '2024-01-15' },
      ];
      const result = textractModule.extractKeyValuePairs(blocks);
      expect(result).toEqual({ Merchant: 'Store ABC', Date: '2024-01-15' });
    });

    it('should return empty object for no KEY_VALUE_SET blocks', () => {
      const blocks = [{ BlockType: 'LINE', Id: '1', Text: 'Just a line' }];
      const result = textractModule.extractKeyValuePairs(blocks);
      expect(result).toEqual({});
    });
  });

  describe('extractTables', () => {
    it('should extract table rows with cell text and confidence', () => {
      const blocks = [
        { BlockType: 'TABLE', Id: 't1', Relationships: [{ Type: 'CHILD', Ids: ['c1', 'c2', 'c3', 'c4'] }] },
        { BlockType: 'CELL', Id: 'c1', RowIndex: 1, ColumnIndex: 1, Relationships: [{ Type: 'CHILD', Ids: ['w1'] }], Confidence: 95 },
        { BlockType: 'WORD', Id: 'w1', Text: 'Item' },
        { BlockType: 'CELL', Id: 'c2', RowIndex: 1, ColumnIndex: 2, Relationships: [{ Type: 'CHILD', Ids: ['w2'] }], Confidence: 94 },
        { BlockType: 'WORD', Id: 'w2', Text: 'Price' },
        { BlockType: 'CELL', Id: 'c3', RowIndex: 2, ColumnIndex: 1, Relationships: [{ Type: 'CHILD', Ids: ['w3'] }], Confidence: 96 },
        { BlockType: 'WORD', Id: 'w3', Text: 'Burger' },
        { BlockType: 'CELL', Id: 'c4', RowIndex: 2, ColumnIndex: 2, Relationships: [{ Type: 'CHILD', Ids: ['w4'] }], Confidence: 93 },
        { BlockType: 'WORD', Id: 'w4', Text: '$10.00' },
      ];
      const result = textractModule.extractTables(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].rows).toHaveLength(2);
      expect(result[0].rows[0]).toEqual([
        { text: 'Item', confidence: 95 },
        { text: 'Price', confidence: 94 },
      ]);
      expect(result[0].rows[1]).toEqual([
        { text: 'Burger', confidence: 96 },
        { text: '$10.00', confidence: 93 },
      ]);
    });

    it('should return empty array for no TABLE blocks', () => {
      const blocks = [{ BlockType: 'LINE', Id: '1', Text: 'No tables here' }];
      const result = textractModule.extractTables(blocks);
      expect(result).toEqual([]);
    });
  });

  describe('isTextractEnabled', () => {
    it('should return true when Textract is enabled in config', () => {
      expect(textractModule.isTextractEnabled()).toBe(true);
    });

    it('should return false when Textract is disabled in config', () => {
      (getConfig as jest.Mock).mockReturnValueOnce({
        ...getConfig(),
        textract: { enabled: false, region: 'us-east-1' },
      });
      expect(textractModule.isTextractEnabled()).toBe(false);
    });
  });
});