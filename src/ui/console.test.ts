/**
 * Tests for the browser capture console's view model.
 *
 * `public/format.js` and `public/capture-flow.js` ship to the browser as plain
 * classic scripts (no build step), so they are dependency-free JS with a
 * CommonJS tail. Jest requires them directly, which is why these tests live
 * under `src/` instead of beside them in `public/`.
 */
import type { Receipt } from '../types/receipt';
import { SUPPORTED_IMAGE_TYPES } from '../utils/validation';

interface FormatModule {
  ACCEPT_ATTRIBUTE: string;
  statusLabel(status: unknown): string;
  statusTone(status: unknown): string;
  formatBytes(bytes: unknown): string;
  formatAmount(value: unknown): string;
  formatCurrency(receipt: unknown): string;
  formatDateTime(iso: unknown, timeZone?: string): string;
  formatFileSummary(file: unknown): string;
  receiptTotal(receipt: unknown): number | null;
  receiptMerchant(receipt: unknown): string | null;
  matchesSearch(receipt: unknown, query: unknown): boolean;
  filterReceipts(receipts: unknown, options: unknown): Receipt[];
  sortNewestFirst(receipts: unknown): Receipt[];
  listSummary(summary: { total?: unknown; shown?: unknown; limit?: unknown }): string;
  usageLabel(usage: unknown): string;
  usageTone(usage: unknown): string;
  validationMessage(file: unknown, limits: unknown): string | null;
  buildConsentItem(consent: { type: string; version: string }, required: boolean): { type: string; version: string; required: boolean; label: string; description: string };
  splitConsents(requiredConsents: Array<{ type: string; version: string }>, optionalConsents: Array<{ type: string; version: string }>): { required: Array<{ type: string; version: string; required: boolean; label: string; description: string }>; optional: Array<{ type: string; version: string; required: boolean; label: string; description: string }> };
  areRequiredConsentsGranted(consentRecords: Array<{ consentType: string; status: string }>, requiredConsents: Array<{ type: string; version: string }>): boolean;
  buildConsentPayload(requiredItems: Array<{ type: string; version: string }>, optionalItems: Array<{ type: string; version: string }>, formData: FormData): Array<{ consentType: string; status: 'granted' | 'denied'; version: string }>;
}

/** The contract `capture-flow.js` needs: three calls, no DOM. */
interface CaptureDeps {
  reserve(input: { fileName: string; contentType: string; size: number }): Promise<{ receipt: Receipt; upload: unknown }>;
  uploadBytes(grant: unknown, file: unknown): Promise<unknown>;
  confirm(receiptId: string): Promise<Receipt>;
}

interface FlowError extends Error {
  code?: string;
  receiptId?: string;
  confirmable?: boolean;
  discardable?: boolean;
}

interface Recovery {
  action: 'confirm' | 'discard' | 'retry';
  receiptId: string | null;
  stage: string | null;
}

interface CaptureFlowModule {
  captureReceiptOnce(deps: CaptureDeps, file: unknown, onStep?: (step: unknown) => void): Promise<Receipt>;
  recoveryFor(error: unknown): Recovery;
  fetchRequiredConsents(deps: { fetch: typeof fetch }): Promise<{ required: Array<{ type: string; version: string }> }>;
  fetchOptionalConsents(deps: { fetch: typeof fetch }): Promise<{ optional: Array<{ type: string; version: string }> }>;
  submitConsent(deps: { fetch: typeof fetch }, consentInput: { consentType: string; status: string; version: string }): Promise<{ consent: unknown }>;
  submitConsents(deps: { fetch: typeof fetch }, consentInputs: Array<{ consentType: string; status: string; version: string }>): Promise<Array<{ consent: unknown }>>;
}

const format = require('../../public/format.js') as FormatModule;
const flow = require('../../public/capture-flow.js') as CaptureFlowModule;

