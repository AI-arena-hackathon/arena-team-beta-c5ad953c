import type { Receipt, ReceiptQueryFilters, ReceiptQueryResult } from '../types/receipt';

/**
 * Port (as opposed to adapter) for receipt persistence.
 *
 * `createDynamoStore` in ./dynamodb-store.ts is the AWS adapter, `createMemoryStore`
 * below is the fake used by tests and by `npm run dev` so the API can be exercised
 * without AWS credentials. Everything above this interface is adapter-agnostic.
 */
export interface ReceiptStore {
  save(receipt: Receipt): Promise<Receipt>;
  get(receiptId: string, userId: string): Promise<Receipt | null>;
  update(receiptId: string, userId: string, changes: Partial<Receipt>): Promise<Receipt | null>;
  remove(receiptId: string, userId: string): Promise<boolean>;
  list(filters: ReceiptQueryFilters): Promise<ReceiptQueryResult>;
  query(filters: ReceiptQueryFilters): Promise<ReceiptQueryResult>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export class ReceiptNotFoundError extends StoreError {
  constructor(receiptId: string) {
    super(`Receipt not found: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
    this.name = 'ReceiptNotFoundError';
  }
}

function matchesFilters(receipt: Receipt, filters: ReceiptQueryFilters): boolean {
  if (receipt.userId !== filters.userId) return false;
  if (filters.status && receipt.status !== filters.status) return false;
  if (filters.startDate && receipt.createdAt < filters.startDate) return false;
  if (filters.endDate && receipt.createdAt > filters.endDate) return false;
  if (filters.categoryId && !receipt.categories.some((c) => c.id === filters.categoryId)) return false;
  if (filters.minAmount !== undefined && receipt.metadata.total < filters.minAmount) return false;
  if (filters.maxAmount !== undefined && receipt.metadata.total > filters.maxAmount) return false;
  return true;
}

/**
 * In-memory store: the fake used by the test suite and by local development.
 * Data is per-process and is lost on restart — never use it in production.
 */
export function createMemoryStore(): ReceiptStore {
  const items = new Map<string, Receipt>();

  const keyOf = (receiptId: string, userId: string): string => `${userId}::${receiptId}`;

  return {
    save(receipt: Receipt): Promise<Receipt> {
      const stored = { ...receipt, images: [...receipt.images], lineItems: [...receipt.lineItems] };
      items.set(keyOf(receipt.receiptId, receipt.userId), stored);
      return Promise.resolve({ ...stored });
    },

    get(receiptId: string, userId: string): Promise<Receipt | null> {
      const found = items.get(keyOf(receiptId, userId));
      return Promise.resolve(found ? { ...found } : null);
    },

    update(receiptId: string, userId: string, changes: Partial<Receipt>): Promise<Receipt | null> {
      const key = keyOf(receiptId, userId);
      const current = items.get(key);
      if (!current) return Promise.resolve(null);
      const updated: Receipt = {
        ...current,
        ...changes,
        receiptId: current.receiptId,
        userId: current.userId,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      items.set(key, updated);
      return Promise.resolve({ ...updated });
    },

    remove(receiptId: string, userId: string): Promise<boolean> {
      return Promise.resolve(items.delete(keyOf(receiptId, userId)));
    },

    list(filters: ReceiptQueryFilters): Promise<ReceiptQueryResult> {
      const matched = [...items.values()]
        .filter((receipt) => matchesFilters(receipt, filters))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const limit = filters.limit ?? 50;
      return Promise.resolve({
        items: matched.slice(0, limit).map((receipt) => ({ ...receipt })),
        count: matched.length,
      });
    },

    query(filters: ReceiptQueryFilters): Promise<ReceiptQueryResult> {
      return this.list(filters);
    },
  };
}
