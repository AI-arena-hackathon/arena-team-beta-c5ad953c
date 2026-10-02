import { exportReceipts, sendWebhook, ExportOptions, WebhookPayload } from './export';
import { ReceiptQueryFilters, Receipt } from '../types/receipt';
import { AppError } from '../utils/errors';

export class ExportSyncError extends AppError {
  constructor(message: string, code: string = 'EXPORT_SYNC_ERROR', statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'ExportSyncError';
  }
}

export interface SyncOptions {
  webhookUrl?: string;
  includeLineItems?: boolean;
  includeOcrText?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SyncResult {
  exported: {
    count: number;
    csv: string;
  };
  webhook?: {
    success: boolean;
    status?: number;
  };
  receipts: Receipt[];
}

export interface ExportSyncDeps {
  receiptStore: {
    query(filters: ReceiptQueryFilters): Promise<{ items: Receipt[]; lastEvaluatedKey?: Record<string, unknown>; count: number }>;
    list(filters: ReceiptQueryFilters): Promise<{ items: Receipt[]; lastEvaluatedKey?: Record<string, unknown>; count: number }>;
  };
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export async function exportAndSync(
  userId: string,
  filters: Omit<ReceiptQueryFilters, 'userId'> = {},
  options: SyncOptions = {},
  deps: ExportSyncDeps
): Promise<SyncResult> {
  const exportOptions: ExportOptions = {
    includeLineItems: options.includeLineItems,
    includeOcrText: options.includeOcrText,
  };

  const exportResult = await exportReceipts(userId, filters, exportOptions, {
    receiptStore: deps.receiptStore,
  });

  const result: SyncResult = {
    exported: {
      count: exportResult.count,
      csv: exportResult.csv,
    },
    receipts: exportResult.receipts,
  };

  if (options.webhookUrl) {
    try {
      const webhookResult = await sendWebhook(
        {
          receipts: exportResult.receipts,
          webhookUrl: options.webhookUrl,
          metadata: options.metadata,
        },
        { fetch: deps.fetch }
      );

      result.webhook = {
        success: webhookResult.success,
        status: webhookResult.status,
      };
    } catch (error) {
      // Don't fail the whole export if webhook fails
      result.webhook = {
        success: false,
      };
      // Still throw if webhook is explicitly requested and fails? Or just record
      // For now, record the failure but don't throw - the export succeeded
    }
  }

  return result;
}

export function generateExportFilename(userId: string, timestamp: Date = new Date()): string {
  const dateStr = timestamp.toISOString().split('T')[0];
  return `receipts_${userId}_${dateStr}.csv`;
}