const LIMITS = { maxImageBytes: 10 * 1024 * 1024, maxReceiptsPerMonth: 50, remaining: 40 };

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  const now = new Date().toISOString();
  return {
    receiptId: 'rcpt_1',
    userId: 'user_demo',
    metadata: {
      merchantName: 'Blue Bottle Coffee',
      transactionDate: '2026-09-30',
      subtotal: 420,
      tax: 36,
      total: 456,
      currency: 'USD',
    },
    lineItems: [{ description: 'Latte', quantity: 2, unitPrice: 210, total: 420 }],
    images: [{ s3Key: 'receipts/user_demo/rcpt_1/image_1.jpg', s3Bucket: 'b', contentType: 'image/jpeg', size: 20481 }],
    categories: [{ id: 'meals', name: 'Meals', confidence: 0.91, source: 'rule' }],
    status: 'processing',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

const unprocessed = receipt({
  receiptId: 'rcpt_pending',
  metadata: { merchantName: '', transactionDate: '2026-10-01', subtotal: 0, tax: 0, total: 0, currency: 'USD' },
  lineItems: [],
  images: [],
  categories: [],
  status: 'pending',
});

describe('status presentation', () => {
  it('labels every known status in plain language', () => {
    expect(format.statusLabel('pending')).toBe('Awaiting upload');
    expect(format.statusLabel('processing')).toBe('Awaiting extraction');
    expect(format.statusLabel('completed')).toBe('Ready to export');
    expect(format.statusLabel('failed')).toBe('Extraction failed');
    expect(format.statusLabel('archived')).toBe('Archived');
  });

  it('never throws on an unknown status', () => {
    expect(format.statusLabel('wat')).toBe('Unknown');
    expect(format.statusLabel(undefined)).toBe('Unknown');
    expect(format.statusTone('completed')).toBe('ok');
    expect(format.statusTone('failed')).toBe('bad');
    expect(format.statusTone('processing')).toBe('warn');
    expect(format.statusTone('archived')).toBe('idle');
  });
});

describe('value formatting', () => {
  it('formats byte counts for the file picker readout', () => {
    expect(format.formatBytes(0)).toBe('0 B');
    expect(format.formatBytes(20481)).toBe('20.0 KB');
    expect(format.formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
    expect(format.formatBytes('nope')).toBe('—');
    expect(format.formatBytes(undefined)).toBe('—');
  });

  it('groups amounts without silently assuming a minor unit', () => {
    expect(format.formatAmount(1100)).toBe('1,100.00');
    expect(format.formatAmount(0)).toBe('0.00');
    expect(format.formatAmount(-4.5)).toBe('-4.50');
    expect(format.formatAmount(null)).toBe('—');
    expect(format.formatAmount(Number.NaN)).toBe('—');
  });

  it('renders the receipt currency and falls back to a dash', () => {
    expect(format.formatCurrency(receipt())).toBe('USD');
    expect(format.formatCurrency(receipt({ metadata: { ...receipt().metadata, currency: '' } }))).toBe('—');
    expect(format.formatCurrency(null)).toBe('—');
  });

  it('formats timestamps in a requested time zone and survives bad input', () => {
    expect(format.formatDateTime('2026-10-01T14:03:00.000Z')).toBe('1 Oct 2026, 14:03');
    expect(format.formatDateTime('2026-10-01T14:03:00.000Z', 'UTC')).toBe('1 Oct 2026, 14:03');
    expect(format.formatDateTime('not-a-date')).toBe('—');
    expect(format.formatDateTime(undefined)).toBe('—');
  });

  it('summarises the picked file as name, size and type', () => {
    expect(format.formatFileSummary({ name: 'lunch.jpg', type: 'image/jpeg', size: 20481 })).toBe(
      'lunch.jpg · 20.0 KB · image/jpeg'
    );
  });

  it('exposes a single accept attribute shared by the file input and the drag zone', () => {
    expect(format.ACCEPT_ATTRIBUTE).toBe('image/jpeg,image/png,image/webp,image/heic');
  });
});

describe('receipt view data', () => {
  it('reports a total only when the receipt actually carries one', () => {
    expect(format.receiptTotal(receipt())).toBe(456);
    expect(format.receiptTotal(unprocessed)).toBeNull();
    expect(format.receiptTotal(null)).toBeNull();
  });

  it('reports a merchant only when one has been extracted', () => {
    expect(format.receiptMerchant(receipt())).toBe('Blue Bottle Coffee');
    expect(format.receiptMerchant(unprocessed)).toBeNull();
  });

  it('searches merchant, id, total, status and categories case-insensitively', () => {
    expect(format.matchesSearch(receipt(), 'bottle')).toBe(true);
    expect(format.matchesSearch(receipt(), 'BLUE')).toBe(true);
    expect(format.matchesSearch(receipt(), 'rcpt_1')).toBe(true);
    expect(format.matchesSearch(receipt(), '456')).toBe(true);
    expect(format.matchesSearch(receipt(), 'meals')).toBe(true);
    expect(format.matchesSearch(receipt(), 'processing')).toBe(true);
    expect(format.matchesSearch(receipt(), 'zzz')).toBe(false);
    expect(format.matchesSearch(receipt(), '   ')).toBe(true);
  });

  it('filters by search and status together', () => {
    const rows = [receipt(), unprocessed];

    expect(format.filterReceipts(rows, {})).toHaveLength(2);
    expect(format.filterReceipts(rows, { status: 'pending' })).toEqual([unprocessed]);
    expect(format.filterReceipts(rows, { query: 'bottle' })).toHaveLength(1);
    expect(format.filterReceipts(rows, { status: 'pending', query: 'bottle' })).toHaveLength(0);
  });

  it('sorts newest first without mutating the input', () => {
    const older = receipt({ receiptId: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = receipt({ receiptId: 'new', createdAt: '2026-05-01T00:00:00.000Z' });
    const input = [older, newer];

    const sorted = format.sortNewestFirst(input);

    expect(sorted.map((r) => r.receiptId)).toEqual(['new', 'old']);
    expect(input.map((r) => r.receiptId)).toEqual(['old', 'new']);
  });

  it('describes the list, including the empty and filtered states', () => {
    expect(format.listSummary({ total: 0, shown: 0 })).toBe('No receipts yet — capture one above.');
    expect(format.listSummary({ total: 5, shown: 5 })).toBe('5 receipts on file');
    expect(format.listSummary({ total: 5, shown: 2 })).toBe('Showing 2 of 5 receipts');
    expect(format.listSummary({ total: 5, shown: 0 })).toBe('No receipts match — clear the search.');
  });

  it('admits when the server holds more receipts than the page could load', () => {
    expect(format.listSummary({ total: 120, shown: 50, limit: 50 })).toBe(
      'Showing 50 of 120 receipts (page limit 50)'
    );
    expect(format.listSummary({ total: 2, shown: 2, limit: 50 })).toBe('2 receipts on file');
  });
});

describe('client and server agree on accepted file types', () => {
  it('advertises exactly the types the server accepts', () => {
    const advertised = format.ACCEPT_ATTRIBUTE.split(',').map((type) => type.trim());

    expect(advertised).toEqual([...SUPPORTED_IMAGE_TYPES]);
  });
});

describe('usage readout', () => {
  it('shows used, limit and what is left', () => {
    expect(format.usageLabel({ used: 12, limit: 50, remaining: 38 })).toBe(
      '12 of 50 receipts used · 38 left this month'
    );
    expect(format.usageLabel({ used: 50, limit: 50, remaining: 0 })).toBe(
      '50 of 50 receipts used · limit reached'
    );
  });

  it('flags an exhausted quota as blocking and a nearly spent one as a warning', () => {
    expect(format.usageTone({ used: 12, limit: 50, remaining: 38 })).toBe('ok');
    expect(format.usageTone({ used: 48, limit: 50, remaining: 2 })).toBe('warn');
    expect(format.usageTone({ used: 49, limit: 50, remaining: 1 })).toBe('warn');
    expect(format.usageTone({ used: 50, limit: 50, remaining: 0 })).toBe('bad');
  });

  it('stays neutral when the quota is unknown', () => {
    expect(format.usageTone(null)).toBe('idle');
    expect(format.usageTone({ used: 12, limit: 50 })).toBe('idle');
  });
});

describe('client-side pre-flight validation', () => {
  it('accepts a supported image within the limit', () => {
    expect(format.validationMessage({ name: 'lunch.jpg', type: 'image/jpeg', size: 20481 }, LIMITS)).toBeNull();
  });

  it('asks for a file before anything else', () => {
    expect(format.validationMessage(null, LIMITS)).toBe('Choose a receipt photo first.');
  });

  it('names the file and the accepted types when the type is unsupported', () => {
    const message = format.validationMessage({ name: 'invoice.pdf', type: 'application/pdf', size: 1024 }, LIMITS);

    expect(message).toContain('invoice.pdf');
    expect(message).toContain('JPEG, PNG, WebP or HEIC');
  });

  it('reports oversize and empty files in human units before the quota is spent', () => {
    expect(format.validationMessage({ name: 'big.jpg', type: 'image/jpeg', size: 12 * 1024 * 1024 }, LIMITS)).toBe(
      'big.jpg is 12.0 MB. The limit is 10.0 MB.'
    );
    expect(format.validationMessage({ name: 'empty.jpg', type: 'image/jpeg', size: 0 }, LIMITS)).toBe(
      'empty.jpg is empty — re-take the photo or pick another file.'
    );
  });

  it('stops the capture when the monthly free tier is spent', () => {
    expect(format.validationMessage({ name: 'lunch.jpg', type: 'image/jpeg', size: 100 }, { ...LIMITS, remaining: 0 })).toBe(
      'Monthly free-tier limit of 50 receipts reached — it resets at the start of next month.'
    );
  });
});

describe('capture flow (reserve → upload → confirm)', () => {
  const file = { name: 'lunch.jpg', type: 'image/jpeg', size: 20481 };

  function createDeps(overrides: Record<string, jest.Mock> = {}): CaptureDeps {
    return {
      reserve: overrides.reserve ?? jest.fn().mockResolvedValue({
        receipt: unprocessed,
        upload: { uploadUrl: '/api/uploads/tok', key: 'memory://tok', method: 'PUT', headers: {} },
      }),
      uploadBytes: overrides.uploadBytes ?? jest.fn().mockResolvedValue({ size: 20481 }),
      confirm: overrides.confirm ?? jest.fn().mockResolvedValue(receipt({ status: 'processing' })),
    };
  }

  it('does the whole capture in one call and reports each step once', async () => {
    const deps = createDeps();
    const steps: string[] = [];

    const result = await flow.captureReceiptOnce(deps, file, (step) => steps.push(String((step as { step: string }).step)));

    expect(result.status).toBe('processing');
    expect(steps).toEqual(['reserved', 'uploaded', 'confirmed']);
    expect(deps.reserve).toHaveBeenCalledWith({ fileName: 'lunch.jpg', contentType: 'image/jpeg', size: 20481 });
    expect(deps.uploadBytes).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: '/api/uploads/tok' }), file);
    expect(deps.confirm).toHaveBeenCalledWith('rcpt_pending');
  });

  it('works without a step callback', async () => {
    const deps = createDeps();

    await expect(flow.captureReceiptOnce(deps, file)).resolves.toMatchObject({ status: 'processing' });
  });

  it('never discards on its own — reclaiming a monthly slot is the console’s call', async () => {
    const deps = createDeps();

    await expect(flow.captureReceiptOnce(deps, file)).resolves.toMatchObject({ status: 'processing' });
    expect(Object.keys(deps)).toEqual(['reserve', 'uploadBytes', 'confirm']);
  });

  it('marks a failed upload as discardable so the quota is not silently burned', async () => {
    const deps = createDeps({
      uploadBytes: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 'UPLOAD_FAILED' })),
    });

    const error = (await flow
      .captureReceiptOnce(deps, file)
      .then(() => null)
      .catch((caught: FlowError) => caught)) as FlowError;

    expect(error).toMatchObject({ code: 'UPLOAD_FAILED', receiptId: 'rcpt_pending', discardable: true });
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it('marks a failed confirm as confirmable, not discardable — the bytes already landed', async () => {
    const deps = createDeps({ confirm: jest.fn().mockRejectedValue(Object.assign(new Error('late'), { code: 'TIMEOUT' })) });

    const error = (await flow
      .captureReceiptOnce(deps, file)
      .then(() => null)
      .catch((caught: FlowError) => caught)) as FlowError;

    expect(error).toMatchObject({ code: 'TIMEOUT', receiptId: 'rcpt_pending', confirmable: true, discardable: false });
  });

  it('never claims a receipt it does not have when the reserve call itself fails', async () => {
    const deps = createDeps({ reserve: jest.fn().mockRejectedValue(new Error('offline')) });

    const error = (await flow
      .captureReceiptOnce(deps, file)
      .then(() => null)
      .catch((caught: FlowError) => caught)) as FlowError;

    expect(error).toMatchObject({ discardable: false });
    expect(error.receiptId).toBeUndefined();
    expect(deps.uploadBytes).not.toHaveBeenCalled();
  });

  it('normalises a thrown non-Error into something the console can render', async () => {
    const deps = createDeps({ reserve: jest.fn().mockRejectedValue('plain string') });

    const error = (await flow
      .captureReceiptOnce(deps, file)
      .then(() => null)
      .catch((caught: FlowError) => caught)) as FlowError;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('plain string');
  });
});

