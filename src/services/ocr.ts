import { ReceiptLineItem, ReceiptOcrResult } from '../types/receipt';
import {
  analyzeDocument,
  extractRawText,
  extractKeyValuePairs,
  extractTables,
  TextractThrottledError,
  TextractValidationError,
  isTextractEnabled,
  TextractBlock,
} from './textract';
import { AppError } from '../utils/errors';

export class OcrError extends AppError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'OcrError';
  }
}

export class OcrFallbackError extends OcrError {
  constructor(message: string, public readonly originalError: Error) {
    super(message, 'OCR_FALLBACK_FAILED', 500);
    this.name = 'OcrFallbackError';
  }
}

export interface OcrProcessingOptions {
  useTextract?: boolean;
  useFallback?: boolean;
  featureTypes?: ('TABLES' | 'FORMS')[];
}

export interface OcrProcessingResult {
  ocrResult: ReceiptOcrResult;
  engine: 'textract' | 'tesseract';
  warnings: string[];
}

const DEFAULT_FEATURE_TYPES: ('TABLES' | 'FORMS')[] = ['TABLES', 'FORMS'];

function parseAmount(text: string): number | null {
  const match = text.match(/[\$\£\€]?\s*(\d+(?:[.,]\d{2})?)/);
  if (match) {
    return parseFloat(match[1].replace(',', '.'));
  }
  return null;
}

function parseDate(text: string): string | null {
  const patterns = [
    /\b(\d{4}[-/]\d{2}[-/]\d{2})\b/,
    /\b(\d{2}[-/]\d{2}[-/]\d{4})\b/,
    /\b(\d{2}[-/]\d{2}[-/]\d{2})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].replace(/\//g, '-');
    }
  }
  return null;
}

function extractLineItemsFromTables(tables: ReturnType<typeof extractTables>): ReceiptLineItem[] {
  const lineItems: ReceiptLineItem[] = [];

  for (const table of tables) {
    if (table.rows.length < 2) continue;

    const headerRow = table.rows[0].map((cell) => cell.text.toLowerCase());
    const descIdx = headerRow.findIndex((h) => h.includes('item') || h.includes('description') || h.includes('product'));
    const qtyIdx = headerRow.findIndex((h) => h.includes('qty') || h.includes('quantity') || h.includes('count'));
    const priceIdx = headerRow.findIndex((h) => h.includes('price') || h.includes('unit') || h.includes('cost'));
    const totalIdx = headerRow.findIndex((h) => h.includes('total') || h.includes('amount') || h.includes('sum'));

    for (let i = 1; i < table.rows.length; i++) {
      const row = table.rows[i];
      const description = row[descIdx >= 0 ? descIdx : 0]?.text || '';
      const quantity = qtyIdx >= 0 && row[qtyIdx] ? parseFloat(row[qtyIdx].text) || 1 : 1;
      const unitPrice = priceIdx >= 0 && row[priceIdx] ? parseAmount(row[priceIdx].text) ?? 0 : 0;
      const total = totalIdx >= 0 && row[totalIdx] ? parseAmount(row[totalIdx].text) ?? unitPrice * quantity : unitPrice * quantity;

      if (description && total > 0) {
        lineItems.push({
          description: description.trim(),
          quantity,
          unitPrice: unitPrice || total / quantity,
          total,
          category: undefined,
        });
      }
    }
  }

  return lineItems;
}

function extractLineItemsFromText(rawText: string): ReceiptLineItem[] {
  const lineItems: ReceiptLineItem[] = [];
  const lines = rawText.split('\n');

  for (const line of lines) {
    const amountMatch = line.match(/^(.+?)\s+[\$\£\€]?\s*(\d+(?:[.,]\d{2})?)\s*$/);
    if (amountMatch) {
      const description = amountMatch[1].trim();
      const amount = parseFloat(amountMatch[2].replace(',', '.'));
      if (description.length > 2 && amount > 0) {
        lineItems.push({
          description,
          quantity: 1,
          unitPrice: amount,
          total: amount,
        });
      }
    }
  }

  return lineItems;
}

function calculateConfidence(blocks: TextractBlock[]): number {
  const lineBlocks = blocks.filter((b) => b.BlockType === 'LINE' && b.Confidence !== undefined);
  if (lineBlocks.length === 0) return 0;
  const sum = lineBlocks.reduce((acc, b) => acc + (b.Confidence || 0), 0);
  return Math.round(sum / lineBlocks.length);
}

