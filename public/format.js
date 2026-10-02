'use strict';

/**
 * View-model helpers for the browser capture console.
 *
 * Loaded as a classic script (no build step), so every symbol lives inside the
 * factory below: classic scripts share one global scope, and the next file to
 * declare `const api` would otherwise break the page. Exports land on
 * `window.CaptureFormat` in the browser and on `module.exports` for the jest
 * suite in `src/ui/console.test.ts`. Everything inside is pure: no DOM, no
 * fetch, no globals.
 */

(function attach(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CaptureFormat = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function makeCaptureFormat() {
  const ACCEPT_ATTRIBUTE = 'image/jpeg,image/png,image/webp,image/heic';
  const DASH = '—';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Remaining monthly slots at or below this get an amber pill.
  const LOW_QUOTA = 2;

  const CONSENT_LABELS = {
    terms_of_service: 'Terms of Service',
    privacy_policy: 'Privacy Policy',
    data_processing: 'Data Processing Agreement',
    analytics: 'Analytics & Usage Data',
    marketing: 'Marketing Communications',
  };

  const CONSENT_DESCRIPTIONS = {
    terms_of_service: 'You agree to the Terms of Service governing use of this service.',
    privacy_policy: 'You acknowledge the Privacy Policy describing how your data is collected and used.',
    data_processing: 'You consent to processing of your receipt data for expense extraction.',
    analytics: 'Allow anonymous usage analytics to improve the service.',
    marketing: 'Receive occasional product updates and tips via email.',
  };

  const STATUS_LABELS = {
    pending: 'Awaiting upload',
    processing: 'Awaiting extraction',
    completed: 'Ready to export',
    failed: 'Extraction failed',
    archived: 'Archived',
  };

  const STATUS_TONES = {
    pending: 'warn',
    processing: 'warn',
    completed: 'ok',
    failed: 'bad',
    archived: 'idle',
  };

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function statusLabel(status) {
    return has(STATUS_LABELS, status) ? STATUS_LABELS[status] : 'Unknown';
  }

  function statusTone(status) {
    return has(STATUS_TONES, status) ? STATUS_TONES[status] : 'idle';
  }

  function formatBytes(bytes) {
    if (!isFiniteNumber(bytes) || bytes < 0) return DASH;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
  }

  /** Groups a decimal without assuming a minor unit — the API does not define one. */
  function formatAmount(value) {
    if (!isFiniteNumber(value)) return DASH;
    const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${value < 0 ? '-' : ''}${grouped}.${fraction}`;
  }

  function formatCurrency(receipt) {
    const currency = receipt && receipt.metadata ? receipt.metadata.currency : '';
    return typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : DASH;
  }

  function monthIndex(month) {
    const index = MONTHS.indexOf(month);
    return index === -1 ? 0 : index;
  }

  const FORMATTERS = new Map();

  function formatterFor(timeZone) {
    if (!FORMATTERS.has(timeZone)) {
      FORMATTERS.set(
        timeZone,
        new Intl.DateTimeFormat('en-GB', {
          timeZone,
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      );
    }
    return FORMATTERS.get(timeZone);
  }

  function formatDateTime(iso, timeZone) {
    if (typeof iso !== 'string' || !iso) return DASH;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return DASH;
    const parts = formatterFor(timeZone || 'UTC').formatToParts(date);
    const read = (type) => {
      const part = parts.find((candidate) => candidate.type === type);
      return part ? part.value : '';
    };
    // en-GB renders midnight as "24" in some ICU versions.
    const hour = read('hour') === '24' ? '00' : read('hour');
    return `${read('day')} ${MONTHS[monthIndex(read('month'))]} ${read('year')}, ${hour}:${read('minute')}`;
  }

  function fileName(file) {
    if (!file) return DASH;
    return typeof file.name === 'string' && file.name ? file.name : 'the selected file';
  }

  function formatFileSummary(file) {
    if (!file) return DASH;
    const type = typeof file.type === 'string' && file.type ? file.type : 'unknown type';
    return `${fileName(file)} · ${formatBytes(file.size)} · ${type}`;
  }

  /** A total of 0 means "not extracted yet" in this data model, not "free". */
  function receiptTotal(receipt) {
    const total = receipt && receipt.metadata ? receipt.metadata.total : undefined;
    return isFiniteNumber(total) && total > 0 ? total : null;
  }

  function receiptMerchant(receipt) {
    const merchant = receipt && receipt.metadata ? receipt.metadata.merchantName : '';
    return typeof merchant === 'string' && merchant.trim() ? merchant.trim() : null;
  }

  function receiptSearchText(receipt) {
    if (!receipt) return '';
    const total = receiptTotal(receipt);
    const parts = [
      receipt.receiptId,
      receipt.status,
      statusLabel(receipt.status),
      receiptMerchant(receipt),
      total === null ? '' : formatAmount(total),
      Array.isArray(receipt.categories) ? receipt.categories.map((category) => category.name).join(' ') : '',
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function matchesSearch(receipt, query) {
    const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!needle) return true;
    return receiptSearchText(receipt).includes(needle);
  }

  function filterReceipts(receipts, options) {
    const rows = Array.isArray(receipts) ? receipts : [];
    const settings = options || {};
    const query = settings.query || '';
    const status = settings.status || '';
    return rows.filter((receipt) => (status ? receipt.status === status : true) && matchesSearch(receipt, query));
  }

  function sortNewestFirst(receipts) {
    return (Array.isArray(receipts) ? receipts.slice() : []).sort((a, b) => {
      const left = typeof a.createdAt === 'string' ? a.createdAt : '';
      const right = typeof b.createdAt === 'string' ? b.createdAt : '';
      if (left === right) return 0;
      return left < right ? 1 : -1;
    });
  }

  /**
   * `total` is the server's count, which can exceed the page that was loaded —
   * saying "50 receipts on file" when 120 exist is the kind of small lie that
   * makes a user distrust every number on the page.
   */
  function listSummary(summary) {
    const { total, shown, limit } = summary || {};
    if (!isFiniteNumber(total) || total === 0) return 'No receipts yet — capture one above.';
    if (isFiniteNumber(shown) && shown < total) {
      if (shown === 0) return 'No receipts match — clear the search.';
      const tail = isFiniteNumber(limit) && limit < total ? ` (page limit ${limit})` : '';
      return `Showing ${shown} of ${total} receipts${tail}`;
    }
    return `${total} receipt${total === 1 ? '' : 's'} on file`;
  }

  function usageLabel(usage) {
    if (!usage) return 'usage unavailable';
    const { used, limit, remaining } = usage;
    if (!isFiniteNumber(used) || !isFiniteNumber(limit)) return 'usage unavailable';
    const left = isFiniteNumber(remaining) ? remaining : Math.max(limit - used, 0);
    return `${used} of ${limit} receipts used · ${left <= 0 ? 'limit reached' : `${left} left this month`}`;
  }

  function usageTone(usage) {
    if (!usage) return 'idle';
    if (!isFiniteNumber(usage.remaining)) return 'idle';
    if (usage.remaining <= 0) return 'bad';
    // A couple of slots left is worth flagging before the user discovers it the
    // hard way at month end.
    return usage.remaining <= LOW_QUOTA ? 'warn' : 'ok';
  }

  /**
   * Pre-flight check run in the browser before a single byte leaves the page, so
   * a wrong file never costs the user one of the month's receipt slots. Mirrors
   * the rules in `src/services/capture.ts`; the server stays the authority.
   */
  function validationMessage(file, limits) {
    const settings = limits || {};
    if (!file) return 'Choose a receipt photo first.';
    if (typeof file.type !== 'string' || ACCEPT_ATTRIBUTE.split(',').indexOf(file.type) === -1) {
      return `${fileName(file)} is not a supported image. Use JPEG, PNG, WebP or HEIC.`;
    }
    if (!isFiniteNumber(file.size) || file.size <= 0) {
      return `${fileName(file)} is empty — re-take the photo or pick another file.`;
    }
    if (isFiniteNumber(settings.maxImageBytes) && file.size > settings.maxImageBytes) {
      return `${fileName(file)} is ${formatBytes(file.size)}. The limit is ${formatBytes(settings.maxImageBytes)}.`;
    }
    if (isFiniteNumber(settings.remaining) && settings.remaining <= 0) {
      const limit = isFiniteNumber(settings.maxReceiptsPerMonth) ? settings.maxReceiptsPerMonth : settings.remaining;
      return `Monthly free-tier limit of ${limit} receipts reached — it resets at the start of next month.`;
    }
    return null;
  }

  /** Build a consent checkbox item object for rendering. Pure data, no DOM. */
  function buildConsentItem(consent, required) {
    return {
      type: consent.type,
      version: consent.version,
      required: required,
      label: CONSENT_LABELS[consent.type] || consent.type,
      description: CONSENT_DESCRIPTIONS[consent.type] || '',
    };
  }

  /** Split consent types into required and optional groups with labels. */
  function splitConsents(requiredConsents, optionalConsents) {
    const required = (requiredConsents || []).map((consent) => buildConsentItem(consent, true));
    const optional = (optionalConsents || []).map((consent) => buildConsentItem(consent, false));
    return { required, optional };
  }

  /** Check if all required consents are granted in the user's consent records. */
  function areRequiredConsentsGranted(consentRecords, requiredConsents) {
    if (!Array.isArray(consentRecords) || !Array.isArray(requiredConsents)) return false;
    const granted = new Set(
      consentRecords
        .filter((record) => record.status === 'granted')
        .map((record) => record.consentType)
    );
    return requiredConsents.every((consent) => granted.has(consent.type));
  }

  /** Build the payload for the consent API from checkbox states. */
  function buildConsentPayload(requiredItems, optionalItems, formData) {
    const payload = [];
    requiredItems.forEach((item) => {
      const checked = formData.get(`consent_${item.type}`) === 'on';
      payload.push({ consentType: item.type, status: checked ? 'granted' : 'denied', version: item.version });
    });
    optionalItems.forEach((item) => {
      const checked = formData.get(`consent_${item.type}`) === 'on';
      payload.push({ consentType: item.type, status: checked ? 'granted' : 'denied', version: item.version });
    });
    return payload;
  }

  return {
    ACCEPT_ATTRIBUTE,
    formatAmount,
    formatBytes,
    formatCurrency,
    formatDateTime,
    formatFileSummary,
    filterReceipts,
    listSummary,
    matchesSearch,
    receiptMerchant,
    receiptTotal,
    sortNewestFirst,
    statusLabel,
    statusTone,
    usageLabel,
    usageTone,
    validationMessage,
    buildConsentItem,
    splitConsents,
    areRequiredConsentsGranted,
    buildConsentPayload,
  };
});
