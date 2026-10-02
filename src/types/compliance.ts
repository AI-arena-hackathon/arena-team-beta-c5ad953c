export type ConsentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'data_processing'
  | 'analytics'
  | 'marketing';

export type ConsentStatus = 'granted' | 'denied' | 'withdrawn';

export interface ConsentRecord {
  userId: string;
  consentType: ConsentType;
  status: ConsentStatus;
  version: string;
  grantedAt?: string;
  withdrawnAt?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentInput {
  consentType: ConsentType;
  status: ConsentStatus;
  version: string;
  ipAddress?: string;
  userAgent?: string;
}

export const CONSENT_TYPES: readonly ConsentType[] = [
  'terms_of_service',
  'privacy_policy',
  'data_processing',
  'analytics',
  'marketing',
] as const;

export const CONSENT_STATUS_VALUES: readonly ConsentStatus[] = [
  'granted',
  'denied',
  'withdrawn',
] as const;

export const CURRENT_TOS_VERSION = '1.0.0';
export const CURRENT_PRIVACY_VERSION = '1.0.0';
export const CURRENT_DATA_PROCESSING_VERSION = '1.0.0';

export interface RetentionPolicy {
  resourceType: 'receipt' | 'receipt_image' | 'audit_log' | 'consent_record';
  retentionDays: number;
  description: string;
}

export const DEFAULT_RETENTION_POLICIES: readonly RetentionPolicy[] = [
  { resourceType: 'receipt', retentionDays: 2555, description: '7 years for tax compliance' },
  { resourceType: 'receipt_image', retentionDays: 2555, description: '7 years for tax compliance' },
  { resourceType: 'audit_log', retentionDays: 2555, description: '7 years for audit trail' },
  { resourceType: 'consent_record', retentionDays: 2555, description: '7 years for consent evidence' },
] as const;

export type DataSubjectRequestType = 'access' | 'deletion' | 'portability' | 'rectification' | 'restriction';

export type DataSubjectRequestStatus = 'pending' | 'processing' | 'completed' | 'rejected';

export interface DataSubjectRequest {
  requestId: string;
  userId: string;
  type: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  requestedAt: string;
  completedAt?: string;
  reason?: string;
  result?: {
    exportUrl?: string;
    recordsAffected?: number;
  };
}

export interface DataSubjectRequestInput {
  type: DataSubjectRequestType;
  reason?: string;
}

export const DATA_SUBJECT_REQUEST_TYPES: readonly DataSubjectRequestType[] = [
  'access',
  'deletion',
  'portability',
  'rectification',
  'restriction',
] as const;

export const DATA_SUBJECT_REQUEST_STATUS_VALUES: readonly DataSubjectRequestStatus[] = [
  'pending',
  'processing',
  'completed',
  'rejected',
] as const;

export interface LegalDocument {
  type: 'terms_of_service' | 'privacy_policy' | 'cookie_policy';
  version: string;
  content: string;
  effectiveDate: string;
  required: boolean;
}

export interface DisclaimerContent {
  capture: string;
  ocr: string;
  export: string;
  dataRetention: string;
}

export const DEFAULT_DISCLAIMERS: DisclaimerContent = {
  capture: 'Receipt images are uploaded to secure storage and processed for expense extraction. You retain ownership of your images.',
  ocr: 'Automated OCR extraction may contain errors. Review extracted data before using for tax or financial purposes.',
  export: 'Exported data is provided as-is. Verify accuracy before importing into accounting systems.',
  dataRetention: 'Receipt data is retained for 7 years for tax compliance. You may request deletion subject to legal obligations.',
};

export function validateConsentType(type: unknown): type is ConsentType {
  return typeof type === 'string' && CONSENT_TYPES.includes(type as ConsentType);
}

export function validateConsentStatus(status: unknown): status is ConsentStatus {
  return typeof status === 'string' && CONSENT_STATUS_VALUES.includes(status as ConsentStatus);
}

export function validateConsentRecord(record: unknown): record is ConsentRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return (
    typeof r.userId === 'string' &&
    validateConsentType(r.consentType) &&
    validateConsentStatus(r.status) &&
    typeof r.version === 'string' &&
    (r.grantedAt === undefined || typeof r.grantedAt === 'string') &&
    (r.withdrawnAt === undefined || typeof r.withdrawnAt === 'string') &&
    (r.ipAddress === undefined || typeof r.ipAddress === 'string') &&
    (r.userAgent === undefined || typeof r.userAgent === 'string')
  );
}

export function validateConsentInput(input: unknown): input is ConsentInput {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return (
    validateConsentType(i.consentType) &&
    validateConsentStatus(i.status) &&
    typeof i.version === 'string' &&
    (i.ipAddress === undefined || typeof i.ipAddress === 'string') &&
    (i.userAgent === undefined || typeof i.userAgent === 'string')
  );
}

export function validateRetentionPolicy(policy: unknown): policy is RetentionPolicy {
  if (!policy || typeof policy !== 'object') return false;
  const p = policy as Record<string, unknown>;
  return (
    ['receipt', 'receipt_image', 'audit_log', 'consent_record'].includes(p.resourceType as string) &&
    typeof p.retentionDays === 'number' &&
    Number.isInteger(p.retentionDays) &&
    p.retentionDays > 0 &&
    typeof p.description === 'string'
  );
}

export function validateDataSubjectRequestType(type: unknown): type is DataSubjectRequestType {
  return typeof type === 'string' && DATA_SUBJECT_REQUEST_TYPES.includes(type as DataSubjectRequestType);
}

export function validateDataSubjectRequestStatus(status: unknown): status is DataSubjectRequestStatus {
  return typeof status === 'string' && DATA_SUBJECT_REQUEST_STATUS_VALUES.includes(status as DataSubjectRequestStatus);
}

export function validateDataSubjectRequest(request: unknown): request is DataSubjectRequest {
  if (!request || typeof request !== 'object') return false;
  const r = request as Record<string, unknown>;
  return (
    typeof r.requestId === 'string' &&
    typeof r.userId === 'string' &&
    validateDataSubjectRequestType(r.type) &&
    validateDataSubjectRequestStatus(r.status) &&
    typeof r.requestedAt === 'string' &&
    (r.completedAt === undefined || typeof r.completedAt === 'string') &&
    (r.reason === undefined || typeof r.reason === 'string') &&
    (r.result === undefined || (typeof r.result === 'object' && r.result !== null))
  );
}

export function validateDataSubjectRequestInput(input: unknown): input is DataSubjectRequestInput {
  if (!input || typeof input !== 'object') return false;
  const i = input as Record<string, unknown>;
  return (
    validateDataSubjectRequestType(i.type) &&
    (i.reason === undefined || typeof i.reason === 'string')
  );
}

export function validateLegalDocument(doc: unknown): doc is LegalDocument {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  return (
    ['terms_of_service', 'privacy_policy', 'cookie_policy'].includes(d.type as string) &&
    typeof d.version === 'string' &&
    typeof d.content === 'string' &&
    typeof d.effectiveDate === 'string' &&
    typeof d.required === 'boolean'
  );
}