export async function processReceiptOcr(
  imageBytes: Buffer,
  options: OcrProcessingOptions = {}
): Promise<OcrProcessingResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  const useTextract = options.useTextract ?? isTextractEnabled();
  const useFallback = options.useFallback ?? true;
  const featureTypes = options.featureTypes ?? DEFAULT_FEATURE_TYPES;

  let ocrResult: ReceiptOcrResult | null = null;
  let engine: 'textract' | 'tesseract' = 'textract';

  if (useTextract) {
    try {
      const analyzeResult = await analyzeDocument({
        documentBytes: imageBytes,
        featureTypes,
      });

      const rawText = extractRawText(analyzeResult.Blocks);
      const extractedFields = extractKeyValuePairs(analyzeResult.Blocks);
      const tables = extractTables(analyzeResult.Blocks);
      let lineItems = extractLineItemsFromTables(tables);

      if (lineItems.length === 0) {
        lineItems = extractLineItemsFromText(rawText);
      }

      const confidence = calculateConfidence(analyzeResult.Blocks);

      ocrResult = {
        rawText,
        confidence,
        extractedFields,
        lineItems,
        processingTimeMs: Date.now() - startTime,
        engine: 'textract',
      };
    } catch (error) {
      if (error instanceof TextractThrottledError && useFallback) {
        warnings.push('Textract throttled, falling back to Tesseract');
      } else if (error instanceof TextractValidationError) {
        throw new OcrError(`Invalid input for Textract: ${error.message}`, 'INVALID_INPUT', 400);
      } else if (!useFallback) {
        throw new OcrError(`Textract processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'TEXTRACT_FAILED');
      } else {
        warnings.push(`Textract failed: ${error instanceof Error ? error.message : 'Unknown error'}, falling back to Tesseract`);
      }
    }
  } else {
    warnings.push('Textract disabled, using Tesseract fallback');
  }

  if (!ocrResult) {
    try {
      ocrResult = await processWithTesseract(imageBytes, startTime);
      engine = 'tesseract';
    } catch (error) {
      throw new OcrFallbackError(
        `Tesseract fallback failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error('Unknown Tesseract error')
      );
    }
  }

  return { ocrResult, engine, warnings };
}

async function processWithTesseract(imageBytes: Buffer, startTime: number): Promise<ReceiptOcrResult> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const { writeFile, unlink, mkdtemp } = await import('fs/promises');
  const { join } = await import('path');

  const execFileAsync = promisify(execFile);

  const tempDir = await mkdtemp(join(tmpdir(), 'ocr-'));
  const imagePath = join(tempDir, 'receipt.png');
  const outputBase = join(tempDir, 'output');

  try {
    await writeFile(imagePath, imageBytes);

    await execFileAsync('tesseract', [imagePath, outputBase, '-l', 'eng', '--psm', '6', 'txt']);

    const { readFile } = await import('fs/promises');
    const rawText = await readFile(`${outputBase}.txt`, 'utf-8');

    const lines = rawText.split('\n').filter((l) => l.trim().length > 0);
    const confidence = 70;

    const extractedFields: Record<string, string> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key && value) extractedFields[key] = value;
      }
    }

    let lineItems = extractLineItemsFromText(rawText);
    if (lineItems.length === 0) {
      for (const line of lines) {
        const amount = parseAmount(line);
        if (amount !== null && line.length > 3) {
          lineItems.push({
            description: line.trim(),
            quantity: 1,
            unitPrice: amount,
            total: amount,
          });
        }
      }
    }

    return {
      rawText: rawText.trim(),
      confidence,
      extractedFields,
      lineItems,
      processingTimeMs: Date.now() - startTime,
      engine: 'tesseract',
    };
  } finally {
    try {
      await unlink(imagePath);
      await unlink(`${outputBase}.txt`);
      const { rmdir } = await import('fs/promises');
      await rmdir(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export function validateOcrResult(ocr: unknown): ocr is ReceiptOcrResult {
  if (!ocr || typeof ocr !== 'object') return false;
  const o = ocr as Record<string, unknown>;
  return (
    typeof o.rawText === 'string' &&
    typeof o.confidence === 'number' &&
    typeof o.extractedFields === 'object' &&
    Array.isArray(o.lineItems) &&
    o.lineItems.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const i = item as Record<string, unknown>;
      return (
        typeof i.description === 'string' &&
        typeof i.quantity === 'number' &&
        typeof i.unitPrice === 'number' &&
        typeof i.total === 'number'
      );
    }) &&
    typeof o.processingTimeMs === 'number' &&
    (o.engine === 'textract' || o.engine === 'tesseract')
  );
}