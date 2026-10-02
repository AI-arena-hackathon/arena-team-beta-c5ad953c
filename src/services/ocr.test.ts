import { processReceiptOcr, validateOcrResult, OcrError, OcrFallbackError } from './ocr';
import { TextractThrottledError, TextractValidationError } from './textract';
import { ReceiptLineItem } from '../types/receipt';

jest.mock('./textract', () => {
  const actual = jest.requireActual('./textract');
  return {
    ...actual,
    isTextractEnabled: jest.fn(() => true),
    detectDocumentText: jest.fn(),
    analyzeDocument: jest.fn(),
    extractRawText: jest.fn(),
    extractKeyValuePairs: jest.fn(),
    extractTables: jest.fn(),
    TextractThrottledError: actual.TextractThrottledError,
    TextractValidationError: actual.TextractValidationError,
  };
});

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  mkdtemp: jest.fn(),
  rmdir: jest.fn(),
}));

jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp'),
}));

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
}));

jest.mock('util', () => ({
  promisify: jest.fn((fn) => fn),
}));

import * as textractModule from './textract';
import { execFile } from 'child_process';
import { readFile } from 'fs/promises';

const mockImageBytes = Buffer.from('fake-image-data');
const mockExecFile = execFile as unknown as jest.Mock;
const mockReadFile = readFile as unknown as jest.Mock;

