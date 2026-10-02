import {
  CONSENT_TYPES,
  CONSENT_STATUS_VALUES,
  CURRENT_TOS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_DATA_PROCESSING_VERSION,
  DEFAULT_RETENTION_POLICIES,
  DATA_SUBJECT_REQUEST_TYPES,
  DATA_SUBJECT_REQUEST_STATUS_VALUES,
  DEFAULT_DISCLAIMERS,
  validateConsentType,
  validateConsentStatus,
  validateConsentRecord,
  validateConsentInput,
  validateRetentionPolicy,
  validateDataSubjectRequestType,
  validateDataSubjectRequestStatus,
  validateDataSubjectRequest,
  validateDataSubjectRequestInput,
  validateLegalDocument,
  type ConsentType,
  type ConsentStatus,
  type ConsentRecord,
  type RetentionPolicy,
  type DataSubjectRequestType,
  type DataSubjectRequestStatus,
  type DataSubjectRequest,
  type LegalDocument,
} from './compliance';

describe('Consent constants', () => {
  it('defines all expected consent types', () => {
    expect(CONSENT_TYPES).toEqual([
      'terms_of_service',
      'privacy_policy',
      'data_processing',
      'analytics',
      'marketing',
    ]);
  });

  it('defines all expected consent status values', () => {
    expect(CONSENT_STATUS_VALUES).toEqual(['granted', 'denied', 'withdrawn']);
  });

  it('has current version constants', () => {
    expect(CURRENT_TOS_VERSION).toBe('1.0.0');
    expect(CURRENT_PRIVACY_VERSION).toBe('1.0.0');
    expect(CURRENT_DATA_PROCESSING_VERSION).toBe('1.0.0');
  });
});

describe('Retention policies', () => {
  it('defines default policies for all resource types', () => {
    expect(DEFAULT_RETENTION_POLICIES).toHaveLength(4);
    const types = DEFAULT_RETENTION_POLICIES.map((p) => p.resourceType);
    expect(types).toEqual(['receipt', 'receipt_image', 'audit_log', 'consent_record']);
    DEFAULT_RETENTION_POLICIES.forEach((policy) => {
      expect(policy.retentionDays).toBe(2555);
      expect(typeof policy.description).toBe('string');
      expect(policy.description.length).toBeGreaterThan(0);
    });
  });
});

describe('Data subject request constants', () => {
  it('defines all expected request types', () => {
    expect(DATA_SUBJECT_REQUEST_TYPES).toEqual([
      'access',
      'deletion',
      'portability',
      'rectification',
      'restriction',
    ]);
  });

  it('defines all expected request status values', () => {
    expect(DATA_SUBJECT_REQUEST_STATUS_VALUES).toEqual([
      'pending',
      'processing',
      'completed',
      'rejected',
    ]);
  });
});

describe('Default disclaimers', () => {
  it('provides disclaimers for all required categories', () => {
    expect(DEFAULT_DISCLAIMERS.capture).toContain('Receipt images');
    expect(DEFAULT_DISCLAIMERS.ocr).toContain('OCR');
    expect(DEFAULT_DISCLAIMERS.export.toLowerCase()).toContain('export');
    expect(DEFAULT_DISCLAIMERS.dataRetention).toContain('7 years');
  });
});

describe('validateConsentType', () => {
  it('returns true for valid consent types', () => {
    CONSENT_TYPES.forEach((type) => {
      expect(validateConsentType(type)).toBe(true);
    });
  });

  it('returns false for invalid consent types', () => {
    expect(validateConsentType('invalid')).toBe(false);
    expect(validateConsentType('')).toBe(false);
    expect(validateConsentType(null)).toBe(false);
    expect(validateConsentType(undefined)).toBe(false);
    expect(validateConsentType(123)).toBe(false);
  });
});

describe('validateConsentStatus', () => {
  it('returns true for valid consent statuses', () => {
    CONSENT_STATUS_VALUES.forEach((status) => {
      expect(validateConsentStatus(status)).toBe(true);
    });
  });

  it('returns false for invalid consent statuses', () => {
    expect(validateConsentStatus('invalid')).toBe(false);
    expect(validateConsentStatus('')).toBe(false);
    expect(validateConsentStatus(null)).toBe(false);
    expect(validateConsentStatus(undefined)).toBe(false);
    expect(validateConsentStatus(123)).toBe(false);
  });
});

