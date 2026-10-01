export interface ReceiptLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  category?: string;
}

export interface ReceiptMetadata {
  merchantName: string;
  merchantAddress?: string;
  merchantPhone?: string;
  transactionDate: string;
  transactionTime?: string;
  subtotal: number;
  tax: number;
  tip?: number;
  total: number;
  currency: string;
  paymentMethod?: string;
  cardLast4?: string;
}

export interface ReceiptImage {
  s3Key: string;
  s3Bucket: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface ReceiptOcrResult {
  rawText: string;
  confidence: number;
  extractedFields: Record<string, string>;
  lineItems: ReceiptLineItem[];
  processingTimeMs: number;
  engine: 'textract' | 'tesseract';
}

export interface ReceiptCategory {
  id: string;
  name: string;
  confidence: number;
  source: 'rule' | 'ml' | 'manual';
}

export interface Receipt {
  receiptId: string;
  userId: string;
  metadata: ReceiptMetadata;
  lineItems: ReceiptLineItem[];
  images: ReceiptImage[];
  ocrResult?: ReceiptOcrResult;
  categories: ReceiptCategory[];
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'archived';
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateReceiptInput {
  userId: string;
  metadata: ReceiptMetadata;
  lineItems: ReceiptLineItem[];
  images: ReceiptImage[];
  ocrResult?: ReceiptOcrResult;
}

export interface UpdateReceiptInput {
  metadata?: Partial<ReceiptMetadata>;
  lineItems?: ReceiptLineItem[];
  ocrResult?: ReceiptOcrResult;
  categories?: ReceiptCategory[];
  status?: Receipt['status'];
}

export interface ReceiptQueryFilters {
  userId: string;
  startDate?: string;
  endDate?: string;
  status?: Receipt['status'];
  categoryId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ReceiptQueryResult {
  items: Receipt[];
  lastEvaluatedKey?: Record<string, unknown>;
  count: number;
}

export const RECEIPT_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

/** Images above this size are rejected before a presigned URL is signed (10 MB). */
export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024;

export function isSupportedReceiptImageType(contentType: string): boolean {
  return (RECEIPT_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType);
}

export const RECEIPT_STATUS_VALUES = ['pending', 'processing', 'completed', 'failed', 'archived'] as const;
export const OCR_ENGINE_VALUES = ['textract', 'tesseract'] as const;
export const CATEGORY_SOURCE_VALUES = ['rule', 'ml', 'manual'] as const;

export function validateReceiptLineItem(item: unknown): item is ReceiptLineItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.description === 'string' &&
    typeof i.quantity === 'number' &&
    typeof i.unitPrice === 'number' &&
    typeof i.total === 'number' &&
    (i.category === undefined || typeof i.category === 'string')
  );
}

export function validateReceiptMetadata(meta: unknown): meta is ReceiptMetadata {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  return (
    typeof m.merchantName === 'string' &&
    typeof m.transactionDate === 'string' &&
    typeof m.subtotal === 'number' &&
    typeof m.tax === 'number' &&
    typeof m.total === 'number' &&
    typeof m.currency === 'string' &&
    (m.merchantAddress === undefined || typeof m.merchantAddress === 'string') &&
    (m.merchantPhone === undefined || typeof m.merchantPhone === 'string') &&
    (m.transactionTime === undefined || typeof m.transactionTime === 'string') &&
    (m.tip === undefined || typeof m.tip === 'number') &&
    (m.paymentMethod === undefined || typeof m.paymentMethod === 'string') &&
    (m.cardLast4 === undefined || typeof m.cardLast4 === 'string')
  );
}

export function validateReceiptImage(img: unknown): img is ReceiptImage {
  if (!img || typeof img !== 'object') return false;
  const i = img as Record<string, unknown>;
  return (
    typeof i.s3Key === 'string' &&
    typeof i.s3Bucket === 'string' &&
    typeof i.contentType === 'string' &&
    typeof i.size === 'number' &&
    (i.width === undefined || typeof i.width === 'number') &&
    (i.height === undefined || typeof i.height === 'number')
  );
}

export function validateReceiptOcrResult(ocr: unknown): ocr is ReceiptOcrResult {
  if (!ocr || typeof ocr !== 'object') return false;
  const o = ocr as Record<string, unknown>;
  return (
    typeof o.rawText === 'string' &&
    typeof o.confidence === 'number' &&
    typeof o.extractedFields === 'object' &&
    Array.isArray(o.lineItems) &&
    o.lineItems.every(validateReceiptLineItem) &&
    typeof o.processingTimeMs === 'number' &&
    (o.engine === 'textract' || o.engine === 'tesseract')
  );
}

export function validateReceiptCategory(cat: unknown): cat is ReceiptCategory {
  if (!cat || typeof cat !== 'object') return false;
  const c = cat as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.confidence === 'number' &&
    (c.source === 'rule' || c.source === 'ml' || c.source === 'manual')
  );
}

export function validateReceipt(receipt: unknown): receipt is Receipt {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as Record<string, unknown>;
  return (
    typeof r.receiptId === 'string' &&
    typeof r.userId === 'string' &&
    validateReceiptMetadata(r.metadata) &&
    Array.isArray(r.lineItems) &&
    r.lineItems.every(validateReceiptLineItem) &&
    Array.isArray(r.images) &&
    r.images.every(validateReceiptImage) &&
    (r.ocrResult === undefined || validateReceiptOcrResult(r.ocrResult)) &&
    Array.isArray(r.categories) &&
    r.categories.every(validateReceiptCategory) &&
    (r.status === 'pending' || r.status === 'processing' || r.status === 'completed' || r.status === 'failed' || r.status === 'archived') &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    typeof r.version === 'number'
  );
}

export function validateCreateReceiptInput(input: unknown): input is CreateReceiptInput {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i.userId === 'string' &&
    validateReceiptMetadata(i.metadata) &&
    Array.isArray(i.lineItems) &&
    i.lineItems.every(validateReceiptLineItem) &&
    Array.isArray(i.images) &&
    i.images.every(validateReceiptImage) &&
    (i.ocrResult === undefined || validateReceiptOcrResult(i.ocrResult))
  );
}

export function validateUpdateReceiptInput(input: unknown): input is UpdateReceiptInput {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return (
    (i.metadata === undefined || validateReceiptMetadata(i.metadata)) &&
    (i.lineItems === undefined || (Array.isArray(i.lineItems) && i.lineItems.every(validateReceiptLineItem))) &&
    (i.ocrResult === undefined || validateReceiptOcrResult(i.ocrResult)) &&
    (i.categories === undefined || (Array.isArray(i.categories) && i.categories.every(validateReceiptCategory))) &&
    (i.status === undefined || RECEIPT_STATUS_VALUES.includes(i.status as Receipt['status']))
  );
}