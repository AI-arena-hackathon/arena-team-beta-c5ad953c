import { Receipt, ReceiptMetadata, ReceiptLineItem, ReceiptImage, ReceiptOcrResult, ReceiptCategory } from '../types/receipt';
import { processReceiptOcr, OcrError, OcrFallbackError } from './ocr';
import { categorizeReceipt, CategorizationResult } from './categorize';
import type { ImageStore } from './object-store';
import { AppError } from '../utils/errors';

export class ProcessingError extends AppError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'ProcessingError';
  }
}

export class ReceiptNotFoundForProcessingError extends ProcessingError {
  constructor(receiptId: string) {
    super(`Receipt not found for processing: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
    this.name = 'ReceiptNotFoundForProcessingError';
  }
}

export class ReceiptNotPendingError extends ProcessingError {
  constructor(receiptId: string, currentStatus: Receipt['status']) {
    super(`Receipt is not in pending status: ${receiptId} (status: ${currentStatus})`, 'INVALID_STATUS', 409);
    this.name = 'ReceiptNotPendingError';
  }
}

export interface ProcessingOptions {
  useTextract?: boolean;
  useOcrFallback?: boolean;
  customCategorizationRules?: ReturnType<typeof import('./categorize').getDefaultRules>;
}

export interface ProcessingResult {
  receipt: Receipt;
  ocrWarnings: string[];
  categorization: CategorizationResult;
}

export interface ReceiptProcessorDeps {
  receiptStore: {
    get(receiptId: string, userId: string): Promise<Receipt | null>;
    update(receiptId: string, userId: string, changes: Partial<Receipt>): Promise<Receipt | null>;
  };
  imageStore: ImageStore;
}

function getImageKey(receipt: Receipt, index: number = 0): string {
  const image = receipt.images[index];
  if (!image) {
    throw new ProcessingError(`Receipt has no image at index ${index}`, 'NO_IMAGE', 400);
  }
  return image.s3Key;
}

async function fetchImageBytes(imageStore: ImageStore, receipt: Receipt, index: number = 0): Promise<Buffer> {
  const key = getImageKey(receipt, index);
  const token = key.startsWith('memory://') ? key.slice('memory://'.length) : key;

  const bytes = await imageStore.get(token);
  if (!bytes) {
    throw new ProcessingError(`Failed to fetch image bytes for receipt ${receipt.receiptId}`, 'IMAGE_FETCH_FAILED', 500);
  }
  return bytes;
}

function buildMetadataFromOcr(ocrResult: ReceiptOcrResult, existingMetadata: ReceiptMetadata): ReceiptMetadata {
  const fields = ocrResult.extractedFields;
  const metadata: ReceiptMetadata = { ...existingMetadata };

  if (fields.Merchant || fields['Merchant Name'] || fields['Store Name']) {
    metadata.merchantName = fields.Merchant || fields['Merchant Name'] || fields['Store Name'] || metadata.merchantName;
  }
  if (fields.Address || fields['Merchant Address']) {
    metadata.merchantAddress = fields.Address || fields['Merchant Address'] || metadata.merchantAddress;
  }
  if (fields.Phone || fields['Merchant Phone'] || fields.Telephone) {
    metadata.merchantPhone = fields.Phone || fields['Merchant Phone'] || fields.Telephone || metadata.merchantPhone;
  }
  if (fields.Date || fields['Transaction Date'] || fields['Purchase Date']) {
    metadata.transactionDate = fields.Date || fields['Transaction Date'] || fields['Purchase Date'] || metadata.transactionDate;
  }
  if (fields.Time || fields['Transaction Time'] || fields['Purchase Time']) {
    metadata.transactionTime = fields.Time || fields['Transaction Time'] || fields['Purchase Time'] || metadata.transactionTime;
  }
  if (fields.Subtotal || fields['Sub Total']) {
    const subtotal = parseFloat(String(fields.Subtotal || fields['Sub Total']).replace(/[^\d.]/g, ''));
    if (!isNaN(subtotal)) metadata.subtotal = subtotal;
  }
  if (fields.Tax || fields['Sales Tax'] || fields.VAT) {
    const tax = parseFloat(String(fields.Tax || fields['Sales Tax'] || fields.VAT).replace(/[^\d.]/g, ''));
    if (!isNaN(tax)) metadata.tax = tax;
  }
  if (fields.Tip || fields.Gratuity) {
    const tip = parseFloat(String(fields.Tip || fields.Gratuity).replace(/[^\d.]/g, ''));
    if (!isNaN(tip)) metadata.tip = tip;
  }
  if (fields.Total || fields.Amount || fields['Grand Total']) {
    const total = parseFloat(String(fields.Total || fields.Amount || fields['Grand Total']).replace(/[^\d.]/g, ''));
    if (!isNaN(total)) metadata.total = total;
  }
  if (fields.Currency || fields['Currency Code']) {
    metadata.currency = fields.Currency || fields['Currency Code'] || metadata.currency;
  }
  if (fields.Payment || fields['Payment Method'] || fields['Card Type']) {
    metadata.paymentMethod = fields.Payment || fields['Payment Method'] || fields['Card Type'] || metadata.paymentMethod;
  }
  if (fields['Card Last 4'] || fields['Card Number'] || fields['Last 4']) {
    const card = String(fields['Card Last 4'] || fields['Card Number'] || fields['Last 4']).replace(/\D/g, '').slice(-4);
    if (card.length === 4) metadata.cardLast4 = card;
  }

  return metadata;
}

function buildLineItemsFromOcr(ocrResult: ReceiptOcrResult, existingLineItems: ReceiptLineItem[]): ReceiptLineItem[] {
  if (ocrResult.lineItems.length > 0) {
    return ocrResult.lineItems.map((item, index) => ({
      ...item,
      description: item.description || existingLineItems[index]?.description || `Item ${index + 1}`,
    }));
  }
  return existingLineItems;
}

export async function processReceipt(
  receiptId: string,
  userId: string,
  deps: ReceiptProcessorDeps,
  options: ProcessingOptions = {}
): Promise<ProcessingResult> {
  const receipt = await deps.receiptStore.get(receiptId, userId);
  if (!receipt) {
    throw new ReceiptNotFoundForProcessingError(receiptId);
  }
  if (receipt.status !== 'pending' && receipt.status !== 'processing') {
    throw new ReceiptNotPendingError(receiptId, receipt.status);
  }

  await deps.receiptStore.update(receiptId, userId, { status: 'processing' });

  let ocrWarnings: string[] = [];
  let ocrResult: ReceiptOcrResult | undefined;
  let updatedMetadata = receipt.metadata;
  let updatedLineItems = receipt.lineItems;

  try {
    const imageBytes = await fetchImageBytes(deps.imageStore, receipt, 0);

    const ocrProcessingResult = await processReceiptOcr(imageBytes, {
      useTextract: options.useTextract,
      useFallback: options.useOcrFallback,
    });

    ocrResult = ocrProcessingResult.ocrResult;
    ocrWarnings = ocrProcessingResult.warnings;

    updatedMetadata = buildMetadataFromOcr(ocrResult, receipt.metadata);
    updatedLineItems = buildLineItemsFromOcr(ocrResult, receipt.lineItems);

    const updatedReceipt = await deps.receiptStore.update(receiptId, userId, {
      metadata: updatedMetadata,
      lineItems: updatedLineItems,
      ocrResult,
      status: 'processing',
    });

    if (!updatedReceipt) {
      throw new ProcessingError('Failed to update receipt with OCR results', 'UPDATE_FAILED', 500);
    }
  } catch (error) {
    if (error instanceof OcrError || error instanceof OcrFallbackError) {
      await deps.receiptStore.update(receiptId, userId, {
        status: 'failed',
      });
      throw new ProcessingError(`OCR processing failed: ${error.message}`, 'OCR_FAILED', 500);
    }
    if (error instanceof ProcessingError) {
      await deps.receiptStore.update(receiptId, userId, { status: 'failed' });
      throw error;
    }
    await deps.receiptStore.update(receiptId, userId, { status: 'failed' });
    throw new ProcessingError(`Unexpected error during OCR: ${error instanceof Error ? error.message : 'Unknown error'}`, 'PROCESSING_FAILED', 500);
  }

  let categorization: CategorizationResult;
  try {
    categorization = categorizeReceipt(
      updatedMetadata,
      updatedLineItems,
      ocrResult,
      options.customCategorizationRules
    );

    const finalReceipt = await deps.receiptStore.update(receiptId, userId, {
      lineItems: categorization.categorizedLineItems,
      categories: categorization.categories,
      status: 'completed',
    });

    if (!finalReceipt) {
      throw new ProcessingError('Failed to update receipt with categorization results', 'UPDATE_FAILED', 500);
    }

    return {
      receipt: finalReceipt,
      ocrWarnings,
      categorization,
    };
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    await deps.receiptStore.update(receiptId, userId, { status: 'failed' });
    throw new ProcessingError(`Categorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'CATEGORIZATION_FAILED', 500);
  }
}

export async function reprocessReceipt(
  receiptId: string,
  userId: string,
  deps: ReceiptProcessorDeps,
  options: ProcessingOptions = {}
): Promise<ProcessingResult> {
  const receipt = await deps.receiptStore.get(receiptId, userId);
  if (!receipt) {
    throw new ReceiptNotFoundForProcessingError(receiptId);
  }

  if (receipt.status !== 'completed' && receipt.status !== 'failed') {
    throw new ReceiptNotPendingError(receiptId, receipt.status);
  }

  await deps.receiptStore.update(receiptId, userId, { status: 'processing' });

  return processReceipt(receiptId, userId, deps, options);
}

export async function processReceiptBatch(
  receiptIds: string[],
  userId: string,
  deps: ReceiptProcessorDeps,
  options: ProcessingOptions = {}
): Promise<Array<{ receiptId: string; result?: ProcessingResult; error?: Error }>> {
  const results = await Promise.allSettled(
    receiptIds.map((id) => processReceipt(id, userId, deps, options))
  );

  return results.map((result, index) => ({
    receiptId: receiptIds[index],
    result: result.status === 'fulfilled' ? result.value : undefined,
    error: result.status === 'rejected' ? result.reason : undefined,
  }));
}