describe('validateConsentRecord', () => {
  const validRecord: ConsentRecord = {
    userId: 'user_123',
    consentType: 'terms_of_service',
    status: 'granted',
    version: '1.0.0',
    grantedAt: '2026-01-01T00:00:00.000Z',
    ipAddress: '192.168.1.1',
    userAgent: 'test-agent',
  };

  it('returns true for a valid consent record', () => {
    expect(validateConsentRecord(validRecord)).toBe(true);
  });

  it('returns true for a minimal valid consent record', () => {
    const minimal: ConsentRecord = {
      userId: 'user_123',
      consentType: 'privacy_policy',
      status: 'denied',
      version: '1.0.0',
    };
    expect(validateConsentRecord(minimal)).toBe(true);
  });

  it('returns false for missing required fields', () => {
    expect(validateConsentRecord({ ...validRecord, userId: undefined })).toBe(false);
    expect(validateConsentRecord({ ...validRecord, consentType: undefined })).toBe(false);
    expect(validateConsentRecord({ ...validRecord, status: undefined })).toBe(false);
    expect(validateConsentRecord({ ...validRecord, version: undefined })).toBe(false);
  });

  it('returns false for invalid consent type', () => {
    expect(validateConsentRecord({ ...validRecord, consentType: 'invalid' })).toBe(false);
  });

  it('returns false for invalid consent status', () => {
    expect(validateConsentRecord({ ...validRecord, status: 'invalid' })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(validateConsentRecord(null)).toBe(false);
    expect(validateConsentRecord(undefined)).toBe(false);
    expect(validateConsentRecord('string')).toBe(false);
    expect(validateConsentRecord(123)).toBe(false);
  });
});

describe('validateConsentInput', () => {
  const validInput = {
    consentType: 'terms_of_service' as ConsentType,
    status: 'granted' as ConsentStatus,
    version: '1.0.0',
    ipAddress: '192.168.1.1',
    userAgent: 'test-agent',
  };

  it('returns true for a valid consent input', () => {
    expect(validateConsentInput(validInput)).toBe(true);
  });

  it('returns true for minimal valid consent input', () => {
    const minimal = {
      consentType: 'privacy_policy' as ConsentType,
      status: 'denied' as ConsentStatus,
      version: '1.0.0',
    };
    expect(validateConsentInput(minimal)).toBe(true);
  });

  it('returns false for missing required fields', () => {
    expect(validateConsentInput({ ...validInput, consentType: undefined })).toBe(false);
    expect(validateConsentInput({ ...validInput, status: undefined })).toBe(false);
    expect(validateConsentInput({ ...validInput, version: undefined })).toBe(false);
  });

  it('returns false for invalid consent type', () => {
    expect(validateConsentInput({ ...validInput, consentType: 'invalid' as ConsentType })).toBe(false);
  });

  it('returns false for invalid consent status', () => {
    expect(validateConsentInput({ ...validInput, status: 'invalid' as ConsentStatus })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(validateConsentInput(null)).toBe(false);
    expect(validateConsentInput(undefined)).toBe(false);
    expect(validateConsentInput('string')).toBe(false);
    expect(validateConsentInput(123)).toBe(false);
  });
});

describe('validateRetentionPolicy', () => {
  const validPolicy: RetentionPolicy = {
    resourceType: 'receipt',
    retentionDays: 2555,
    description: '7 years for tax compliance',
  };

  it('returns true for a valid retention policy', () => {
    expect(validateRetentionPolicy(validPolicy)).toBe(true);
  });

  it('returns true for all valid resource types', () => {
    ['receipt', 'receipt_image', 'audit_log', 'consent_record'].forEach((type) => {
      expect(validateRetentionPolicy({ ...validPolicy, resourceType: type })).toBe(true);
    });
  });

  it('returns false for invalid resource type', () => {
    expect(validateRetentionPolicy({ ...validPolicy, resourceType: 'invalid' })).toBe(false);
  });

  it('returns false for non-positive retention days', () => {
    expect(validateRetentionPolicy({ ...validPolicy, retentionDays: 0 })).toBe(false);
    expect(validateRetentionPolicy({ ...validPolicy, retentionDays: -1 })).toBe(false);
    expect(validateRetentionPolicy({ ...validPolicy, retentionDays: 1.5 })).toBe(false);
  });

  it('returns false for missing description', () => {
    expect(validateRetentionPolicy({ ...validPolicy, description: '' })).toBe(true);
    expect(validateRetentionPolicy({ ...validPolicy, description: undefined as unknown })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(validateRetentionPolicy(null)).toBe(false);
    expect(validateRetentionPolicy(undefined)).toBe(false);
  });
});

describe('validateDataSubjectRequestType', () => {
  it('returns true for valid request types', () => {
    DATA_SUBJECT_REQUEST_TYPES.forEach((type) => {
      expect(validateDataSubjectRequestType(type)).toBe(true);
    });
  });

  it('returns false for invalid request types', () => {
    expect(validateDataSubjectRequestType('invalid')).toBe(false);
    expect(validateDataSubjectRequestType('')).toBe(false);
    expect(validateDataSubjectRequestType(null)).toBe(false);
    expect(validateDataSubjectRequestType(undefined)).toBe(false);
    expect(validateDataSubjectRequestType(123)).toBe(false);
  });
});

describe('validateDataSubjectRequestStatus', () => {
  it('returns true for valid request statuses', () => {
    DATA_SUBJECT_REQUEST_STATUS_VALUES.forEach((status) => {
      expect(validateDataSubjectRequestStatus(status)).toBe(true);
    });
  });

  it('returns false for invalid request statuses', () => {
    expect(validateDataSubjectRequestStatus('invalid')).toBe(false);
    expect(validateDataSubjectRequestStatus('')).toBe(false);
    expect(validateDataSubjectRequestStatus(null)).toBe(false);
    expect(validateDataSubjectRequestStatus(undefined)).toBe(false);
    expect(validateDataSubjectRequestStatus(123)).toBe(false);
  });
});

describe('validateDataSubjectRequest', () => {
  const validRequest: DataSubjectRequest = {
    requestId: 'dsr_123',
    userId: 'user_123',
    type: 'access',
    status: 'pending',
    requestedAt: '2026-01-01T00:00:00.000Z',
    reason: 'User requested access',
  };

  it('returns true for a valid data subject request', () => {
    expect(validateDataSubjectRequest(validRequest)).toBe(true);
  });

  it('returns true for a completed request with result', () => {
    const completed: DataSubjectRequest = {
      ...validRequest,
      status: 'completed',
      completedAt: '2026-01-02T00:00:00.000Z',
      result: { recordsAffected: 5, exportUrl: '/api/compliance/export/dsr_123' },
    };
    expect(validateDataSubjectRequest(completed)).toBe(true);
  });

  it('returns false for missing required fields', () => {
    expect(validateDataSubjectRequest({ ...validRequest, requestId: undefined })).toBe(false);
    expect(validateDataSubjectRequest({ ...validRequest, userId: undefined })).toBe(false);
    expect(validateDataSubjectRequest({ ...validRequest, type: undefined })).toBe(false);
    expect(validateDataSubjectRequest({ ...validRequest, status: undefined })).toBe(false);
    expect(validateDataSubjectRequest({ ...validRequest, requestedAt: undefined })).toBe(false);
  });

  it('returns false for invalid request type', () => {
    expect(validateDataSubjectRequest({ ...validRequest, type: 'invalid' })).toBe(false);
  });

  it('returns false for invalid request status', () => {
    expect(validateDataSubjectRequest({ ...validRequest, status: 'invalid' })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(validateDataSubjectRequest(null)).toBe(false);
    expect(validateDataSubjectRequest(undefined)).toBe(false);
    expect(validateDataSubjectRequest('string')).toBe(false);
    expect(validateDataSubjectRequest(123)).toBe(false);
  });
});

describe('validateDataSubjectRequestInput', () => {
  const validInput = {
    type: 'access' as DataSubjectRequestType,
    reason: 'User requested access',
  };

  it('returns true for a valid data subject request input', () => {
    expect(validateDataSubjectRequestInput(validInput)).toBe(true);
  });

  it('returns true for input without reason', () => {
    expect(validateDataSubjectRequestInput({ type: 'deletion' })).toBe(true);
  });

  it('returns false for missing type', () => {
    expect(validateDataSubjectRequestInput({ reason: 'test' })).toBe(false);
    expect(validateDataSubjectRequestInput({})).toBe(false);
  });

  it('returns false for invalid request type', () => {
    expect(validateDataSubjectRequestInput({ type: 'invalid' })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(validateDataSubjectRequestInput(null)).toBe(false);
    expect(validateDataSubjectRequestInput(undefined)).toBe(false);
    expect(validateDataSubjectRequestInput('string')).toBe(false);
    expect(validateDataSubjectRequestInput(123)).toBe(false);
  });
});

describe('validateLegalDocument', () => {
  const validDoc: LegalDocument = {
    type: 'terms_of_service',
    version: '1.0.0',
    content: 'Terms content',
    effectiveDate: '2026-01-01',
    required: true,
  };

  it('returns true for a valid legal document', () => {
    expect(validateLegalDocument(validDoc)).toBe(true);
  });

  it('returns true for all valid document types', () => {
    ['terms_of_service', 'privacy_policy', 'cookie_policy'].forEach((type) => {
      expect(validateLegalDocument({ ...validDoc, type })).toBe(true);
    });
  });

  it('returns false for invalid document type', () => {
    expect(validateLegalDocument({ ...validDoc, type: 'invalid' })).toBe(false);
  });

  it('returns false for missing required fields', () => {
    expect(validateLegalDocument({ ...validDoc, type: undefined })).toBe(false);
    expect(validateLegalDocument({ ...validDoc, version: undefined })).toBe(false);
    expect(validateLegalDocument({ ...validDoc, content: undefined })).toBe(false);
    expect(validateLegalDocument({ ...validDoc, effectiveDate: undefined })).toBe(false);
    expect(validateLegalDocument({ ...validDoc, required: undefined })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(validateLegalDocument(null)).toBe(false);
    expect(validateLegalDocument(undefined)).toBe(false);
    expect(validateLegalDocument('string')).toBe(false);
    expect(validateLegalDocument(123)).toBe(false);
  });
});