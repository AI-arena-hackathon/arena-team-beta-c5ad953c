import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/async';
import {
  CaptureError,
  captureReceipt,
  completeUpload,
  discardPendingUpload,
  getMonthlyUsage,
  DEFAULT_MONTHLY_LIMIT,
  type CaptureDeps,
  type CaptureImageInput,
} from '../services/capture';
import {
  processReceipt,
  reprocessReceipt,
  ProcessingError,
  ReceiptNotFoundForProcessingError,
  ReceiptNotPendingError,
  type ProcessingOptions,
  type ReceiptProcessorDeps,
} from '../services/processing';
import {
  recordConsent,
  getConsent,
  listConsents,
  withdrawConsent,
  getRequiredConsents,
  getOptionalConsents,
  getAllConsentTypes,
  getRetentionPolicies,
  createDataSubjectRequest,
  getDataSubjectRequest,
  listDataSubjectRequests,
  processDataSubjectRequest,
  getLegalDocuments,
  getLegalDocument,
  getDisclaimers,
  type ConsentStore,
  type DataSubjectRequestStore,
  type ComplianceDeps,
} from '../services/compliance';
import { RECEIPT_STATUS_VALUES, type ReceiptQueryFilters } from '../types/receipt';
import type { IdentityResolver } from '../middleware/identity';
import type { ImageStore } from '../services/object-store';
import { validateConsentInput, validateDataSubjectRequestInput, validateConsentType } from '../types/compliance';

export const MAX_PAGE_SIZE = 200;

export interface ApiRouterOptions extends CaptureDeps {
  identityResolver: IdentityResolver;
  ocrFallbackEnabled?: boolean;
  textractEnabled?: boolean;
  imageStore: ImageStore;
  consentStore: ConsentStore;
  dsrStore: DataSubjectRequestStore;
  processingDeps?: ReceiptProcessorDeps;
}

function parseConsentInput(body: unknown): { consentType: string; status: string; version: string; ipAddress?: string; userAgent?: string } {
  const consent = (body as { consent?: Record<string, unknown> } | undefined)?.consent;
  if (!consent || typeof consent !== 'object') {
    throw new CaptureError('Body must include a "consent" object', 'VALIDATION_ERROR', 400);
  }
  const consentType = consent.consentType;
  const status = consent.status;
  const version = consent.version;
  if (typeof consentType !== 'string' || typeof status !== 'string' || typeof version !== 'string') {
    throw new CaptureError('consent.consentType, consent.status, and consent.version are required strings', 'VALIDATION_ERROR', 400);
  }
  return {
    consentType,
    status,
    version,
    ipAddress: typeof consent.ipAddress === 'string' ? consent.ipAddress : undefined,
    userAgent: typeof consent.userAgent === 'string' ? consent.userAgent : undefined,
  };
}

