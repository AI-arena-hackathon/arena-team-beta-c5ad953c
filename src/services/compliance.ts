import { randomBytes } from 'crypto';
import {
  type ConsentRecord,
  type ConsentInput,
  type ConsentType,
  CONSENT_TYPES,
  CURRENT_TOS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_DATA_PROCESSING_VERSION,
  type RetentionPolicy,
  DEFAULT_RETENTION_POLICIES,
  type DataSubjectRequest,
  type DataSubjectRequestInput,
  type LegalDocument,
  DEFAULT_DISCLAIMERS,
  type DisclaimerContent,
  validateConsentRecord,
  validateConsentInput,
  validateConsentType,
  validateDataSubjectRequest,
  validateDataSubjectRequestInput,
} from '../types/compliance';
import { AppError } from '../utils/errors';
import { validateUserId } from '../utils/validation';

export class ComplianceError extends AppError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'ComplianceError';
  }
}

export interface ConsentStore {
  save(consent: ConsentRecord): Promise<ConsentRecord>;
  get(userId: string, consentType: ConsentType): Promise<ConsentRecord | null>;
  list(userId: string): Promise<ConsentRecord[]>;
  update(userId: string, consentType: ConsentType, changes: Partial<ConsentRecord>): Promise<ConsentRecord | null>;
}

export interface DataSubjectRequestStore {
  save(request: DataSubjectRequest): Promise<DataSubjectRequest>;
  get(requestId: string): Promise<DataSubjectRequest | null>;
  listByUser(userId: string): Promise<DataSubjectRequest[]>;
  update(requestId: string, changes: Partial<DataSubjectRequest>): Promise<DataSubjectRequest | null>;
}

export interface ReceiptStorePort {
  list(filters: { userId: string; limit?: number }): Promise<{ items: unknown[]; count: number }>;
  remove(receiptId: string, userId: string): Promise<boolean>;
}

export interface ImageStorePort {
  removeByUser(userId: string): Promise<number>;
}

export interface ComplianceDeps {
  consentStore: ConsentStore;
  dsrStore: DataSubjectRequestStore;
  receiptStore?: ReceiptStorePort;
  imageStore?: ImageStorePort;
}

function assertSafeUserId(userId: unknown): string {
  try {
    return validateUserId(userId, 'userId');
  } catch (error) {
    if (error instanceof AppError) {
      throw new ComplianceError(error.message, error.code, error.statusCode);
    }
    throw error;
  }
}

