import { Receipt, ReceiptQueryFilters } from '../types/receipt';
import { AppError } from '../utils/errors';

export class ExportError extends AppError {
  constructor(message: string, code: string = 'EXPORT_ERROR', statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'ExportError';
  }
}

export class WebhookError extends AppError {
  constructor(message: string, code: string = 'WEBHOOK_ERROR', statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'WebhookError';
  }
}

export interface ExportOptions {
  includeLineItems?: boolean;
  includeOcrText?: boolean;
}

export interface WebhookPayload {
  receipts: Receipt[];
  webhookUrl: string;
  metadata?: Record<string, unknown>;
}

export function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return str;
}

export function receiptToCsvRow(receipt: Receipt): Record<string, string> {
  return {
    receiptId: receipt.receiptId,
    userId: receipt.userId,
    merchantName: receipt.metadata.merchantName,
    merchantAddress: receipt.metadata.merchantAddress || '',
    merchantPhone: receipt.metadata.merchantPhone || '',
    transactionDate: receipt.metadata.transactionDate,
    transactionTime: receipt.metadata.transactionTime || '',
    subtotal: String(receipt.metadata.subtotal),
    tax: String(receipt.metadata.tax),
    tip: receipt.metadata.tip !== undefined ? String(receipt.metadata.tip) : '',
    total: String(receipt.metadata.total),
    currency: receipt.metadata.currency,
    paymentMethod: receipt.metadata.paymentMethod || '',
    cardLast4: receipt.metadata.cardLast4 || '',
    status: receipt.status,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
    lineItemsCount: String(receipt.lineItems.length),
    categoriesCount: String(receipt.categories.length),
  };
}

export function receiptsToCsv(receipts: Receipt[], options: ExportOptions = {}): string {
  if (receipts.length === 0) {
    const header = [
      'receiptId',
      'userId',
      'merchantName',
      'merchantAddress',
      'merchantPhone',
      'transactionDate',
      'transactionTime',
      'subtotal',
      'tax',
      'tip',
      'total',
      'currency',
      'paymentMethod',
      'cardLast4',
      'status',
      'createdAt',
      'updatedAt',
      'lineItemsCount',
      'categoriesCount',
    ];
    if (options.includeLineItems) {
      header.push('lineItemsJson');
    }
    if (options.includeOcrText) {
      header.push('ocrRawText');
    }
    return header.map(formatCsvValue).join(',') + '\n';
  }

  const baseHeader = Object.keys(receiptToCsvRow(receipts[0]));
  const header = [...baseHeader];
  if (options.includeLineItems) {
    header.push('lineItemsJson');
  }
  if (options.includeOcrText) {
    header.push('ocrRawText');
  }

  const rows = receipts.map((receipt) => {
    const baseRow = receiptToCsvRow(receipt);
    const row: string[] = header.map((h) => {
      if (h in baseRow) {
        return formatCsvValue(baseRow[h]);
      }
      if (h === 'lineItemsJson' && options.includeLineItems) {
        return formatCsvValue(JSON.stringify(receipt.lineItems));
      }
      if (h === 'ocrRawText' && options.includeOcrText) {
        return formatCsvValue(receipt.ocrResult?.rawText || '');
      }
      return '';
    });
    return row.join(',');
  });

  return [header.map(formatCsvValue).join(','), ...rows].join('\n') + (rows.length > 0 ? '\n' : '');
}

export interface ExportServiceDeps {
  receiptStore: {
    query(filters: ReceiptQueryFilters): Promise<{ items: Receipt[]; lastEvaluatedKey?: Record<string, unknown>; count: number }>;
    list(filters: ReceiptQueryFilters): Promise<{ items: Receipt[]; lastEvaluatedKey?: Record<string, unknown>; count: number }>;
  };
}

export async function exportReceipts(
  userId: string,
  filters: Omit<ReceiptQueryFilters, 'userId'> = {},
  options: ExportOptions = {},
  deps: ExportServiceDeps
): Promise<{ csv: string; receipts: Receipt[]; count: number }> {
  const result = await deps.receiptStore.list({
    userId,
    ...filters,
  });

  const csv = receiptsToCsv(result.items, options);
  return {
    csv,
    receipts: result.items,
    count: result.count,
  };
}

export interface WebhookServiceDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export async function sendWebhook(
  payload: WebhookPayload,
  deps: WebhookServiceDeps = {}
): Promise<{ success: boolean; status?: number; response?: string }> {
  const fetchFn = deps.fetch || global.fetch || ((url: string) => Promise.reject(new Error('fetch not available')));
  
  try {
    const response = await fetchFn(payload.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receipts: payload.receipts.map((r) => ({
          receiptId: r.receiptId,
          userId: r.userId,
          metadata: r.metadata,
          lineItems: r.lineItems,
          categories: r.categories,
          total: r.metadata.total,
          currency: r.metadata.currency,
          transactionDate: r.metadata.transactionDate,
          status: r.status,
        })),
        count: payload.receipts.length,
        ...payload.metadata,
      }),
    });

    const responseText = await response.text().catch(() => '');

    if (!response.ok) {
      throw new WebhookError(`Webhook request failed with status ${response.status}`, 'WEBHOOK_FAILED', response.status);
    }

    return {
      success: true,
      status: response.status,
      response: responseText,
    };
  } catch (error) {
    if (error instanceof WebhookError) {
      throw error;
    }
    throw new WebhookError(
      `Webhook request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'WEBHOOK_FAILED'
    );
  }
}