function parseDataSubjectRequestInput(body: unknown): { type: string; reason?: string } {
  const dsr = (body as { request?: Record<string, unknown> } | undefined)?.request;
  if (!dsr || typeof dsr !== 'object') {
    throw new CaptureError('Body must include a "request" object', 'VALIDATION_ERROR', 400);
  }
  const type = dsr.type;
  if (typeof type !== 'string') {
    throw new CaptureError('request.type is a required string', 'VALIDATION_ERROR', 400);
  }
  return {
    type,
    reason: typeof dsr.reason === 'string' ? dsr.reason : undefined,
  };
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

  router.delete('/api/receipts/:receiptId', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const discarded = await discardPendingUpload(req.params.receiptId, userId, deps);
    res.json({ deleted: true, receiptId: discarded.receiptId });
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

  const processingDeps: ReceiptProcessorDeps = options.processingDeps ?? {
    receiptStore: options.store,
    imageStore: options.imageStore,
  };

  router.post('/api/receipts/:receiptId/process', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const receiptId = req.params.receiptId;
    const options_: ProcessingOptions = {
      useTextract: req.body?.useTextract,
      useOcrFallback: req.body?.useOcrFallback,
    };
    const result = await processReceipt(receiptId, userId, processingDeps, options_);
    res.json({ receipt: result.receipt, ocrWarnings: result.ocrWarnings, categorization: result.categorization });
  }));

  router.post('/api/receipts/:receiptId/reprocess', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const receiptId = req.params.receiptId;
    const options_: ProcessingOptions = {
      useTextract: req.body?.useTextract,
      useOcrFallback: req.body?.useOcrFallback,
    };
    const result = await reprocessReceipt(receiptId, userId, processingDeps, options_);
    res.json({ receipt: result.receipt, ocrWarnings: result.ocrWarnings, categorization: result.categorization });
  }));

  const complianceDeps: ComplianceDeps = {
    consentStore: options.consentStore,
    dsrStore: options.dsrStore,
    receiptStore: options.store,
    imageStore: options.imageStore,
  };

  router.get('/api/compliance/consent', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const consents = await listConsents(userId, complianceDeps);
    res.json({ consents });
  }));

  router.get('/api/compliance/consent/required', (_req: Request, res: Response) => {
    res.json({ required: getRequiredConsents() });
  });

  router.get('/api/compliance/consent/optional', (_req: Request, res: Response) => {
    res.json({ optional: getOptionalConsents() });
  });

  router.get('/api/compliance/consent/types', (_req: Request, res: Response) => {
    res.json({ types: getAllConsentTypes() });
  });

  router.post('/api/compliance/consent', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const input = parseConsentInput(req.body);
    if (!validateConsentInput(input)) {
      throw new CaptureError('Invalid consent input', 'VALIDATION_ERROR', 400);
    }
    const consent = await recordConsent(userId, input, complianceDeps);
    res.status(201).json({ consent });
  }));

  router.get('/api/compliance/consent/:consentType', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    if (!validateConsentType(req.params.consentType)) {
      throw new CaptureError('Invalid consent type', 'VALIDATION_ERROR', 400);
    }
    const consent = await getConsent(userId, req.params.consentType, complianceDeps);
    if (!consent) {
      throw new CaptureError('Consent not found', 'NOT_FOUND', 404);
    }
    res.json({ consent });
  }));

  router.delete('/api/compliance/consent/:consentType', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    if (!validateConsentType(req.params.consentType)) {
      throw new CaptureError('Invalid consent type', 'VALIDATION_ERROR', 400);
    }
    const consent = await withdrawConsent(userId, req.params.consentType, complianceDeps);
    if (!consent) {
      throw new CaptureError('Consent not found', 'NOT_FOUND', 404);
    }
    res.json({ consent });
  }));

  router.get('/api/compliance/retention', (_req: Request, res: Response) => {
    res.json({ policies: getRetentionPolicies() });
  });

  router.get('/api/compliance/disclaimers', (_req: Request, res: Response) => {
    res.json({ disclaimers: getDisclaimers() });
  });

  router.get('/api/compliance/legal', (_req: Request, res: Response) => {
    res.json({ documents: getLegalDocuments() });
  });

  router.get('/api/compliance/legal/:type', asyncHandler((req, res) => {
    const legalTypes = ['terms_of_service', 'privacy_policy', 'cookie_policy'] as const;
    const type = req.params.type;
    if (!legalTypes.includes(type as typeof legalTypes[number])) {
      throw new CaptureError('Invalid legal document type', 'VALIDATION_ERROR', 400);
    }
    const doc = getLegalDocument(type as typeof legalTypes[number]);
    if (!doc) {
      throw new CaptureError('Legal document not found', 'NOT_FOUND', 404);
    }
    const responseBody: { document: ReturnType<typeof getLegalDocument> } = { document: doc };
    res.json(responseBody);
    return Promise.resolve();
  }));

  router.post('/api/compliance/data-request', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const input = parseDataSubjectRequestInput(req.body);
    if (!validateDataSubjectRequestInput(input)) {
      throw new CaptureError('Invalid data subject request input', 'VALIDATION_ERROR', 400);
    }
    const request = await createDataSubjectRequest(userId, input, complianceDeps);
    res.status(201).json({ request });
  }));

  router.get('/api/compliance/data-request', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const requests = await listDataSubjectRequests(userId, complianceDeps);
    res.json({ requests });
  }));

  router.get('/api/compliance/data-request/:requestId', asyncHandler(async (req, res) => {
    const request = await getDataSubjectRequest(req.params.requestId, complianceDeps);
    if (!request) {
      throw new CaptureError('Data subject request not found', 'NOT_FOUND', 404);
    }
    const userId = identityResolver(req);
    if (request.userId !== userId) {
      throw new CaptureError('Data subject request not found', 'NOT_FOUND', 404);
    }
    res.json({ request });
  }));

  router.post('/api/compliance/data-request/:requestId/process', asyncHandler(async (req, res) => {
    const request = await processDataSubjectRequest(req.params.requestId, complianceDeps);
    res.json({ request });
  }));

  // Export endpoints
  router.get('/api/receipts/export', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const limit = parseLimit(req.query.limit);
    const status = parseStatus(req.query.status);
    const includeLineItems = req.query.includeLineItems === 'true';
    const includeOcrText = req.query.includeOcrText === 'true';

    const { exportReceipts } = await import('../services/export');
    const { generateExportFilename } = await import('../services/export-sync');

    const result = await exportReceipts(
      userId,
      { limit, status },
      { includeLineItems, includeOcrText },
      { receiptStore: options.store }
    );

    const filename = generateExportFilename(userId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result.csv);
  }));

  router.post('/api/receipts/export/sync', asyncHandler(async (req, res) => {
    const userId = identityResolver(req);
    const limit = parseLimit(req.query.limit);
    const status = parseStatus(req.query.status);
    const webhookUrl = req.body?.webhookUrl;
    const includeLineItems = req.body?.includeLineItems === true;
    const includeOcrText = req.body?.includeOcrText === true;
    const metadata = req.body?.metadata;

    const { exportAndSync } = await import('../services/export-sync');

    const result = await exportAndSync(
      userId,
      { limit, status },
      { webhookUrl, includeLineItems, includeOcrText, metadata },
      { receiptStore: options.store }
    );

    res.json(result);
  }));

  router.get('/api/compliance/export/:requestId', asyncHandler(async (req, res) => {
    const request = await getDataSubjectRequest(req.params.requestId, complianceDeps);
    if (!request) {
      throw new CaptureError('Data subject request not found', 'NOT_FOUND', 404);
    }
    const userId = identityResolver(req);
    if (request.userId !== userId) {
      throw new CaptureError('Data subject request not found', 'NOT_FOUND', 404);
    }

    const { exportDataSubjectRequestData } = await import('../services/compliance');
    const result = await exportDataSubjectRequestData(req.params.requestId, complianceDeps);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.csv);
  }));
  return router;
}
