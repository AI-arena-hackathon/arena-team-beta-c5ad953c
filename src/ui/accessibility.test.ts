/**
 * Tests for the capture console's accessibility contract.
 *
 * Two surfaces are covered, because that is what accessibility work in this
 * repo can actually be tested against without a DOM:
 *
 * 1. The pure descriptors in `public/format.js` — the accessible names, the
 *    "what is blocking this capture" decision and the live-region copy. Every
 *    string a screen reader speaks for the console is decided there.
 * 2. The static markup in `public/index.html` / `public/app.js` — a regression
 *    guard on the scaffolding (skip link, table caption, focusable alert
 *    targets) and the invariant that every id the DOM glue reaches for exists
 *    in the shipped markup, because a missing one fails silently as `null`.
 *
 * `jest-environment-jsdom` is not a dependency, so the DOM writes themselves
 * stay unverified here and are checked in the browser instead.
 */
import * as fs from 'fs';
import * as path from 'path';

import type { Receipt } from '../types/receipt';

interface BlockingReason {
  field: 'image' | 'consent';
  message: string;
}

interface ConsentItem {
  type: string;
  version: string;
  required: boolean;
  label: string;
  description: string;
}

interface AccessibilityModule {
  actionLabel(action: unknown, receiptId?: unknown): string;
  actionText(action: unknown): string;
  detailAnnouncement(receipt: unknown): string;
  missingRequiredConsents(requiredConsents: unknown, grantedTypes: unknown): ConsentItem[];
  blockingReason(input: { fileProblem?: unknown; missingConsents?: ConsentItem[] }): BlockingReason | null;
}

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const markup = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const appScript = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

const format = require('../../public/format.js') as AccessibilityModule;

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
    lineItems: [],
    images: [],
    categories: [],
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

const bareMetadata = {
  merchantName: '',
  transactionDate: '2026-10-01',
  subtotal: 0,
  tax: 0,
  total: 0,
  currency: 'USD',
};

describe('accessible names for the record row controls', () => {
  it('names each row control after the receipt it acts on, not "View"', () => {
    expect(format.actionLabel('view', 'rcpt_1')).toBe('View receipt rcpt_1');
    expect(format.actionLabel('discard', 'rcpt_1')).toBe('Discard pending receipt rcpt_1');
  });

  it('never invents a receipt id it does not have', () => {
    expect(format.actionLabel('view')).toBe('View receipt');
    expect(format.actionLabel('view', '')).toBe('View receipt');
    expect(format.actionLabel('discard', null)).toBe('Discard pending receipt');
  });

  it('degrades to a readable name for an unknown action rather than shouting undefined', () => {
    expect(format.actionLabel('wat', 'rcpt_1')).toBe('Receipt rcpt_1');
    expect(format.actionLabel(null, 'rcpt_1')).toBe('Receipt rcpt_1');
  });

  it('keeps the visible control text short — the receipt id belongs in the name, not the button', () => {
    expect(format.actionText('view')).toBe('View');
    expect(format.actionText('discard')).toBe('Discard');
    expect(format.actionText('wat')).toBe('Control');
  });
});

describe('the detail panel announces what it just opened', () => {
  it('reads out merchant, amount and status in one line', () => {
    expect(format.detailAnnouncement(receipt())).toBe('Blue Bottle Coffee — 456.00 USD — Ready to export');
  });

  it('names the receipt id when nothing has been extracted yet', () => {
    const pending = receipt({ receiptId: 'rcpt_pending', metadata: bareMetadata, status: 'pending' });

    expect(format.detailAnnouncement(pending)).toBe('Receipt rcpt_pending — Awaiting upload');
  });

  it('never reads out a total the data model does not have', () => {
    const processing = receipt({ receiptId: 'rcpt_2', metadata: bareMetadata, status: 'processing' });

    expect(format.detailAnnouncement(processing)).not.toContain('0.00');
    expect(format.detailAnnouncement(processing)).toContain('Receipt rcpt_2');
  });
});

