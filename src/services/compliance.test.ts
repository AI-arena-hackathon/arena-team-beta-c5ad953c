import {
  ComplianceError,
  recordConsent,
  getConsent,
  listConsents,
  withdrawConsent,
  getRequiredConsents,
  getOptionalConsents,
  getAllConsentTypes,
  getRetentionPolicies,
  getRetentionPolicy,
  createDataSubjectRequest,
  getDataSubjectRequest,
  listDataSubjectRequests,
  processDataSubjectRequest,
  getLegalDocuments,
  getLegalDocument,
  getDisclaimers,
  createMemoryConsentStore,
  createMemoryDataSubjectRequestStore,
  type ConsentStore,
  type DataSubjectRequestStore,
  type ComplianceDeps,
} from './compliance';

function createTestDeps(overrides: {
  consentStore?: ConsentStore;
  dsrStore?: DataSubjectRequestStore;
} = {}): ComplianceDeps {
  const consentStore = overrides.consentStore ?? createMemoryConsentStore();
  const dsrStore = overrides.dsrStore ?? createMemoryDataSubjectRequestStore();
  return { consentStore, dsrStore };
}

describe('Memory Consent Store', () => {
  it('saves and retrieves a consent record', async () => {
    const store = createMemoryConsentStore();
    const consent = {
      userId: 'user_123',
      consentType: 'terms_of_service' as const,
      status: 'granted' as const,
      version: '1.0.0',
      grantedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.save(consent);
    const retrieved = await store.get('user_123', 'terms_of_service');

    expect(retrieved).toEqual(consent);
  });

  it('returns null for non-existent consent', async () => {
    const store = createMemoryConsentStore();
    const retrieved = await store.get('user_123', 'terms_of_service');
    expect(retrieved).toBeNull();
  });

  it('lists all consents for a user', async () => {
    const store = createMemoryConsentStore();
    await store.save({
      userId: 'user_123',
      consentType: 'terms_of_service',
      status: 'granted',
      version: '1.0.0',
    });
    await store.save({
      userId: 'user_123',
      consentType: 'privacy_policy',
      status: 'granted',
      version: '1.0.0',
    });
    await store.save({
      userId: 'user_other',
      consentType: 'terms_of_service',
      status: 'denied',
      version: '1.0.0',
    });

    const userConsents = await store.list('user_123');
    expect(userConsents).toHaveLength(2);
    expect(userConsents.every((c) => c.userId === 'user_123')).toBe(true);
  });

  it('updates an existing consent record', async () => {
    const store = createMemoryConsentStore();
    await store.save({
      userId: 'user_123',
      consentType: 'terms_of_service',
      status: 'granted',
      version: '1.0.0',
      grantedAt: '2026-01-01T00:00:00.000Z',
    });

    const updated = await store.update('user_123', 'terms_of_service', {
      status: 'withdrawn',
      withdrawnAt: '2026-01-02T00:00:00.000Z',
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('withdrawn');
    expect(updated!.withdrawnAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns null when updating non-existent consent', async () => {
    const store = createMemoryConsentStore();
    const updated = await store.update('user_123', 'terms_of_service', { status: 'withdrawn' });
    expect(updated).toBeNull();
  });
});

describe('Memory Data Subject Request Store', () => {
  it('saves and retrieves a request', async () => {
    const store = createMemoryDataSubjectRequestStore();
    const request = {
      requestId: 'dsr_123',
      userId: 'user_123',
      type: 'access' as const,
      status: 'pending' as const,
      requestedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.save(request);
    const retrieved = await store.get('dsr_123');

    expect(retrieved).toEqual(request);
  });

  it('returns null for non-existent request', async () => {
    const store = createMemoryDataSubjectRequestStore();
    const retrieved = await store.get('dsr_999');
    expect(retrieved).toBeNull();
  });

  it('lists all requests for a user', async () => {
    const store = createMemoryDataSubjectRequestStore();
    await store.save({
      requestId: 'dsr_1',
      userId: 'user_123',
      type: 'access',
      status: 'pending',
      requestedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.save({
      requestId: 'dsr_2',
      userId: 'user_123',
      type: 'deletion',
      status: 'completed',
      requestedAt: '2026-01-02T00:00:00.000Z',
    });
    await store.save({
      requestId: 'dsr_3',
      userId: 'user_other',
      type: 'access',
      status: 'pending',
      requestedAt: '2026-01-01T00:00:00.000Z',
    });

    const userRequests = await store.listByUser('user_123');
    expect(userRequests).toHaveLength(2);
    expect(userRequests.every((r) => r.userId === 'user_123')).toBe(true);
  });

  it('updates an existing request', async () => {
    const store = createMemoryDataSubjectRequestStore();
    await store.save({
      requestId: 'dsr_123',
      userId: 'user_123',
      type: 'access',
      status: 'pending',
      requestedAt: '2026-01-01T00:00:00.000Z',
    });

    const updated = await store.update('dsr_123', {
      status: 'completed',
      completedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('completed');
    expect(updated!.completedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns null when updating non-existent request', async () => {
    const store = createMemoryDataSubjectRequestStore();
    const updated = await store.update('dsr_999', { status: 'completed' });
    expect(updated).toBeNull();
  });
});

describe('recordConsent', () => {
  it('records a new consent grant', async () => {
    const deps = createTestDeps();
    const input = {
      consentType: 'terms_of_service' as const,
      status: 'granted' as const,
      version: '1.0.0',
      ipAddress: '192.168.1.1',
      userAgent: 'test-agent',
    };

    const consent = await recordConsent('user_123', input, deps);

    expect(consent.userId).toBe('user_123');
    expect(consent.consentType).toBe('terms_of_service');
    expect(consent.status).toBe('granted');
    expect(consent.version).toBe('1.0.0');
    expect(consent.grantedAt).toBeDefined();
    expect(consent.ipAddress).toBe('192.168.1.1');
    expect(consent.userAgent).toBe('test-agent');
  });

  it('records a consent denial', async () => {
    const deps = createTestDeps();
    const input = {
      consentType: 'marketing' as const,
      status: 'denied' as const,
      version: '1.0.0',
    };

    const consent = await recordConsent('user_123', input, deps);

    expect(consent.status).toBe('denied');
    expect(consent.grantedAt).toBeUndefined();
  });

  it('updates existing consent and preserves original grantedAt', async () => {
    const deps = createTestDeps();

    const first = await recordConsent('user_123', {
      consentType: 'terms_of_service',
      status: 'granted',
      version: '1.0.0',
    }, deps);
    const originalGrantedAt = first.grantedAt;

    const updated = await recordConsent('user_123', {
      consentType: 'terms_of_service',
      status: 'withdrawn',
      version: '1.0.0',
    }, deps);

    expect(updated.status).toBe('withdrawn');
    expect(updated.withdrawnAt).toBeDefined();
    expect(updated.grantedAt).toBe(originalGrantedAt);
  });

  it('rejects invalid userId', async () => {
    const deps = createTestDeps();
    await expect(recordConsent('', { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' }, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('rejects invalid consent input', async () => {
    const deps = createTestDeps();
    await expect(recordConsent('user_123', { consentType: 'invalid' as never, status: 'granted', version: '1.0.0' }, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(recordConsent('user_123', { consentType: 'terms_of_service', status: 'invalid' as never, version: '1.0.0' }, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });
});

describe('getConsent', () => {
  it('retrieves an existing consent', async () => {
    const deps = createTestDeps();
    await recordConsent('user_123', { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' }, deps);

    const consent = await getConsent('user_123', 'terms_of_service', deps);

    expect(consent).not.toBeNull();
    expect(consent!.consentType).toBe('terms_of_service');
    expect(consent!.status).toBe('granted');
  });

  it('returns null for non-existent consent', async () => {
    const deps = createTestDeps();
    const consent = await getConsent('user_123', 'terms_of_service', deps);
    expect(consent).toBeNull();
  });

  it('rejects invalid userId', async () => {
    const deps = createTestDeps();
    await expect(getConsent('', 'terms_of_service', deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('rejects invalid consent type', async () => {
    const deps = createTestDeps();
    await expect(getConsent('user_123', 'invalid' as never, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });
});

describe('listConsents', () => {
  it('lists all consents for a user', async () => {
    const deps = createTestDeps();
    await recordConsent('user_123', { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' }, deps);
    await recordConsent('user_123', { consentType: 'privacy_policy', status: 'granted', version: '1.0.0' }, deps);
    await recordConsent('user_123', { consentType: 'analytics', status: 'denied', version: '1.0.0' }, deps);

    const consents = await listConsents('user_123', deps);

    expect(consents).toHaveLength(3);
  });

  it('returns empty array for user with no consents', async () => {
    const deps = createTestDeps();
    const consents = await listConsents('user_123', deps);
    expect(consents).toEqual([]);
  });

  it('rejects invalid userId', async () => {
    const deps = createTestDeps();
    await expect(listConsents('', deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });
});

describe('withdrawConsent', () => {
  it('withdraws an existing consent', async () => {
    const deps = createTestDeps();
    await recordConsent('user_123', { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' }, deps);

    const consent = await withdrawConsent('user_123', 'terms_of_service', deps);

    expect(consent).not.toBeNull();
    expect(consent!.status).toBe('withdrawn');
    expect(consent!.withdrawnAt).toBeDefined();
  });

  it('returns null for non-existent consent', async () => {
    const deps = createTestDeps();
    const consent = await withdrawConsent('user_123', 'terms_of_service', deps);
    expect(consent).toBeNull();
  });

  it('rejects invalid userId', async () => {
    const deps = createTestDeps();
    await expect(withdrawConsent('', 'terms_of_service', deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('rejects invalid consent type', async () => {
    const deps = createTestDeps();
    await expect(withdrawConsent('user_123', 'invalid' as never, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });
});

describe('Consent metadata functions', () => {
  it('getRequiredConsents returns required consent types with versions', () => {
    const required = getRequiredConsents();
    expect(required).toHaveLength(3);
    expect(required.map((c) => c.type)).toEqual(['terms_of_service', 'privacy_policy', 'data_processing']);
    required.forEach((c) => expect(c.version).toBe('1.0.0'));
  });

  it('getOptionalConsents returns optional consent types with versions', () => {
    const optional = getOptionalConsents();
    expect(optional).toHaveLength(2);
    expect(optional.map((c) => c.type)).toEqual(['analytics', 'marketing']);
    optional.forEach((c) => expect(c.version).toBe('1.0.0'));
  });

  it('getAllConsentTypes returns all consent types', () => {
    const all = getAllConsentTypes();
    expect(all).toEqual(['terms_of_service', 'privacy_policy', 'data_processing', 'analytics', 'marketing']);
  });
});

describe('Retention policies', () => {
  it('getRetentionPolicies returns all default policies', () => {
    const policies = getRetentionPolicies();
    expect(policies).toHaveLength(4);
    expect(policies.map((p) => p.resourceType)).toEqual(['receipt', 'receipt_image', 'audit_log', 'consent_record']);
  });

  it('getRetentionPolicy returns a specific policy', () => {
    const policy = getRetentionPolicy('receipt');
    expect(policy).toEqual({ resourceType: 'receipt', retentionDays: 2555, description: '7 years for tax compliance' });
  });

  it('returns undefined for unknown resource type', () => {
    const policy = getRetentionPolicy('unknown' as never);
    expect(policy).toBeUndefined();
  });
});

describe('createDataSubjectRequest', () => {
  it('creates an access request', async () => {
    const deps = createTestDeps();
    const input = { type: 'access' as const, reason: 'User wants their data' };

    const request = await createDataSubjectRequest('user_123', input, deps);

    expect(request.requestId).toMatch(/^dsr_/);
    expect(request.userId).toBe('user_123');
    expect(request.type).toBe('access');
    expect(request.status).toBe('pending');
    expect(request.requestedAt).toBeDefined();
    expect(request.reason).toBe('User wants their data');
  });

  it('creates a deletion request', async () => {
    const deps = createTestDeps();
    const input = { type: 'deletion' as const };

    const request = await createDataSubjectRequest('user_123', input, deps);

    expect(request.type).toBe('deletion');
    expect(request.reason).toBeUndefined();
  });

  it('rejects invalid userId', async () => {
    const deps = createTestDeps();
    await expect(createDataSubjectRequest('', { type: 'access' }, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('rejects invalid request type', async () => {
    const deps = createTestDeps();
    await expect(createDataSubjectRequest('user_123', { type: 'invalid' as never }, deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });
});

describe('getDataSubjectRequest', () => {
  it('retrieves an existing request', async () => {
    const deps = createTestDeps();
    const created = await createDataSubjectRequest('user_123', { type: 'access' }, deps);

    const request = await getDataSubjectRequest(created.requestId, deps);

    expect(request).toEqual(created);
  });

  it('returns null for non-existent request', async () => {
    const deps = createTestDeps();
    const request = await getDataSubjectRequest('dsr_999', deps);
    expect(request).toBeNull();
  });
});

describe('listDataSubjectRequests', () => {
  it('lists all requests for a user', async () => {
    const deps = createTestDeps();
    await createDataSubjectRequest('user_123', { type: 'access' }, deps);
    await createDataSubjectRequest('user_123', { type: 'deletion' }, deps);
    await createDataSubjectRequest('user_other', { type: 'access' }, deps);

    const requests = await listDataSubjectRequests('user_123', deps);

    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.userId === 'user_123')).toBe(true);
  });

  it('returns empty array for user with no requests', async () => {
    const deps = createTestDeps();
    const requests = await listDataSubjectRequests('user_123', deps);
    expect(requests).toEqual([]);
  });

  it('rejects invalid userId', async () => {
    const deps = createTestDeps();
    await expect(listDataSubjectRequests('', deps))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });
});

describe('processDataSubjectRequest', () => {
  it('processes an access request and returns export info', async () => {
    const receiptStore = {
      list: jest.fn().mockResolvedValue({ items: [{}, {}], count: 2 }),
      remove: jest.fn(),
    };
    const imageStore = { removeByUser: jest.fn().mockResolvedValue(0) };
    const deps = createTestDeps();
    deps.receiptStore = receiptStore;
    deps.imageStore = imageStore;

    const created = await createDataSubjectRequest('user_123', { type: 'access' }, deps);
    const processed = await processDataSubjectRequest(created.requestId, deps);

    expect(processed.status).toBe('completed');
    expect(processed.completedAt).toBeDefined();
    expect(processed.result).toEqual({ recordsAffected: 2, exportUrl: `/api/compliance/export/${created.requestId}` });
    expect(receiptStore.list).toHaveBeenCalledWith({ userId: 'user_123', limit: 10000 });
  });

  it('processes a portability request same as access', async () => {
    const receiptStore = { list: jest.fn().mockResolvedValue({ items: [], count: 0 }), remove: jest.fn() };
    const imageStore = { removeByUser: jest.fn().mockResolvedValue(0) };
    const deps = createTestDeps();
    deps.receiptStore = receiptStore;
    deps.imageStore = imageStore;

    const created = await createDataSubjectRequest('user_123', { type: 'portability' }, deps);
    const processed = await processDataSubjectRequest(created.requestId, deps);

    expect(processed.status).toBe('completed');
    expect(processed.result).toEqual({ recordsAffected: 0, exportUrl: `/api/compliance/export/${created.requestId}` });
  });

  it('processes a deletion request and deletes user data', async () => {
    const receiptStore = {
      list: jest.fn().mockResolvedValue({ items: [{ receiptId: 'rcpt_1' }, { receiptId: 'rcpt_2' }], count: 2 }),
      remove: jest.fn().mockResolvedValue(true),
    };
    const imageStore = { removeByUser: jest.fn().mockResolvedValue(5) };
    const deps = createTestDeps();
    deps.receiptStore = receiptStore;
    deps.imageStore = imageStore;

    const created = await createDataSubjectRequest('user_123', { type: 'deletion' }, deps);
    const processed = await processDataSubjectRequest(created.requestId, deps);

    expect(processed.status).toBe('completed');
    expect(processed.result).toEqual({ recordsAffected: 7 });
    expect(receiptStore.remove).toHaveBeenCalledTimes(2);
    expect(imageStore.removeByUser).toHaveBeenCalledWith('user_123');
  });

  it('processes rectification request', async () => {
    const receiptStore = { list: jest.fn().mockResolvedValue({ items: [], count: 0 }), remove: jest.fn() };
    const imageStore = { removeByUser: jest.fn().mockResolvedValue(0) };
    const deps = createTestDeps();
    deps.receiptStore = receiptStore;
    deps.imageStore = imageStore;

    const created = await createDataSubjectRequest('user_123', { type: 'rectification' }, deps);
    const processed = await processDataSubjectRequest(created.requestId, deps);

    expect(processed.status).toBe('completed');
    expect(processed.result).toEqual({ recordsAffected: 0 });
  });

  it('processes restriction request', async () => {
    const receiptStore = { list: jest.fn().mockResolvedValue({ items: [], count: 0 }), remove: jest.fn() };
    const imageStore = { removeByUser: jest.fn().mockResolvedValue(0) };
    const deps = createTestDeps();
    deps.receiptStore = receiptStore;
    deps.imageStore = imageStore;

    const created = await createDataSubjectRequest('user_123', { type: 'restriction' }, deps);
    const processed = await processDataSubjectRequest(created.requestId, deps);

    expect(processed.status).toBe('completed');
    expect(processed.result).toEqual({ recordsAffected: 0 });
  });

  it('rejects non-existent request', async () => {
    const deps = createTestDeps();
    await expect(processDataSubjectRequest('dsr_999', deps))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('rejects non-pending request', async () => {
    const deps = createTestDeps();
    const created = await createDataSubjectRequest('user_123', { type: 'access' }, deps);
    await deps.dsrStore.update(created.requestId, { status: 'completed' });

    await expect(processDataSubjectRequest(created.requestId, deps))
      .rejects.toMatchObject({ code: 'INVALID_STATE', statusCode: 409 });
  });

  it('marks request as rejected on processing failure', async () => {
    const receiptStore = { list: jest.fn().mockRejectedValue(new Error('DB error')), remove: jest.fn() };
    const imageStore = { removeByUser: jest.fn().mockResolvedValue(0) };
    const deps = createTestDeps();
    deps.receiptStore = receiptStore;
    deps.imageStore = imageStore;

    const created = await createDataSubjectRequest('user_123', { type: 'access' }, deps);

    await expect(processDataSubjectRequest(created.requestId, deps)).rejects.toThrow();

    const rejected = await getDataSubjectRequest(created.requestId, deps);
    expect(rejected!.status).toBe('rejected');
    expect(rejected!.completedAt).toBeDefined();
    expect(rejected!.reason).toBe('DB error');
  });
});

describe('Legal documents', () => {
  it('getLegalDocuments returns all three documents', () => {
    const docs = getLegalDocuments();
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.type)).toEqual(['terms_of_service', 'privacy_policy', 'cookie_policy']);
    docs.forEach((doc) => {
      expect(doc.version).toBeDefined();
      expect(doc.content).toBeDefined();
      expect(doc.effectiveDate).toBe('2026-01-01');
      expect(typeof doc.required).toBe('boolean');
    });
  });

  it('getLegalDocument returns specific document', () => {
    const doc = getLegalDocument('terms_of_service');
    expect(doc).toBeDefined();
    expect(doc!.type).toBe('terms_of_service');
    expect(doc!.version).toBe('1.0.0');
    expect(doc!.content).toContain('Terms of Service');
  });

  it('getLegalDocument returns undefined for unknown type', () => {
    const doc = getLegalDocument('unknown' as never);
    expect(doc).toBeUndefined();
  });
});

describe('Disclaimers', () => {
  it('getDisclaimers returns all disclaimer categories', () => {
    const disclaimers = getDisclaimers();
    expect(disclaimers.capture).toContain('Receipt images');
    expect(disclaimers.ocr).toContain('OCR');
    expect(disclaimers.export.toLowerCase()).toContain('export');
    expect(disclaimers.dataRetention).toContain('7 years');
  });

  it('returns a copy, not the original', () => {
    const disclaimers1 = getDisclaimers();
    const disclaimers2 = getDisclaimers();
    expect(disclaimers1).not.toBe(disclaimers2);
  });
});

describe('ComplianceError', () => {
  it('has correct properties', () => {
    const error = new ComplianceError('Test error', 'TEST_CODE', 400);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('ComplianceError');
  });

  it('defaults to 500 status code', () => {
    const error = new ComplianceError('Test error', 'TEST_CODE');
    expect(error.statusCode).toBe(500);
  });
});