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
    // The reserved receipt the error box's "Discard" button reclaims. Held in
    // memory too, so the affordance survives when sessionStorage is blocked.
    discardableId: null,
    timeZone: 'UTC',
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

  function describeError(error) {
    const code = error && error.code ? `${error.code}: ` : '';
    return `${code}${(error && error.message) || 'Something went wrong'}`;
  }

  /**
   * `options.retry` is the function "Try again" runs, chosen per failure so a
   * half-finished upload is never restarted from scratch. `options.discard`
   * shows the reclaim button for a receipt that is holding a monthly slot.
   */
  function showError(message, options) {
    const { retry = null, discard = false } = options || {};
    state.retryAction = typeof retry === 'function' ? retry : null;
    els.errorMessage.textContent = message;
    els.errorBox.hidden = false;
    els.retryButton.hidden = !state.retryAction;
    els.discardButton.hidden = !discard;
  }

  function hideError() {
    els.errorBox.hidden = true;
    els.retryButton.hidden = true;
    els.discardButton.hidden = true;
    state.retryAction = null;
  }

  function selectedFile() {
    return els.image.files && els.image.files[0] ? els.image.files[0] : null;
  }

  function updateCaptureAvailability() {
    const file = selectedFile();
    const problem = format.validationMessage(file, state.limits);
    // Say why the button is dead instead of only greying it out.
    setFileSummary(problem || (file ? format.formatFileSummary(file) : ''), problem ? 'bad' : 'idle');
    els.captureButton.disabled = state.busy || Boolean(problem);
    els.captureButton.textContent = state.busy ? 'Capturing…' : 'Capture receipt';
    return problem;
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

  /* ------------------------------------------------------------------ records */

  function receiptRows() {
    return format.filterReceipts(format.sortNewestFirst(state.receipts), {
      query: els.searchInput.value,
      status: els.statusFilter.value,
    });
  }

  function renderRows() {
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
    if (receipt.receiptId === state.selectedId) row.classList.add('selected');

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
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button-ghost row-action';
    open.textContent = 'View';
    open.setAttribute('aria-label', `View receipt ${receipt.receiptId}`);
    open.addEventListener('click', () => selectReceipt(receipt.receiptId));
    actions.appendChild(open);
    if (receipt.status === 'pending') {
      actions.appendChild(discardControl(receipt.receiptId));
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
   * has to be actionable.
   */
  function discardControl(receiptId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button-ghost row-action danger';
    button.textContent = 'Discard';
    button.setAttribute('aria-label', `Discard pending receipt ${receiptId}`);
    button.addEventListener('click', () => discardPending(receiptId));
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
      const discard = discardControl(receipt.receiptId);
      discard.classList.add('button-danger');
      discard.textContent = 'Discard pending receipt';
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

  /* ----------------------------------------------------------------- handlers */

  async function runCapture() {
    const file = selectedFile();
    const problem = format.validationMessage(file, state.limits);
    if (problem) {
      setFileSummary(problem, 'bad');
      return;
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

  // Switching identity must not leave the previous user's records on screen.
  els.userId.addEventListener('change', () => {
    state.selectedId = null;
    state.detail = null;
    state.discardableId = null;
    hideError();
    setProgress('');
    renderDetail(null);
    renderResume(recallPending());
    Promise.all([refreshReceipts(), refreshUsage()]);
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
    Promise.all([refreshUsage(), refreshReceipts()]);
  }

  boot();
})();