describe('required consents the user has not accepted yet', () => {
  const required = [
    { type: 'terms_of_service', version: '1.0.0' },
    { type: 'privacy_policy', version: '1.0.0' },
  ];

  it('lists only the outstanding ones, with their human labels', () => {
    const missing = format.missingRequiredConsents(required, ['terms_of_service']);

    expect(missing).toHaveLength(1);
    expect(missing[0].type).toBe('privacy_policy');
    expect(missing[0].label).toBe('Privacy Policy');
  });

  it('reports none when every required consent is granted', () => {
    expect(format.missingRequiredConsents(required, ['terms_of_service', 'privacy_policy'])).toEqual([]);
  });

  it('reports every required consent when none are granted', () => {
    expect(format.missingRequiredConsents(required, []).map((item) => item.type)).toEqual([
      'terms_of_service',
      'privacy_policy',
    ]);
  });

  it('survives a failed consent load instead of claiming the user agreed to nothing', () => {
    expect(format.missingRequiredConsents(undefined, undefined)).toEqual([]);
    expect(format.missingRequiredConsents(required, undefined)).toHaveLength(2);
    expect(format.missingRequiredConsents(null, 'terms_of_service')).toEqual([]);
  });
});

describe('what is blocking a capture, and which control owns the fix', () => {
  it('sends a file problem to the file picker', () => {
    const reason = format.blockingReason({ fileProblem: 'Choose a receipt photo first.', missingConsents: [] });

    expect(reason).toEqual({ field: 'image', message: 'Choose a receipt photo first.' });
  });

  it('sends outstanding consents to the consent list and names them', () => {
    const missing = format.missingRequiredConsents(
      [
        { type: 'terms_of_service', version: '1.0.0' },
        { type: 'privacy_policy', version: '1.0.0' },
      ],
      ['terms_of_service']
    );

    const reason = format.blockingReason({ missingConsents: missing });

    expect(reason?.field).toBe('consent');
    expect(reason?.message).toContain('Privacy Policy');
    expect(reason?.message).not.toContain('Terms of Service');
  });

  it('answers with the file problem first, because nothing is recorded until the photo is checked', () => {
    const reason = format.blockingReason({
      fileProblem: 'invoice.pdf is not a supported image.',
      missingConsents: [{ type: 'privacy_policy', version: '1.0.0', required: true, label: 'Privacy Policy', description: '' }],
    });

    expect(reason?.field).toBe('image');
  });

  it('reports nothing blocking when the capture can run', () => {
    expect(format.blockingReason({ missingConsents: [] })).toBeNull();
    expect(format.blockingReason({})).toBeNull();
  });
});

describe('the shipped console markup keeps its accessibility scaffolding', () => {
  it('gives every element app.js reaches for a real id in the markup', () => {
    const referenced = Array.from(appScript.matchAll(/getElementById\('([^']+)'\)/g)).map((match) => match[1]);
    const declared = Array.from(markup.matchAll(/\sid="([^"]+)"/g)).map((match) => match[1]);

    expect(referenced.length).toBeGreaterThan(10);
    const missing = referenced.filter((id) => !declared.includes(id));
    expect(missing).toEqual([]);
  });

  it('offers a skip link that lands on a focusable main landmark', () => {
    expect(markup).toMatch(/<a[^>]+class="skip-link"[^>]+href="#main"/);
    expect(markup).toMatch(/<main[^>]+id="main"[^>]+tabindex="-1"/);
  });

  it('names the records table, so it is not announced as a bare "table"', () => {
    expect(markup).toMatch(/<table id="receipts">\s*<caption class="visually-hidden">[^<]+<\/caption>/);
  });

  it('makes the error box and the resume banner reachable by focus', () => {
    expect(markup).toMatch(/id="capture-error"[^>]*tabindex="-1"/);
    expect(markup).toMatch(/id="resume-banner"[^>]*tabindex="-1"/);
  });

  it('labels the drop zone and describes it, instead of announcing a bare "button"', () => {
    expect(markup).toMatch(/id="drop-zone"[^>]+aria-labelledby="receipt-image-label"/);
    expect(markup).toMatch(/id="receipt-image-label"/);
    expect(markup).toMatch(/id="drop-zone"[^>]+aria-describedby="file-help file-summary"/);
  });

  it('gives the service status and the detail panel a live region each', () => {
    expect(markup).toMatch(/class="status-row"[^>]+role="status"/);
    expect(markup).toMatch(/id="detail-announcement"[^>]+role="status"/);
    expect(markup).toMatch(/id="consent-summary"[^>]+role="status"/);
  });

  it('honours a reduced-motion preference', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
