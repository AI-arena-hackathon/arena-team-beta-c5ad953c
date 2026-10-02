'use strict';

/**
 * DOM wiring for the capture console. All decisions live in ./format.js and
 * ./capture-flow.js so they can be unit-tested without a browser; this file only
 * talks to the DOM, the network and sessionStorage.
 *
 * House rules (enforced by the app's CSP): no inline handlers, no innerHTML with
 * server data, no third-party assets.
 */

(function bootConsole() {
  'use strict';

  const PENDING_KEY = 'auto-expense:pending';
  const DEFAULT_LIMITS = { maxImageBytes: 10 * 1024 * 1024, maxReceiptsPerMonth: 50 };

  // Loaded classic scripts above in <script> order; aliased once so the rest of
  // the file reads like ordinary code.
  const format = window.CaptureFormat;
  const flow = window.CaptureFlow;

  const els = {
    userId: document.getElementById('user-id'),
    image: document.getElementById('receipt-image'),
    dropZone: document.getElementById('drop-zone'),
    form: document.getElementById('capture-form'),
    captureButton: document.getElementById('capture-button'),
    progress: document.getElementById('capture-progress'),
    fileSummary: document.getElementById('file-summary'),
    errorBox: document.getElementById('capture-error'),
    errorMessage: document.getElementById('capture-error-message'),
    retryButton: document.getElementById('retry-button'),
    discardButton: document.getElementById('discard-button'),
    dismissError: document.getElementById('dismiss-error'),
    resumeBanner: document.getElementById('resume-banner'),
    resumeMessage: document.getElementById('resume-message'),
    resumeConfirm: document.getElementById('resume-confirm'),
    resumeDiscard: document.getElementById('resume-discard'),
    resumeDismiss: document.getElementById('resume-dismiss'),
    health: document.getElementById('health'),
    usage: document.getElementById('usage'),
    statusFilter: document.getElementById('status-filter'),
    searchInput: document.getElementById('search-input'),
    refreshButton: document.getElementById('refresh-button'),
    listResult: document.getElementById('list-result'),
    tableBody: document.querySelector('#receipts tbody'),
    detailBody: document.getElementById('detail-body'),
    detailAnnouncement: document.getElementById('detail-announcement'),
    consentFieldset: document.getElementById('consent-fieldset'),
    optionalConsentFieldset: document.getElementById('optional-consent-fieldset'),
    requiredConsents: document.getElementById('required-consents'),
    optionalConsents: document.getElementById('optional-consents'),
    consentSummary: document.getElementById('consent-summary'),
  };

  const state = {
    // Numeric caps come from /api/config, the remaining allowance from
    // /api/usage. They are kept apart because they answer to different requests
    // and must not overwrite each other.
    limits: { ...DEFAULT_LIMITS },
    remaining: null,
    count: 0,
    limit: null,
    receipts: [],
    selectedId: null,
    detail: null,
    busy: false,
    // The action the error box's "Try again" button runs, decided per failure.
    retryAction: null,
    // Where focus came from before the error box took it, so dismissing the box
    // returns the user to the field they were in.
    errorReturnFocus: null,
    // The reserved receipt the error box's "Discard" button reclaims. Held in
    // memory too, so the affordance survives when sessionStorage is blocked.
    discardableId: null,
    timeZone: 'UTC',
    // Consent state
    requiredConsents: [],
    optionalConsents: [],
    consentsLoaded: false,
    consentRecords: [],
  };

  const STEP_TEXT = {
    reserved: 'Reserved the receipt…',
    uploaded: 'Uploaded the photo…',
    confirmed: 'Queued for extraction…',
  };

  /* ---------------------------------------------------------------- transport */

  function authHeaders(extra) {
    return Object.assign({ 'Content-Type': 'application/json', 'x-user-id': els.userId.value.trim() }, extra || {});
  }

  async function requestJson(path, options) {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error((body.error && body.error.message) || `Request failed (${response.status})`);
      error.code = (body.error && body.error.code) || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  const api = {
    async config() {
      const body = await requestJson('/api/config');
      return body.features || {};
    },
    async health() {
      return requestJson('/health');
    },
    async usage() {
      const body = await requestJson('/api/usage', { headers: authHeaders() });
      return body.usage;
    },
    async list(params) {
      const query = params.toString();
      return requestJson(`/api/receipts${query ? `?${query}` : ''}`, { headers: authHeaders() });
    },
    async getReceipt(receiptId) {
      const body = await requestJson(`/api/receipts/${encodeURIComponent(receiptId)}`, { headers: authHeaders() });
      return body.receipt;
    },
    async reserve(image) {
      return requestJson('/api/receipts', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image }) });
    },
    async uploadBytes(grant, file) {
      const target = grant.uploadUrl.startsWith('/') ? grant.uploadUrl : new URL(grant.uploadUrl).pathname;
      // The identity header is required by the upload route even for presigned
      // URLs. The bucket is same-origin in every configuration we ship, so this
      // never travels cross-origin; keep it that way if a bucket is ever moved.
      const headers = Object.assign({}, grant.headers, { 'x-user-id': els.userId.value.trim() });
      return requestJson(target, { method: grant.method || 'PUT', headers, body: file });
    },
    async confirm(receiptId) {
      const body = await requestJson(`/api/receipts/${encodeURIComponent(receiptId)}/complete`, {
        method: 'POST',
        headers: authHeaders(),
      });
      return body.receipt;
    },
    async discard(receiptId) {
      return requestJson(`/api/receipts/${encodeURIComponent(receiptId)}`, { method: 'DELETE', headers: authHeaders() });
    },
    async fetchRequiredConsents() {
      const body = await requestJson('/api/compliance/consent/required', { headers: authHeaders() });
      return body.required || [];
    },
    async fetchOptionalConsents() {
      const body = await requestJson('/api/compliance/consent/optional', { headers: authHeaders() });
      return body.optional || [];
    },
    async fetchConsentRecords() {
      const body = await requestJson('/api/compliance/consent', { headers: authHeaders() });
      return body.consents || [];
    },
    async submitConsent(consentInput) {
      const body = await requestJson('/api/compliance/consent', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ consent: consentInput }),
      });
      return body.consent;
    },
  };

  /* ------------------------------------------------------------- presentation */

  function setPill(el, text, tone) {
    el.textContent = text;
    el.className = `pill pill-${tone}`;
  }

  function setProgress(text) {
    els.progress.textContent = text;
    els.progress.className = text ? 'progress progress-active' : 'progress';
  }

  function setFileSummary(text, tone) {
    els.fileSummary.textContent = text;
    els.fileSummary.className = `file-summary${tone ? ` file-summary-${tone}` : ''}`;
  }

  function setConsentSummary(text) {
    els.consentSummary.textContent = text;
  }

  function describeError(error) {
    const code = error && error.code ? `${error.code}: ` : '';
    return `${code}${(error && error.message) || 'Something went wrong'}`;
  }

  /**
   * `options.retry` is the function "Try again" runs, chosen per failure so a
   * half-finished upload is never restarted from scratch. `options.discard`
   * shows the reclaim button for a receipt that is holding a monthly slot.
   *
   * The box takes focus: an alert that only appears in the corner of the
   * viewport is invisible to a screen-reader user who is somewhere else in the
   * form, and to anyone who never looks up from the field they were editing.
   * Whatever had focus is remembered, because hiding the box must not drop the
   * user back to the top of the document.
   */
  function showError(message, options) {
    const { retry = null, discard = false } = options || {};
    state.retryAction = typeof retry === 'function' ? retry : null;
    els.errorMessage.textContent = message;
    els.errorBox.hidden = false;
    els.retryButton.hidden = !state.retryAction;
    els.discardButton.hidden = !discard;
    if (document.activeElement !== els.errorBox) {
      state.errorReturnFocus = document.activeElement;
      els.errorBox.focus();
    }
  }

  function hideError() {
    const focusInside = els.errorBox.contains(document.activeElement);
    els.errorBox.hidden = true;
    els.retryButton.hidden = true;
    els.discardButton.hidden = true;
    state.retryAction = null;
    if (focusInside) {
      const target = state.errorReturnFocus && els.form.contains(state.errorReturnFocus)
        ? state.errorReturnFocus
        : els.captureButton;
      target.focus();
    }
    state.errorReturnFocus = null;
  }

  function selectedFile() {
    return els.image.files && els.image.files[0] ? els.image.files[0] : null;
  }

  function updateCaptureAvailability() {
    const file = selectedFile();
    const fileProblem = format.validationMessage(file, state.limits);
    const missing = missingConsents();
    const reason = format.blockingReason({ fileProblem, missingConsents: missing });
    // Each field states its own blocker. Parking a consent problem in the file
    // summary — under a different field, three rows down — is how a user ends
    // up hunting for a message that belongs to the box above it. A live region
    // is also why the "no file yet" case stays silent until something was
    // actually rejected: an empty form is not an error worth announcing.
    setFileSummary(file ? fileProblem || format.formatFileSummary(file) : '', fileProblem ? 'bad' : 'idle');
    setConsentSummary(reason && reason.field === 'consent' ? reason.message : '');
    // aria-disabled, not disabled: a real disabled attribute drops the button
    // out of the tab order, so a keyboard user never reaches the control that
    // could tell them what is missing.
    els.captureButton.setAttribute('aria-disabled', String(state.busy || Boolean(reason)));
    els.captureButton.textContent = state.busy ? 'Capturing…' : 'Capture receipt';
    return reason;
  }

  /* ------------------------------------------------------------ pending memory */

  function pendingKey() {
    return `${PENDING_KEY}:${els.userId.value.trim()}`;
  }

  function rememberPending(receiptId, stage) {
    try {
      sessionStorage.setItem(pendingKey(), JSON.stringify({ receiptId, stage }));
    } catch (error) {
      /* private mode: the resume banner is a nicety, never a requirement */
    }
  }

  function recallPending() {
    try {
      const raw = sessionStorage.getItem(pendingKey());
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.receiptId === 'string') return parsed;
    } catch (error) {
      return null;
    }
    return null;
  }

  function forgetPending() {
    try {
      sessionStorage.removeItem(pendingKey());
    } catch (error) {
      /* ignore */
    }
  }

  /**
   * A pending receipt that the server no longer has (404) or has already
   * completed (409) is not an error to retry: the reminder is simply stale, so
   * it is dropped and the page re-read from the server.
   */
  function isStalePending(error) {
    return Boolean(error) && (error.code === 'RECEIPT_NOT_FOUND' || error.code === 'UPLOAD_NOT_PENDING');
  }

  function renderResume(pending) {
    if (!pending) {
      els.resumeBanner.hidden = true;
      return;
    }
    els.resumeBanner.hidden = false;
    els.resumeMessage.textContent =
      pending.stage === 'uploaded'
        ? `Receipt ${pending.receiptId} was uploaded but never confirmed.`
        : `Receipt ${pending.receiptId} is reserved but its photo never arrived.`;
    els.resumeConfirm.hidden = pending.stage !== 'uploaded';
    els.resumeDiscard.hidden = false;
  }

  async function resumeFromBanner(pending) {
    // The reserved stage is a reclaim, and discardPending owns that whole path
    // (busy flag, progress, error, refresh) — delegating keeps one owner.
    if (pending.stage !== 'uploaded') {
      await discardPending(pending.receiptId);
      return;
    }
    if (state.busy) return;
    state.busy = true;
    updateCaptureAvailability();
    setProgress('Finishing the earlier upload…');
    try {
      const receipt = await api.confirm(pending.receiptId);
      forgetPending();
      renderResume(null);
      hideError();
      setProgress(`${receipt.receiptId} is now ${format.statusLabel(receipt.status).toLowerCase()}.`);
    } catch (error) {
      if (isStalePending(error)) {
        forgetPending();
        renderResume(null);
        showError(`${describeError(error)} — the reminder has been cleared.`, {});
        setProgress('');
      } else {
        showError(describeError(error), { retry: () => resumeFromBanner(pending) });
      }
    } finally {
      state.busy = false;
      updateCaptureAvailability();
      await Promise.all([refreshReceipts(), refreshUsage()]);
    }
  }

  /* ---------------------------------------------------------------- consent UI */

  /** Render a single consent checkbox item. */
  function createConsentElement(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'consent-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `consent_${item.type}`;
    checkbox.name = `consent_${item.type}`;
    checkbox.value = 'on';
    // Required consents must be checked; optional can be unchecked.
    if (item.required) checkbox.required = true;

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = item.label;

    const versionBadge = document.createElement('span');
    versionBadge.className = 'consent-version';
    versionBadge.textContent = `v${item.version}`;

    const description = document.createElement('span');
    description.className = 'consent-description';
    description.textContent = item.description;

    if (item.required) {
      const requiredBadge = document.createElement('span');
      requiredBadge.className = 'consent-required-badge';
      requiredBadge.textContent = 'Required';
      label.appendChild(requiredBadge);
    }

    label.appendChild(versionBadge);
    label.appendChild(description);
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    return wrapper;
  }

  /** Render all consent checkboxes into the fieldsets. */
  function renderConsents() {
    const { required, optional } = format.splitConsents(state.requiredConsents, state.optionalConsents);
    els.requiredConsents.replaceChildren();
    els.optionalConsents.replaceChildren();

    required.forEach((item) => {
      els.requiredConsents.appendChild(createConsentElement(item));
    });
    optional.forEach((item) => {
      els.optionalConsents.appendChild(createConsentElement(item));
    });

    // Show fieldsets only if there are items
    els.consentFieldset.hidden = required.length === 0;
    els.optionalConsentFieldset.hidden = optional.length === 0;
  }

  /** The required consents the user has not ticked, in the order they are shown. */
  function missingConsents() {
    const granted = [];
    state.requiredConsents.forEach((consent) => {
      const checkbox = document.getElementById(`consent_${consent.type}`);
      if (checkbox && checkbox.checked) granted.push(consent.type);
    });
    return format.missingRequiredConsents(state.requiredConsents, granted);
  }

  /**
   * Move focus to the control that has to change. Announces nothing itself: the
   * per-field status regions already carry the text, and the focused checkbox
   * reads out its own label.
   */
  function focusBlocking(reason) {
    if (!reason) return;
    if (reason.field === 'consent') {
      const first = missingConsents()[0];
      const target = first && document.getElementById(`consent_${first.type}`);
      (target || els.consentFieldset).focus();
      return;
    }
    els.dropZone.focus();
  }

  /**
   * One owner for "the capture cannot run": each message goes to the field it
   * belongs to, and focus lands on the control that has to change. An empty
   * form is not an error, so a missing file is only reported once the user has
   * asked for the capture.
   */
  function showBlockingReason(reason) {
    if (!reason) return;
    const file = selectedFile();
    const fileProblem = format.validationMessage(file, state.limits);
    setFileSummary(
      file ? fileProblem || format.formatFileSummary(file) : reason.field === 'image' ? reason.message : '',
      fileProblem ? 'bad' : 'idle'
    );
    setConsentSummary(reason.field === 'consent' ? reason.message : '');
    focusBlocking(reason);
  }

  /* ------------------------------------------------------------------ records */

  function receiptRows() {
    return format.filterReceipts(format.sortNewestFirst(state.receipts), {
      query: els.searchInput.value,
      status: els.statusFilter.value,
    });
  }

  /**
   * The table is rebuilt from scratch on every refresh, which destroys whatever
   * row control the user was standing on. Remember it by receipt id and action
   * so the rebuilt DOM can hand focus back; without this, tabbing through the
   * list after a refresh drops the user back to the top of the document.
   */
  function focusedRowControl() {
    const active = document.activeElement;
    if (!active || !els.tableBody.contains(active)) return null;
    const receiptId = active.getAttribute('data-receipt-id');
    const action = active.getAttribute('data-action');
    return receiptId && action ? { receiptId, action } : null;
  }

  function restoreRowControlFocus(remembered) {
    if (!remembered) return;
    // Matched by attribute value, never by interpolating the id into a
    // selector: an id with a quote or a bracket in it would throw a SyntaxError
    // out of renderRows and take the whole list down with it.
    const rebuilt = Array.prototype.find.call(
      els.tableBody.querySelectorAll('button[data-action]'),
      (button) => button.getAttribute('data-receipt-id') === remembered.receiptId && button.getAttribute('data-action') === remembered.action
    );
    if (rebuilt) {
      rebuilt.focus();
      return;
    }
    // The row is gone — a discard, or a filter change. Park focus on the summary
    // above the table rather than on <body>, where the next Tab starts from the
    // top of the page.
    els.listResult.focus();
  }

  function renderRows() {
    const remembered = focusedRowControl();
    const rows = receiptRows();
    els.tableBody.replaceChildren();

    if (state.receipts.length === 0) {
      els.tableBody.appendChild(emptyRow('No receipts yet — capture one above.', 5));
    } else if (rows.length === 0) {
      els.tableBody.appendChild(emptyRow('No receipts match the current filters.', 5));
    } else {
      rows.forEach((receipt) => els.tableBody.appendChild(receiptRow(receipt)));
    }

    els.listResult.textContent = format.listSummary({ total: state.count, shown: rows.length, limit: state.limit });
    els.listResult.className = 'result ok';
    restoreRowControlFocus(remembered);
  }

  function emptyRow(message, span) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = span;
    cell.className = 'empty-cell';
    cell.textContent = message;
    row.appendChild(cell);
    return row;
  }

  function receiptRow(receipt) {
    const row = document.createElement('tr');
    if (receipt.receiptId === state.selectedId) {
      row.classList.add('selected');
      // aria-current is the honest way to say "this is the one you opened" in a
      // plain table; the background tint alone is invisible to a screen reader.
      row.setAttribute('aria-current', 'true');
    }

    const merchant = document.createElement('td');
    const merchantName = format.receiptMerchant(receipt);
    merchant.textContent = merchantName || 'Not extracted yet';
    if (!merchantName) merchant.className = 'muted-cell';
    merchant.title = receipt.receiptId;

    const total = document.createElement('td');
    const amount = format.receiptTotal(receipt);
    total.className = 'amount-cell';
    total.textContent = amount === null ? '—' : `${format.formatAmount(amount)} ${format.formatCurrency(receipt)}`;

    const captured = document.createElement('td');
    captured.textContent = format.formatDateTime(receipt.createdAt, state.timeZone);

    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-${format.statusTone(receipt.status)}`;
    badge.textContent = format.statusLabel(receipt.status);
    status.appendChild(badge);

    // The row stays a real table row for screen readers; the buttons are the
    // accessible controls, and the click handler is the mouse convenience.
    const action = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const open = rowControl('view', receipt.receiptId);
    actions.appendChild(open);
    if (receipt.status === 'pending') {
      actions.appendChild(rowControl('discard', receipt.receiptId));
    }
    action.appendChild(actions);

    [merchant, total, captured, status, action].forEach((cell) => row.appendChild(cell));
    row.addEventListener('click', (event) => {
      // Buttons own their own clicks; everything else in the row selects.
      if (event.target.closest('button')) return;
      selectReceipt(receipt.receiptId);
    });
    return row;
  }

  /**
   * A reserved receipt with no photo is a wasted monthly slot, so both the list
   * row and the detail panel offer the reclaim. The copy that points users here
   * has to be actionable, and every control is named after the receipt it acts
   * on — five buttons all called "View" is unusable by keyboard alone.
   */
  function rowControl(action, receiptId, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button-ghost row-action';
    button.textContent = label || format.actionText(action);
    button.setAttribute('aria-label', format.actionLabel(action, receiptId));
    button.setAttribute('data-action', action);
    button.setAttribute('data-receipt-id', receiptId);
    button.addEventListener('click', () => (action === 'discard' ? discardPending(receiptId) : selectReceipt(receiptId)));
    return button;
  }

  function definition(label, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'definition';
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    wrapper.appendChild(term);
    wrapper.appendChild(detail);
    return wrapper;
  }

  function renderDetail(receipt) {
    els.detailBody.replaceChildren();
    // The panel sits below the fold of a long list, so the announcement is what
    // confirms the row control did anything at all.
    els.detailAnnouncement.textContent = receipt ? format.detailAnnouncement(receipt) : '';
    if (!receipt) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = state.selectedId
        ? 'That receipt is no longer available — it may have been discarded.'
        : 'Select a row above to see the extracted expense record.';
      els.detailBody.appendChild(hint);
      return;
    }

    const heading = document.createElement('div');
    heading.className = 'detail-heading';
    const title = document.createElement('h3');
    title.textContent = format.receiptMerchant(receipt) || 'Merchant not extracted yet';
    const badge = document.createElement('span');
    badge.className = `badge badge-${format.statusTone(receipt.status)}`;
    badge.textContent = format.statusLabel(receipt.status);
    heading.appendChild(title);
    heading.appendChild(badge);

    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent =
      receipt.status === 'pending'
        ? 'The photo never arrived. Discard it from the list so the monthly slot is released.'
        : receipt.status === 'processing'
          ? 'The photo is stored. Line items, merchant and totals appear here once the extraction pipeline lands.'
          : 'Extracted from the stored photo.';

    const dl = document.createElement('dl');
    dl.className = 'definitions';
    const total = format.receiptTotal(receipt);
    dl.appendChild(definition('Receipt id', receipt.receiptId));
    dl.appendChild(definition('Transaction date', receipt.metadata.transactionDate || '—'));
    dl.appendChild(definition('Total', total === null ? '—' : `${format.formatAmount(total)} ${format.formatCurrency(receipt)}`));
    dl.appendChild(definition('Subtotal', format.formatAmount(receipt.metadata.subtotal)));
    dl.appendChild(definition('Tax', format.formatAmount(receipt.metadata.tax)));
    dl.appendChild(definition('Captured', format.formatDateTime(receipt.createdAt, state.timeZone)));
    dl.appendChild(
      definition(
        'Categories',
        receipt.categories && receipt.categories.length
          ? receipt.categories.map((category) => category.name).join(', ')
          : 'Not categorised yet'
      )
    );
    dl.appendChild(
      definition(
        'Images',
        receipt.images && receipt.images.length
          ? receipt.images
              .map((image) => `${format.formatBytes(image.size)} ${image.contentType} · ${image.s3Key}`)
              .join(' · ')
          : 'None stored'
      )
    );

    els.detailBody.appendChild(heading);
    els.detailBody.appendChild(notice);
    els.detailBody.appendChild(dl);

    if (receipt.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'detail-actions';
      const discard = rowControl('discard', receipt.receiptId, 'Discard pending receipt');
      // ghost + danger, not button-danger: `.row-action` sets the accent colour
      // and would leave blue text on a red fill (2.4:1) on the control whose job
      // is to be unmistakable.
      discard.classList.add('danger');
      actions.appendChild(discard);
      els.detailBody.appendChild(actions);
    }

    const items = Array.isArray(receipt.lineItems) ? receipt.lineItems : [];
    if (items.length > 0) {
      els.detailBody.appendChild(lineItemTable(items, format.formatCurrency(receipt)));
    }
  }

  function lineItemTable(items, currency) {
    const wrapper = document.createElement('div');
    const caption = document.createElement('h4');
    caption.textContent = 'Line items';
    const table = document.createElement('table');
    table.className = 'line-items';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Description', 'Qty', 'Unit', `Total (${currency})`].forEach((label) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);

    const body = document.createElement('tbody');
    items.forEach((item) => {
      const row = document.createElement('tr');
      [item.description, String(item.quantity), format.formatAmount(item.unitPrice), format.formatAmount(item.total)].forEach(
        (value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        }
      );
      body.appendChild(row);
    });

    table.appendChild(head);
    table.appendChild(body);
    wrapper.appendChild(caption);
    wrapper.appendChild(table);
    return wrapper;
  }

  async function selectReceipt(receiptId) {
    state.selectedId = receiptId;
    renderRows();
    renderDetail(null);
    try {
      state.detail = await api.getReceipt(receiptId);
      renderDetail(state.detail);
    } catch (error) {
      state.detail = null;
      renderDetail(null);
      showError(describeError(error), {});
    }
  }

  /* ------------------------------------------------------------------ loaders */

  async function refreshHealth() {
    try {
      const body = await api.health();
      setPill(els.health, `health: ${body.status}`, 'ok');
    } catch (error) {
      setPill(els.health, `health unreachable (${describeError(error)})`, 'bad');
    }
  }

  async function refreshUsage() {
    try {
      const usage = await api.usage();
      // Quota, not a cap: it must not overwrite the limits from /api/config.
      state.remaining = usage.remaining;
      setPill(els.usage, format.usageLabel(usage), format.usageTone(usage));
    } catch (error) {
      state.remaining = null;
      setPill(els.usage, `usage unavailable (${describeError(error)})`, 'bad');
    }
    updateCaptureAvailability();
  }

  async function refreshReceipts() {
    const params = new URLSearchParams();
    if (els.statusFilter.value) params.set('status', els.statusFilter.value);
    try {
      const body = await api.list(params);
      state.receipts = body.receipts || [];
      // count is the server's full match count, which can exceed the page.
      state.count = typeof body.count === 'number' ? body.count : state.receipts.length;
      state.limit = typeof body.limit === 'number' ? body.limit : null;
      renderRows();
      if (state.selectedId) {
        const stillThere = state.receipts.some((receipt) => receipt.receiptId === state.selectedId);
        if (!stillThere) {
          state.selectedId = null;
          state.detail = null;
          renderDetail(null);
        } else {
          renderDetail(state.detail);
        }
      }
    } catch (error) {
      state.receipts = [];
      state.count = 0;
      state.limit = null;
      renderRows();
      els.listResult.textContent = describeError(error);
      els.listResult.className = 'result bad';
    }
  }

  async function refreshConfig() {
    try {
      const features = await api.config();
      state.limits = {
        maxImageBytes: features.maxImageBytes || DEFAULT_LIMITS.maxImageBytes,
        maxReceiptsPerMonth: features.maxReceiptsPerMonth || DEFAULT_LIMITS.maxReceiptsPerMonth,
      };
      els.dropZone.querySelector('.drop-sub').textContent =
        `JPEG, PNG, WebP or HEIC · up to ${format.formatBytes(state.limits.maxImageBytes)}`;
    } catch (error) {
      /* keep the static defaults in the markup */
    }
    updateCaptureAvailability();
  }

  /** Load and render consent checkboxes for the current user. */
  async function loadConsents() {
    try {
      const [required, optional, records] = await Promise.all([
        api.fetchRequiredConsents(),
        api.fetchOptionalConsents(),
        api.fetchConsentRecords(),
      ]);
      state.requiredConsents = required;
      state.optionalConsents = optional;
      state.consentRecords = records;
      state.consentsLoaded = true;
      renderConsents();
      updateCaptureAvailability();
    } catch (error) {
      state.consentsLoaded = false;
      /* Consent load failure is non-blocking; the server will enforce on submit. */
    }
  }

  /* ----------------------------------------------------------------- handlers */

  async function runCapture() {
    const file = selectedFile();
    const fileProblem = format.validationMessage(file, state.limits);
    const missing = missingConsents();
    const reason = format.blockingReason({ fileProblem, missingConsents: missing });
    if (reason) {
      showBlockingReason(reason);
      return;
    }

    // Collect consent choices from the form
    const formData = new FormData(els.form);
    const consentPayload = format.buildConsentPayload(state.requiredConsents, state.optionalConsents, formData);

    // Submit any consents that have changed (granted or denied)
    const consentsToSubmit = consentPayload.filter((consent) => consent.status !== 'denied' || state.consentRecords.some((r) => r.consentType === consent.consentType && r.status === 'granted'));
    for (const consent of consentsToSubmit) {
      try {
        await api.submitConsent(consent);
      } catch (error) {
        // If consent submission fails, show error and abort capture
        showError(`Failed to record consent: ${describeError(error)}`, { retry: runCapture });
        return;
      }
    }

    // Refresh consent records after submission
    try {
      state.consentRecords = await api.fetchConsentRecords();
    } catch (error) {
      /* non-blocking */
    }

    state.busy = true;
    hideError();
    setProgress('Reserving…');
    updateCaptureAvailability();

    try {
      const receipt = await flow.captureReceiptOnce(api, file, (event) => setProgress(STEP_TEXT[event.step] || ''));
      forgetPending();
      state.discardableId = null;
      setProgress(
        `${receipt.receiptId} captured — ${format.statusLabel(receipt.status).toLowerCase()}. ` +
          'Line items and totals appear once extraction lands.'
      );
      els.image.value = '';
      setFileSummary('', 'idle');
      state.selectedId = receipt.receiptId;
      state.detail = receipt;
      renderDetail(receipt);
      renderRows();
    } catch (error) {
      const options = {};
      const recovery = flow.recoveryFor(error);
      if (recovery.action === 'confirm') {
        // Bytes are already in the bucket: repeat the confirm, never a re-upload.
        rememberPending(recovery.receiptId, 'uploaded');
        renderResume(recallPending());
        options.retry = () => resumeFromBanner({ receiptId: recovery.receiptId, stage: 'uploaded' });
      } else if (recovery.action === 'discard') {
        // Remembered too, so the reclaim survives hiding the error box and
        // reloading — a failed upload must never leave a monthly slot stranded.
        rememberPending(recovery.receiptId, 'reserved');
        renderResume(recallPending());
        state.discardableId = recovery.receiptId;
        options.discard = true;
        options.retry = () => discardPending(recovery.receiptId);
      } else {
        options.retry = () => runCapture();
      }
      setProgress('');
      showError(describeError(error), options);
    } finally {
      state.busy = false;
      updateCaptureAvailability();
      await Promise.all([refreshReceipts(), refreshUsage()]);
    }
  }

  async function discardPending(receiptId) {
    if (!receiptId || state.busy) return;
    state.busy = true;
    updateCaptureAvailability();
    try {
      await api.discard(receiptId);
      forgetPending();
      state.discardableId = null;
      renderResume(null);
      hideError();
      setProgress(`Discarded ${receiptId} — its monthly slot is free again.`);
      if (state.selectedId === receiptId) {
        state.selectedId = null;
        state.detail = null;
        renderDetail(null);
      }
    } catch (error) {
      if (isStalePending(error)) {
        // Nothing to reclaim: the receipt is gone or already stored.
        forgetPending();
        state.discardableId = null;
        renderResume(null);
        showError(`${describeError(error)} — nothing left to discard.`, {});
        setProgress('');
      } else {
        // Retry repeats the discard, not a fresh capture.
        showError(describeError(error), { retry: () => discardPending(receiptId) });
      }
    } finally {
      state.busy = false;
      updateCaptureAvailability();
      await Promise.all([refreshReceipts(), refreshUsage()]);
    }
  }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.busy) runCapture();
  });

  els.image.addEventListener('change', () => {
    hideError();
    updateCaptureAvailability();
  });

  els.dropZone.addEventListener('click', () => els.image.click());
  els.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.image.click();
    }
  });
  els.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragging');
  });
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragging'));
  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragging');
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    els.image.files = transfer.files;
    hideError();
    updateCaptureAvailability();
  });

  els.retryButton.addEventListener('click', () => {
    // Read the action before clearing the box that owns it.
    const retry = state.retryAction;
    hideError();
    if (retry) retry();
  });

  els.discardButton.addEventListener('click', () => {
    const pending = recallPending();
    discardPending((pending && pending.receiptId) || state.discardableId);
  });

  els.dismissError.addEventListener('click', hideError);

  els.resumeConfirm.addEventListener('click', () => {
    const pending = recallPending();
    if (pending) resumeFromBanner(pending);
  });

  els.resumeDiscard.addEventListener('click', () => {
    const pending = recallPending();
    if (pending) discardPending(pending.receiptId);
  });

  els.resumeDismiss.addEventListener('click', () => {
    forgetPending();
    renderResume(null);
  });

  els.refreshButton.addEventListener('click', () => {
    if (state.busy) return;
    // Usage too: a discard elsewhere frees a slot, and Refresh is where a user
    // goes to see current numbers.
    Promise.all([refreshReceipts(), refreshUsage()]);
  });

  els.statusFilter.addEventListener('change', () => {
    state.selectedId = null;
    state.detail = null;
    renderDetail(null);
    refreshReceipts();
  });

  els.searchInput.addEventListener('input', renderRows);

  // Ticking a consent is the only way the user can satisfy the consent gate, so
  // it has to re-evaluate the capture button. Without this the button stays
  // unavailable until something else changes, and the form looks broken.
  [els.requiredConsents, els.optionalConsents].forEach((list) => {
    list.addEventListener('change', updateCaptureAvailability);
  });

  // Switching identity must not leave the previous user's records on screen.
  els.userId.addEventListener('change', () => {
    state.selectedId = null;
    state.detail = null;
    state.discardableId = null;
    state.requiredConsents = [];
    state.optionalConsents = [];
    state.consentRecords = [];
    state.consentsLoaded = false;
    hideError();
    setProgress('');
    renderDetail(null);
    renderResume(recallPending());
    renderConsents();
    Promise.all([refreshReceipts(), refreshUsage(), loadConsents()]);
  });

  /* -------------------------------------------------------------------- boot */

  function boot() {
    try {
      state.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (error) {
      state.timeZone = 'UTC';
    }
    els.image.accept = format.ACCEPT_ATTRIBUTE;
    renderRows();
    renderDetail(null);
    renderResume(recallPending());
    refreshHealth();
    refreshConfig();
    loadConsents();
    Promise.all([refreshUsage(), refreshReceipts()]);
  }

  boot();
})();