function generateRequestId(): string {
  return `dsr_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

export function createMemoryConsentStore(): ConsentStore {
  const items = new Map<string, ConsentRecord>();

  const keyOf = (userId: string, consentType: ConsentType): string => `${userId}::${consentType}`;

  return {
    save(consent: ConsentRecord): Promise<ConsentRecord> {
      const stored = { ...consent };
      items.set(keyOf(consent.userId, consent.consentType), stored);
      return Promise.resolve({ ...stored });
    },

    get(userId: string, consentType: ConsentType): Promise<ConsentRecord | null> {
      const found = items.get(keyOf(userId, consentType));
      return Promise.resolve(found ? { ...found } : null);
    },

    list(userId: string): Promise<ConsentRecord[]> {
      const userConsents = [...items.values()].filter((c) => c.userId === userId);
      return Promise.resolve(userConsents.map((c) => ({ ...c })));
    },

    update(userId: string, consentType: ConsentType, changes: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
      const key = keyOf(userId, consentType);
      const current = items.get(key);
      if (!current) return Promise.resolve(null);
      const updated: ConsentRecord = { ...current, ...changes };
      items.set(key, updated);
      return Promise.resolve({ ...updated });
    },
  };
}

export function createMemoryDataSubjectRequestStore(): DataSubjectRequestStore {
  const items = new Map<string, DataSubjectRequest>();

  return {
    save(request: DataSubjectRequest): Promise<DataSubjectRequest> {
      const stored = { ...request };
      items.set(request.requestId, stored);
      return Promise.resolve({ ...stored });
    },

    get(requestId: string): Promise<DataSubjectRequest | null> {
      const found = items.get(requestId);
      return Promise.resolve(found ? { ...found } : null);
    },

    listByUser(userId: string): Promise<DataSubjectRequest[]> {
      const userRequests = [...items.values()].filter((r) => r.userId === userId);
      return Promise.resolve(userRequests.map((r) => ({ ...r })));
    },

    update(requestId: string, changes: Partial<DataSubjectRequest>): Promise<DataSubjectRequest | null> {
      const current = items.get(requestId);
      if (!current) return Promise.resolve(null);
      const updated: DataSubjectRequest = { ...current, ...changes };
      items.set(requestId, updated);
      return Promise.resolve({ ...updated });
    },
  };
}

export async function recordConsent(
  userId: string,
  input: ConsentInput,
  deps: ComplianceDeps
): Promise<ConsentRecord> {
  const safeUserId = assertSafeUserId(userId);

  if (!validateConsentInput(input)) {
    throw new ComplianceError('Invalid consent input', 'VALIDATION_ERROR', 400);
  }

  const now = currentTimestamp();
  const existing = await deps.consentStore.get(safeUserId, input.consentType);

  const consent: ConsentRecord = {
    userId: safeUserId,
    consentType: input.consentType,
    status: input.status,
    version: input.version,
    grantedAt: input.status === 'granted' ? (existing?.grantedAt ?? now) : existing?.grantedAt,
    withdrawnAt: input.status === 'withdrawn' ? now : existing?.withdrawnAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  };

  if (!validateConsentRecord(consent)) {
    throw new ComplianceError('Generated consent record is invalid', 'INTERNAL_ERROR', 500);
  }

  return deps.consentStore.save(consent);
}

export async function getConsent(userId: string, consentType: ConsentType, deps: ComplianceDeps): Promise<ConsentRecord | null> {
  const safeUserId = assertSafeUserId(userId);
  if (!validateConsentType(consentType)) {
    throw new ComplianceError('Invalid consent type', 'VALIDATION_ERROR', 400);
  }
  return deps.consentStore.get(safeUserId, consentType);
}

export async function listConsents(userId: string, deps: ComplianceDeps): Promise<ConsentRecord[]> {
  const safeUserId = assertSafeUserId(userId);
  return deps.consentStore.list(safeUserId);
}

export async function withdrawConsent(userId: string, consentType: ConsentType, deps: ComplianceDeps): Promise<ConsentRecord | null> {
  const safeUserId = assertSafeUserId(userId);
  if (!validateConsentType(consentType)) {
    throw new ComplianceError('Invalid consent type', 'VALIDATION_ERROR', 400);
  }
  return deps.consentStore.update(safeUserId, consentType, {
    status: 'withdrawn',
    withdrawnAt: currentTimestamp(),
  });
}

export function getRequiredConsents(): Array<{ type: ConsentType; version: string }> {
  return [
    { type: 'terms_of_service', version: CURRENT_TOS_VERSION },
    { type: 'privacy_policy', version: CURRENT_PRIVACY_VERSION },
    { type: 'data_processing', version: CURRENT_DATA_PROCESSING_VERSION },
  ];
}

export function getOptionalConsents(): Array<{ type: ConsentType; version: string }> {
  return [
    { type: 'analytics', version: '1.0.0' },
    { type: 'marketing', version: '1.0.0' },
  ];
}

export function getAllConsentTypes(): ConsentType[] {
  return [...CONSENT_TYPES];
}

export function getRetentionPolicies(): RetentionPolicy[] {
  return [...DEFAULT_RETENTION_POLICIES];
}

export function getRetentionPolicy(resourceType: RetentionPolicy['resourceType']): RetentionPolicy | undefined {
  return DEFAULT_RETENTION_POLICIES.find((p) => p.resourceType === resourceType);
}

export async function createDataSubjectRequest(
  userId: string,
  input: DataSubjectRequestInput,
  deps: ComplianceDeps
): Promise<DataSubjectRequest> {
  const safeUserId = assertSafeUserId(userId);

  if (!validateDataSubjectRequestInput(input)) {
    throw new ComplianceError('Invalid data subject request input', 'VALIDATION_ERROR', 400);
  }

  const now = currentTimestamp();
  const requestId = generateRequestId();

  const request: DataSubjectRequest = {
    requestId,
    userId: safeUserId,
    type: input.type,
    status: 'pending',
    requestedAt: now,
    reason: input.reason,
  };

  if (!validateDataSubjectRequest(request)) {
    throw new ComplianceError('Generated data subject request is invalid', 'INTERNAL_ERROR', 500);
  }

  return deps.dsrStore.save(request);
}

export async function getDataSubjectRequest(requestId: string, deps: ComplianceDeps): Promise<DataSubjectRequest | null> {
  return deps.dsrStore.get(requestId);
}

export async function listDataSubjectRequests(userId: string, deps: ComplianceDeps): Promise<DataSubjectRequest[]> {
  const safeUserId = assertSafeUserId(userId);
  return deps.dsrStore.listByUser(safeUserId);
}

export async function processDataSubjectRequest(
  requestId: string,
  deps: ComplianceDeps
): Promise<DataSubjectRequest> {
  const request = await deps.dsrStore.get(requestId);
  if (!request) {
    throw new ComplianceError('Data subject request not found', 'NOT_FOUND', 404);
  }

  if (request.status !== 'pending') {
    throw new ComplianceError('Request is not in pending state', 'INVALID_STATE', 409);
  }

  const updated = await deps.dsrStore.update(requestId, { status: 'processing' });
  if (!updated) {
    throw new ComplianceError('Failed to update request status', 'UPDATE_FAILED', 500);
  }

  try {
    let result: DataSubjectRequest['result'] = {};

    switch (request.type) {
      case 'access':
      case 'portability':
        if (deps.receiptStore) {
          const receipts = await deps.receiptStore.list({ userId: request.userId, limit: 10000 });
          result = {
            recordsAffected: receipts.count,
            exportUrl: `/api/compliance/export/${requestId}`,
          };
        }
        break;

      case 'deletion':
        if (deps.receiptStore && deps.imageStore) {
          const receipts = await deps.receiptStore.list({ userId: request.userId, limit: 10000 });
          let deletedCount = 0;
          for (const receipt of receipts.items) {
            const r = receipt as { receiptId: string };
            const removed = await deps.receiptStore.remove(r.receiptId, request.userId);
            if (removed) deletedCount++;
          }
          const imagesDeleted = await deps.imageStore.removeByUser(request.userId);
          result = { recordsAffected: deletedCount + imagesDeleted };
        }
        break;

      case 'rectification':
      case 'restriction':
        result = { recordsAffected: 0 };
        break;
    }

    const completed = await deps.dsrStore.update(requestId, {
      status: 'completed',
      completedAt: currentTimestamp(),
      result,
    });
    if (!completed) {
      throw new ComplianceError('Failed to complete request', 'UPDATE_FAILED', 500);
    }
    return completed;
  } catch (error) {
    const rejected = await deps.dsrStore.update(requestId, {
      status: 'rejected',
      completedAt: currentTimestamp(),
      reason: error instanceof Error ? error.message : 'Processing failed',
    });
    if (!rejected) {
      throw new ComplianceError('Failed to reject request', 'UPDATE_FAILED', 500);
    }
    throw error;
  }
}

export function getLegalDocuments(): LegalDocument[] {
  return [
    {
      type: 'terms_of_service',
      version: CURRENT_TOS_VERSION,
      content: generateTermsOfService(),
      effectiveDate: '2026-01-01',
      required: true,
    },
    {
      type: 'privacy_policy',
      version: CURRENT_PRIVACY_VERSION,
      content: generatePrivacyPolicy(),
      effectiveDate: '2026-01-01',
      required: true,
    },
    {
      type: 'cookie_policy',
      version: '1.0.0',
      content: generateCookiePolicy(),
      effectiveDate: '2026-01-01',
      required: false,
    },
  ];
}

export function getLegalDocument(type: LegalDocument['type']): LegalDocument | undefined {
  return getLegalDocuments().find((d) => d.type === type);
}

export function getDisclaimers(): DisclaimerContent {
  return { ...DEFAULT_DISCLAIMERS };
}

function generateTermsOfService(): string {
  return `# Terms of Service

**Effective Date:** January 1, 2026
**Version:** ${CURRENT_TOS_VERSION}

## 1. Acceptance of Terms
By accessing or using the Auto-Expense Capture Assistant ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of the Terms, you may not use the Service.

## 2. Description of Service
The Service provides automated receipt capture, OCR extraction, categorization, and export functionality for expense tracking purposes.

## 3. User Accounts
You may need to create an account to use certain features. You are responsible for maintaining the confidentiality of your account credentials.

## 4. User Content
You retain ownership of receipt images and data you upload. You grant us a license to process, store, and display your content solely to provide the Service.

## 5. Privacy
Your use of the Service is governed by our Privacy Policy, incorporated herein by reference.

## 6. Disclaimers
THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. OCR EXTRACTION MAY CONTAIN ERRORS. VERIFY ALL DATA BEFORE USE FOR TAX OR FINANCIAL PURPOSES.

## 7. Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES.

## 8. Governing Law
These Terms shall be governed by the laws of the jurisdiction in which the Service operator is established.

## 9. Changes to Terms
We may modify these Terms at any time. Continued use after changes constitutes acceptance.`;
}

function generatePrivacyPolicy(): string {
  return `# Privacy Policy

**Effective Date:** January 1, 2026
**Version:** ${CURRENT_PRIVACY_VERSION}

## 1. Information We Collect
- **Account Information:** User ID, authentication credentials
- **Receipt Data:** Images, extracted text, metadata, categories
- **Usage Data:** API calls, feature usage, error logs
- **Device Information:** IP address, user agent, device identifiers

## 2. How We Use Your Information
- Provide and improve the Service
- Process receipts for expense extraction
- Enforce usage limits and prevent abuse
- Comply with legal obligations
- Communicate with you about the Service

## 3. Data Retention
- Receipt data: 7 years (tax compliance)
- Receipt images: 7 years (tax compliance)
- Audit logs: 7 years (audit trail)
- Consent records: 7 years (consent evidence)
- You may request deletion subject to legal obligations

## 4. Data Sharing
We do not sell your data. We may share data with:
- Service providers (AWS for hosting, OCR processing)
- Legal authorities when required by law
- With your explicit consent

## 5. Your Rights
Depending on your jurisdiction, you may have rights to:
- Access your data
- Request deletion
- Data portability
- Rectification
- Restriction of processing
- Withdraw consent

## 6. Security
We implement appropriate technical and organizational measures to protect your data.

## 7. Changes to This Policy
We may update this Policy. Changes will be posted with a new effective date.`;
}

function generateCookiePolicy(): string {
  return `# Cookie Policy

**Effective Date:** January 1, 2026
**Version:** 1.0.0

This Service uses minimal cookies strictly necessary for authentication and session management. We do not use tracking, analytics, or advertising cookies.

## Types of Cookies
- **Essential:** Authentication tokens, session identifiers
- **Preferences:** Language, display settings (if applicable)

## Managing Cookies
You can control cookies through your browser settings. Disabling essential cookies may prevent the Service from functioning.`;
}