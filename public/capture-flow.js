'use strict';

/**
 * The capture state machine behind the console's single "Capture receipt"
 * action: reserve → upload → confirm, in that order, in one call.
 *
 * `deps` are the four API calls (supplied by app.js), so this file stays
 * DOM-free and is unit-tested from `src/ui/console.test.ts`. Failures are
 * re-thrown carrying the recovery the UI should offer: a failed upload is
 * `discardable` (the bytes never landed, so the month's slot can be reclaimed),
 * a failed confirm is `confirmable` (the bytes are up, only the flip is
 * missing). Every error leaves the function with both flags set so the UI can
 * read them without a guard.
 */

(function attach(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CaptureFlow = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function makeCaptureFlow() {
  const CONSENT_API = {
    required: '/api/compliance/consent/required',
    optional: '/api/compliance/consent/optional',
    submit: '/api/compliance/consent',
  };

  function toError(value) {
    if (value instanceof Error) return value;
    const error = new Error(typeof value === 'string' ? value : JSON.stringify(value));
    if (value && typeof value === 'object' && typeof value.code === 'string') {
      error.code = value.code;
    }
    return error;
  }

  function fail(error, flags) {
    const failure = toError(error);
    failure.discardable = Boolean(flags.discardable);
    failure.confirmable = Boolean(flags.confirmable);
    if (flags.receiptId) failure.receiptId = flags.receiptId;
    return failure;
  }

  function announce(onStep, name, receiptId, detail) {
    if (typeof onStep === 'function') {
      onStep(Object.assign({ step: name, receiptId }, detail || {}));
    }
  }

  /**
   * What the console should offer after a failure. The bytes decide it: a failed
   * upload can be reclaimed (discard), a failed confirm only needs the flip
   * repeated (confirm), and a failure before any receipt exists is just a retry.
   */
  function recoveryFor(error) {
    if (error && error.confirmable && error.receiptId) {
      return { action: 'confirm', receiptId: error.receiptId, stage: 'uploaded' };
    }
    if (error && error.discardable && error.receiptId) {
      return { action: 'discard', receiptId: error.receiptId, stage: 'reserved' };
    }
    return { action: 'retry', receiptId: null, stage: null };
  }

  /** Fetch the list of required consent types and versions from the API. */
  async function fetchRequiredConsents(deps) {
    const response = await deps.fetch(CONSENT_API.required);
    if (!response.ok) throw toError({ code: 'CONSENT_FETCH_FAILED', message: 'Failed to load required consents' });
    return response.json();
  }

  /** Fetch the list of optional consent types and versions from the API. */
  async function fetchOptionalConsents(deps) {
    const response = await deps.fetch(CONSENT_API.optional);
    if (!response.ok) throw toError({ code: 'CONSENT_FETCH_FAILED', message: 'Failed to load optional consents' });
    return response.json();
  }

  /** Submit a consent record to the API. */
  async function submitConsent(deps, consentInput) {
    const response = await deps.fetch(CONSENT_API.submit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: consentInput }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw toError(body.error || { code: 'CONSENT_SUBMIT_FAILED', message: 'Failed to submit consent' });
    }
    return response.json();
  }

  /** Submit multiple consent records in sequence. */
  async function submitConsents(deps, consentInputs) {
    const results = [];
    for (const input of consentInputs) {
      const result = await submitConsent(deps, input);
      results.push(result);
    }
    return results;
  }

  async function captureReceiptOnce(deps, file, onStep) {
    let reserved;
    try {
      reserved = await deps.reserve({ fileName: file.name, contentType: file.type, size: file.size });
    } catch (error) {
      throw fail(error, {});
    }

    const receiptId = reserved.receipt.receiptId;
    announce(onStep, 'reserved', receiptId);

    let uploaded;
    try {
      uploaded = await deps.uploadBytes(reserved.upload, file);
    } catch (error) {
      throw fail(error, { receiptId, discardable: true });
    }
    announce(onStep, 'uploaded', receiptId, { bytes: uploaded && uploaded.size });

    try {
      const receipt = await deps.confirm(receiptId);
      announce(onStep, 'confirmed', receiptId, { status: receipt && receipt.status });
      return receipt;
    } catch (error) {
      throw fail(error, { receiptId, confirmable: true });
    }
  }

  return { captureReceiptOnce, recoveryFor, fetchRequiredConsents, fetchOptionalConsents, submitConsent, submitConsents };
});
