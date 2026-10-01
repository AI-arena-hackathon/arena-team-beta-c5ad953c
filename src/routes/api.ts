import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/async';
import {
  CaptureError,
  captureReceipt,
  completeUpload,
  getMonthlyUsage,
  DEFAULT_MONTHLY_LIMIT,
  type CaptureDeps,
  type CaptureImageInput,
} from '../services/capture';
import { RECEIPT_STATUS_VALUES, type ReceiptQueryFilters } from '../types/receipt';
import type { IdentityResolver } from '../middleware/identity';
import type { ImageStore } from '../services/object-store';

export const MAX_PAGE_SIZE = 200;

export interface ApiRouterOptions extends CaptureDeps {
  identityResolver: IdentityResolver;
  ocrFallbackEnabled?: boolean;
  textractEnabled?: boolean;
  imageStore: ImageStore;
}

function parseLimit(raw: unknown): number {
  if (raw === undefined) return 50;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CaptureError('limit must be a positive integer', 'VALIDATION_ERROR', 400);
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function parseStatus(raw: unknown): ReceiptQueryFilters['status'] {
  if (raw === undefined) return undefined;
  const candidate: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const allowed: readonly string[] = RECEIPT_STATUS_VALUES;
  if (typeof candidate !== 'string' || !allowed.includes(candidate)) {
    throw new CaptureError(`status must be one of: ${allowed.join(', ')}`, 'VALIDATION_ERROR', 400);
  }
  return candidate as ReceiptQueryFilters['status'];
}

function parseImage(body: unknown): CaptureImageInput {
  const image = (body as { image?: Record<string, unknown> } | undefined)?.image;
  if (!image || typeof image !== 'object') {
    throw new CaptureError('Body must include an "image" object', 'VALIDATION_ERROR', 400);
  }
  const fileName = image.fileName;
  const contentType = image.contentType;
  const size = image.size;
  if (typeof fileName !== 'string' || typeof contentType !== 'string') {
    throw new CaptureError('image.fileName and image.contentType are required strings', 'VALIDATION_ERROR', 400);
  }
  if (typeof size !== 'number') {
    throw new CaptureError('image.size must be a number of bytes', 'VALIDATION_ERROR', 400);
  }
  const parsed: CaptureImageInput = { fileName, contentType, size };
  if (typeof image.width === 'number') parsed.width = image.width;
  if (typeof image.height === 'number') parsed.height = image.height;
  return parsed;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();
  const { identityResolver } = options;
  const monthlyLimit = options.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT;

  const deps: CaptureDeps = { store: options.store, uploadSigner: options.uploadSigner, monthlyLimit };

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  router.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      api: { name: 'auto-expense-capture-assistant', captureFlow: 'reserve-then-upload' },
      features: {
        maxReceiptsPerMonth: monthlyLimit,
        maxImageBytes: 10 * 1024 * 1024,
        ocrFallbackEnabled: options.ocrFallbackEnabled ?? false,
        textractEnabled: options.textractEnabled ?? false,
      },
    });
  });

  router.post('/api/receipts', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const image = parseImage(req.body);
    const result = await captureReceipt({ userId, image }, deps);
    res.status(201).json(result);
  }));

  router.post('/api/receipts/:receiptId/complete', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const receipt = await completeUpload(req.params.receiptId, userId, deps);
    res.json({ receipt });
  }));

  router.get('/api/receipts', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const limit = parseLimit(req.query.limit);
    const status = parseStatus(req.query.status);
    const result = await options.store.list({ userId, limit, status });
    res.json({ receipts: result.items, count: result.count, limit });
  }));

  router.get('/api/receipts/:receiptId', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const receipt = await options.store.get(req.params.receiptId, userId);
    if (!receipt) {
      throw new CaptureError(`Receipt not found: ${req.params.receiptId}`, 'RECEIPT_NOT_FOUND', 404);
    }
    res.json({ receipt });
  }));

  const imageStore = options.imageStore;

  const assertTokenOwner = async (token: string, userId: string): Promise<void> => {
    const owner = await imageStore.ownerOf(token);
    if (!owner || owner.userId !== userId) {
      throw new CaptureError(`Upload not found: ${token}`, 'OBJECT_NOT_FOUND', 404);
    }
  };

  router.put(
    '/api/uploads/:token',
    asyncHandler(async (req, res) => {
      const userId = identityResolver(req);
      const token = req.params.token;
      await assertTokenOwner(token, userId);
      const contentType = req.header('content-type') ?? '';
      const body = req.body as Buffer;
      const stored = await imageStore.put(token, contentType.split(';')[0].trim(), body);
      res.status(201).json(stored);
    })
  );

  router.get(
    '/api/uploads/:token',
    asyncHandler(async (req, res) => {
      const userId = identityResolver(req);
      const token = req.params.token;
      await assertTokenOwner(token, userId);
      const stat = await imageStore.stat(token);
      if (!stat) {
        throw new CaptureError(`Upload not found: ${token}`, 'OBJECT_NOT_FOUND', 404);
      }
      const owner = await imageStore.ownerOf(token);
      res.json({ ...stat, owner });
    })
  );

  router.get('/api/usage', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    res.json({ usage: await getMonthlyUsage(userId, deps) });
  }));

  return router;
}
