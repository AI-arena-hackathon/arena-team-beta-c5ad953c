import {
  createReceipt,
  deleteReceipt,
  getReceipt,
  queryReceipts,
  updateReceipt,
  DynamoDBError,
  ReceiptValidationError,
} from './dynamodb';
import { type ReceiptStore } from './store';
import type { Receipt, UpdateReceiptInput, ReceiptQueryFilters } from '../types/receipt';
import { wrapError } from '../utils/errors';

/**
 * `ReceiptStore` adapter over DynamoDB. DynamoDB has no partial-update helper in
 * the service layer, so changes are funnelled through the existing typed
 * `updateReceipt` (which handles optimistic locking) and mapped back to the port.
 */
export function createDynamoReceiptStore(): ReceiptStore {
  const wrap = (error: unknown, fallbackCode: string): never => {
    return wrapError(error, fallbackCode, 500, [
      { instanceOf: DynamoDBError, code: 'RECEIPT_NOT_FOUND' },
    ]);
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

    async query(filters: ReceiptQueryFilters) {
      try {
        return await queryReceipts(filters);
      } catch (error) {
        return wrap(error, 'QUERY_FAILED');
      }
    },
  };
}