describe('OCR Processing Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (textractModule.isTextractEnabled as jest.Mock).mockReturnValue(true);
  });

  describe('processReceiptOcr', () => {
    it('should process with Textract and return ocrResult', async () => {
      const mockBlocks = [
        { BlockType: 'LINE', Id: '1', Text: 'Merchant Name', Confidence: 99 },
        { BlockType: 'LINE', Id: '2', Text: 'Total: $100.00', Confidence: 98 },
        { BlockType: 'TABLE', Id: 't1', Relationships: [{ Type: 'CHILD', Ids: ['c1', 'c2'] }] },
        { BlockType: 'CELL', Id: 'c1', RowIndex: 1, ColumnIndex: 1, Relationships: [{ Type: 'CHILD', Ids: ['w1'] }], Confidence: 95 },
        { BlockType: 'WORD', Id: 'w1', Text: 'Item' },
        { BlockType: 'CELL', Id: 'c2', RowIndex: 1, ColumnIndex: 2, Relationships: [{ Type: 'CHILD', Ids: ['w2'] }], Confidence: 94 },
        { BlockType: 'WORD', Id: 'w2', Text: 'Price' },
      ];

      (textractModule.analyzeDocument as jest.Mock).mockResolvedValue({
        Blocks: mockBlocks,
        DocumentMetadata: { Pages: 1 },
      });

      (textractModule.extractRawText as jest.Mock).mockReturnValue('Merchant Name\nTotal: $100.00');
      (textractModule.extractKeyValuePairs as jest.Mock).mockReturnValue({ Total: '$100.00' });
      (textractModule.extractTables as jest.Mock).mockReturnValue([
        {
          rows: [
            [{ text: 'Item', confidence: 95 }, { text: 'Price', confidence: 94 }],
            [{ text: 'Burger', confidence: 96 }, { text: '$10.00', confidence: 93 }],
          ],
        },
      ]);

      const result = await processReceiptOcr(mockImageBytes);

      expect(result.engine).toBe('textract');
      expect(result.ocrResult.engine).toBe('textract');
      expect(result.ocrResult.rawText).toBe('Merchant Name\nTotal: $100.00');
      expect(result.ocrResult.extractedFields).toEqual({ Total: '$100.00' });
      expect(result.ocrResult.lineItems).toHaveLength(1);
      expect(result.ocrResult.lineItems[0].description).toBe('Burger');
      expect(result.ocrResult.confidence).toBeGreaterThan(0);
      expect(result.ocrResult.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should fallback to Tesseract when Textract is throttled', async () => {
      (textractModule.analyzeDocument as jest.Mock).mockRejectedValue(new TextractThrottledError());

      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      mockReadFile.mockResolvedValue('Merchant: Test Store\nTotal: $50.00\nBurger $10.00\nFries $5.00');

      const result = await processReceiptOcr(mockImageBytes, { useFallback: true });

      expect(result.engine).toBe('tesseract');
      expect(result.ocrResult.engine).toBe('tesseract');
      expect(result.warnings).toContainEqual(expect.stringContaining('throttled'));
    });

    it('should throw OcrError when Textract fails and fallback is disabled', async () => {
      (textractModule.analyzeDocument as jest.Mock).mockRejectedValue(new Error('Textract internal error'));

      await expect(processReceiptOcr(mockImageBytes, { useFallback: false })).rejects.toThrow(OcrError);
    });

    it('should throw OcrError for invalid input', async () => {
      (textractModule.analyzeDocument as jest.Mock).mockRejectedValue(new TextractValidationError('Invalid document'));

      await expect(processReceiptOcr(mockImageBytes)).rejects.toThrow(OcrError);
    });

    it('should use Tesseract when Textract is disabled', async () => {
      (textractModule.isTextractEnabled as jest.Mock).mockReturnValue(false);

      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      mockReadFile.mockResolvedValue('Merchant: Test Store\nTotal: $50.00');

      const result = await processReceiptOcr(mockImageBytes);

      expect(result.engine).toBe('tesseract');
      expect(result.warnings).toContainEqual(expect.stringContaining('disabled'));
    });

    it('should extract line items from text when no tables found', async () => {
      const mockBlocks = [
        { BlockType: 'LINE', Id: '1', Text: 'Burger $10.00', Confidence: 99 },
        { BlockType: 'LINE', Id: '2', Text: 'Fries $5.00', Confidence: 98 },
      ];

      (textractModule.analyzeDocument as jest.Mock).mockResolvedValue({
        Blocks: mockBlocks,
        DocumentMetadata: { Pages: 1 },
      });

      (textractModule.extractRawText as jest.Mock).mockReturnValue('Burger $10.00\nFries $5.00');
      (textractModule.extractKeyValuePairs as jest.Mock).mockReturnValue({});
      (textractModule.extractTables as jest.Mock).mockReturnValue([]);

      const result = await processReceiptOcr(mockImageBytes);

      expect(result.ocrResult.lineItems).toHaveLength(2);
      expect(result.ocrResult.lineItems[0].description).toBe('Burger');
      expect(result.ocrResult.lineItems[0].total).toBe(10.0);
      expect(result.ocrResult.lineItems[1].description).toBe('Fries');
      expect(result.ocrResult.lineItems[1].total).toBe(5.0);
    });
  });

  describe('validateOcrResult', () => {
    const validOcrResult = {
      rawText: 'Test receipt',
      confidence: 95,
      extractedFields: { Merchant: 'Test', Total: '$100' },
      lineItems: [
        { description: 'Item 1', quantity: 1, unitPrice: 50, total: 50 },
        { description: 'Item 2', quantity: 2, unitPrice: 25, total: 50 },
      ],
      processingTimeMs: 1000,
      engine: 'textract' as const,
    };

    it('should return true for valid OCR result', () => {
      expect(validateOcrResult(validOcrResult)).toBe(true);
    });

    it('should return false for missing rawText', () => {
      const invalid = { ...validOcrResult };
      delete (invalid as any).rawText;
      expect(validateOcrResult(invalid)).toBe(false);
    });

    it('should return false for invalid confidence', () => {
      const invalid = { ...validOcrResult, confidence: 'high' };
      expect(validateOcrResult(invalid)).toBe(false);
    });

    it('should return false for invalid lineItems', () => {
      const invalid = { ...validOcrResult, lineItems: [{ description: 'test' }] };
      expect(validateOcrResult(invalid)).toBe(false);
    });

    it('should return false for invalid engine', () => {
      const invalid = { ...validOcrResult, engine: 'google-vision' };
      expect(validateOcrResult(invalid)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(validateOcrResult(null)).toBe(false);
      expect(validateOcrResult(undefined)).toBe(false);
    });
  });
});