describe('recovery after a failure', () => {
  it('repeats only the confirm when the bytes already landed', () => {
    const recovery = flow.recoveryFor({ code: 'TIMEOUT', receiptId: 'rcpt_1', confirmable: true });

    expect(recovery).toEqual({ action: 'confirm', receiptId: 'rcpt_1', stage: 'uploaded' });
  });

  it('offers the reclaim when a reserved receipt has no photo', () => {
    const recovery = flow.recoveryFor({ code: 'UPLOAD_FAILED', receiptId: 'rcpt_1', discardable: true });

    expect(recovery).toEqual({ action: 'discard', receiptId: 'rcpt_1', stage: 'reserved' });
  });

  it('falls back to a plain retry when no receipt was created', () => {
    expect(flow.recoveryFor(new Error('offline'))).toEqual({ action: 'retry', receiptId: null, stage: null });
    expect(flow.recoveryFor({ receiptId: 'rcpt_1' })).toEqual({ action: 'retry', receiptId: null, stage: null });
    expect(flow.recoveryFor(null)).toEqual({ action: 'retry', receiptId: null, stage: null });
  });

  it('does not offer a reclaim for a receipt it cannot name', () => {
    expect(flow.recoveryFor({ discardable: true, receiptId: '' }).action).toBe('retry');
    expect(flow.recoveryFor({ confirmable: true, receiptId: undefined }).action).toBe('retry');
  });
});

