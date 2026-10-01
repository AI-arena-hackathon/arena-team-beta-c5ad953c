import {
  createReceipt,
  deleteReceipt,
  getReceipt,
  queryReceipts,
  updateReceipt,
  DynamoDBError,
  ReceiptValidationError,
} from './dynamodb';
import { ReceiptNotFoundError, StoreError, type ReceiptStore } from './store';
import type { Receipt, UpdateReceiptInput } from '../types/receipt';

/**
 * `ReceiptStore` adapter over DynamoDB. DynamoDB has no partial-update helper in
 * the service layer, so changes are funnelled through the existing typed
 * `updateReceipt` (which handles optimistic locking) and mapped back to the port.
 */
export function createDynamoReceiptStore(): ReceiptStore {
  const wrap = (error: unknown, fallbackCode: string): never => {
    if (error instanceof DynamoDBError) {
      if (error.code === 'RECEIPT_NOT_FOUND') {
        throw new ReceiptNotFoundError(error.message.replace(/^Receipt not found: /, ''));
      }
      throw new StoreError(error.message, error.code || fallbackCode, error.statusCode);
    }
    throw new StoreError(
      error instanceof Error ? error.message : 'Unknown error',
      fallbackCode,
      500
    );
  };

  return {
    async save(receipt: Receipt): Promise<Receipt> {
      if (receipt.userId === undefined) {
        throw new ReceiptValidationError('receipt.userId is required');
      }
      try {
        return await createReceipt({
          userId: receipt.userId,
          metadata: receipt.metadata,
          lineItems: receipt.lineItems,
          images: receipt.images,
          ocrResult: receipt.ocrResult,
        });
      } catch (error) {
        return wrap(error, 'CREATE_FAILED');
      }
    },

    async get(receiptId: string, userId: string): Promise<Receipt | null> {
      try {
        return await getReceipt(receiptId, userId);
      } catch (error) {
        if (error instanceof DynamoDBError && error.code === 'RECEIPT_NOT_FOUND') return null;
        return wrap(error, 'GET_FAILED');
      }
    },

    async update(receiptId: string, userId: string, changes: Partial<Receipt>): Promise<Receipt | null> {
      const input: UpdateReceiptInput = {};
      if (changes.metadata) input.metadata = { ...changes.metadata };
      if (changes.lineItems) input.lineItems = changes.lineItems;
      if (changes.ocrResult !== undefined) input.ocrResult = changes.ocrResult;
      if (changes.categories) input.categories = changes.categories;
      if (changes.status) input.status = changes.status;
      try {
        return await updateReceipt(receiptId, userId, input);
      } catch (error) {
        if (error instanceof DynamoDBError && error.code === 'RECEIPT_NOT_FOUND') return null;
        return wrap(error, 'UPDATE_FAILED');
      }
    },

    async remove(receiptId: string, userId: string): Promise<boolean> {
      try {
        await deleteReceipt(receiptId, userId);
        return true;
      } catch (error) {
        if (error instanceof DynamoDBError && error.code === 'RECEIPT_NOT_FOUND') return false;
        return wrap(error, 'DELETE_FAILED');
      }
    },

    async list(filters: Parameters<ReceiptStore['list']>[0]) {
      try {
        return await queryReceipts(filters);
      } catch (error) {
        return wrap(error, 'QUERY_FAILED');
      }
    },
  };
}