describe('consent formatting and validation', () => {
  const requiredConsents = [
    { type: 'terms_of_service', version: '1.0.0' },
    { type: 'privacy_policy', version: '1.0.0' },
    { type: 'data_processing', version: '1.0.0' },
  ];
  const optionalConsents = [
    { type: 'analytics', version: '1.0.0' },
    { type: 'marketing', version: '1.0.0' },
  ];

  describe('buildConsentItem', () => {
    it('builds a required consent item with label and description', () => {
      const item = format.buildConsentItem({ type: 'terms_of_service', version: '1.0.0' }, true);

      expect(item).toEqual({
        type: 'terms_of_service',
        version: '1.0.0',
        required: true,
        label: 'Terms of Service',
        description: 'You agree to the Terms of Service governing use of this service.',
      });
    });

    it('builds an optional consent item with label and description', () => {
      const item = format.buildConsentItem({ type: 'analytics', version: '1.0.0' }, false);

      expect(item).toEqual({
        type: 'analytics',
        version: '1.0.0',
        required: false,
        label: 'Analytics & Usage Data',
        description: 'Allow anonymous usage analytics to improve the service.',
      });
    });

    it('falls back to the type as label for unknown consent types', () => {
      const item = format.buildConsentItem({ type: 'unknown_consent', version: '1.0.0' }, true);

      expect(item.label).toBe('unknown_consent');
      expect(item.description).toBe('');
    });
  });

  describe('splitConsents', () => {
    it('splits required and optional consents with labels and descriptions', () => {
      const result = format.splitConsents(requiredConsents, optionalConsents);

      expect(result.required).toHaveLength(3);
      expect(result.optional).toHaveLength(2);
      expect(result.required[0].required).toBe(true);
      expect(result.optional[0].required).toBe(false);
      expect(result.required[0].label).toBe('Terms of Service');
      expect(result.optional[0].label).toBe('Analytics & Usage Data');
    });

    it('handles empty arrays gracefully', () => {
      const result = format.splitConsents([], []);

      expect(result.required).toEqual([]);
      expect(result.optional).toEqual([]);
    });

    it('handles undefined inputs gracefully', () => {
      const result = format.splitConsents(undefined as unknown as typeof requiredConsents, undefined as unknown as typeof optionalConsents);

      expect(result.required).toEqual([]);
      expect(result.optional).toEqual([]);
    });
  });

  describe('areRequiredConsentsGranted', () => {
    it('returns true when all required consents are granted', () => {
      const records = [
        { consentType: 'terms_of_service', status: 'granted' },
        { consentType: 'privacy_policy', status: 'granted' },
        { consentType: 'data_processing', status: 'granted' },
      ];

      expect(format.areRequiredConsentsGranted(records, requiredConsents)).toBe(true);
    });

    it('returns false when any required consent is missing', () => {
      const records = [
        { consentType: 'terms_of_service', status: 'granted' },
        { consentType: 'privacy_policy', status: 'granted' },
      ];

      expect(format.areRequiredConsentsGranted(records, requiredConsents)).toBe(false);
    });

    it('returns false when a required consent is denied', () => {
      const records = [
        { consentType: 'terms_of_service', status: 'granted' },
        { consentType: 'privacy_policy', status: 'denied' },
        { consentType: 'data_processing', status: 'granted' },
      ];

      expect(format.areRequiredConsentsGranted(records, requiredConsents)).toBe(false);
    });

    it('returns false when a required consent is withdrawn', () => {
      const records = [
        { consentType: 'terms_of_service', status: 'granted' },
        { consentType: 'privacy_policy', status: 'withdrawn' },
        { consentType: 'data_processing', status: 'granted' },
      ];

      expect(format.areRequiredConsentsGranted(records, requiredConsents)).toBe(false);
    });

    it('returns false for empty records', () => {
      expect(format.areRequiredConsentsGranted([], requiredConsents)).toBe(false);
    });

    it('returns false for null/undefined records', () => {
      expect(format.areRequiredConsentsGranted(null as unknown as Array<{ consentType: string; status: string }>, requiredConsents)).toBe(false);
      expect(format.areRequiredConsentsGranted(undefined as unknown as Array<{ consentType: string; status: string }>, requiredConsents)).toBe(false);
    });

    it('ignores optional consents in the check', () => {
      const records = [
        { consentType: 'terms_of_service', status: 'granted' },
        { consentType: 'privacy_policy', status: 'granted' },
        { consentType: 'data_processing', status: 'granted' },
        { consentType: 'analytics', status: 'denied' },
        { consentType: 'marketing', status: 'denied' },
      ];

      expect(format.areRequiredConsentsGranted(records, requiredConsents)).toBe(true);
    });
  });

  describe('buildConsentPayload', () => {
    it('builds payload from form data with granted and denied statuses', () => {
      const requiredItems = [
        { type: 'terms_of_service', version: '1.0.0', required: true, label: 'Terms of Service', description: '' },
        { type: 'privacy_policy', version: '1.0.0', required: true, label: 'Privacy Policy', description: '' },
      ];
      const optionalItems = [
        { type: 'analytics', version: '1.0.0', required: false, label: 'Analytics', description: '' },
      ];

      const formData = new FormData();
      formData.append('consent_terms_of_service', 'on');
      formData.append('consent_privacy_policy', 'on');
      // analytics not checked = denied

      const payload = format.buildConsentPayload(requiredItems, optionalItems, formData);

      expect(payload).toEqual([
        { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' },
        { consentType: 'privacy_policy', status: 'granted', version: '1.0.0' },
        { consentType: 'analytics', status: 'denied', version: '1.0.0' },
      ]);
    });

    it('handles empty form data (all denied)', () => {
      const requiredItems = [
        { type: 'terms_of_service', version: '1.0.0', required: true, label: 'Terms of Service', description: '' },
      ];
      const optionalItems = [
        { type: 'analytics', version: '1.0.0', required: false, label: 'Analytics', description: '' },
      ];

      const formData = new FormData();

      const payload = format.buildConsentPayload(requiredItems, optionalItems, formData);

      expect(payload).toEqual([
        { consentType: 'terms_of_service', status: 'denied', version: '1.0.0' },
        { consentType: 'analytics', status: 'denied', version: '1.0.0' },
      ]);
    });
  });
});

describe('consent API calls', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  const mockFetchDeps = { fetch: mockFetch };

  it('fetchRequiredConsents returns the required array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ required: [{ type: 'terms_of_service', version: '1.0.0' }] }),
    });

    const result = await flow.fetchRequiredConsents(mockFetchDeps);

    expect(mockFetch).toHaveBeenCalledWith('/api/compliance/consent/required');
    expect(result.required).toEqual([{ type: 'terms_of_service', version: '1.0.0' }]);
  });

  it('fetchRequiredConsents throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(flow.fetchRequiredConsents(mockFetchDeps)).rejects.toMatchObject({
      code: 'CONSENT_FETCH_FAILED',
    });
  });

  it('fetchOptionalConsents returns the optional array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ optional: [{ type: 'analytics', version: '1.0.0' }] }),
    });

    const result = await flow.fetchOptionalConsents(mockFetchDeps);

    expect(mockFetch).toHaveBeenCalledWith('/api/compliance/consent/optional');
    expect(result.optional).toEqual([{ type: 'analytics', version: '1.0.0' }]);
  });

  it('submitConsent posts consent and returns the record', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ consent: { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' } }),
    });

    const result = await flow.submitConsent(mockFetchDeps, {
      consentType: 'terms_of_service',
      status: 'granted',
      version: '1.0.0',
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/compliance/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' } }),
    });
    expect(result.consent).toEqual({ consentType: 'terms_of_service', status: 'granted', version: '1.0.0' });
  });

  it('submitConsent throws on error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'Invalid consent' } }),
    });

    await expect(
      flow.submitConsent(mockFetchDeps, { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('submitConsents submits multiple consents in sequence', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ consent: { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ consent: { consentType: 'privacy_policy', status: 'granted', version: '1.0.0' } }),
      });

    const results = await flow.submitConsents(mockFetchDeps, [
      { consentType: 'terms_of_service', status: 'granted', version: '1.0.0' },
      { consentType: 'privacy_policy', status: 'granted', version: '1.0.0' },
    ]);

    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
