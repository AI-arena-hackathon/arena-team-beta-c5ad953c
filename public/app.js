'use strict';

const els = {
  userId: document.getElementById('user-id'),
  image: document.getElementById('receipt-image'),
  captureForm: document.getElementById('capture-form'),
  captureButton: document.getElementById('capture-button'),
  captureResult: document.getElementById('capture-result'),
  completeButton: document.getElementById('complete-button'),
  completeResult: document.getElementById('complete-result'),
  health: document.getElementById('health'),
  usage: document.getElementById('usage'),
  statusFilter: document.getElementById('status-filter'),
  refreshButton: document.getElementById('refresh-button'),
  listResult: document.getElementById('list-result'),
  tableBody: document.querySelector('#receipts tbody'),
};

let pendingReceiptId = null;

function headers() {
  return { 'Content-Type': 'application/json', 'x-user-id': els.userId.value.trim() };
}

function setPill(el, text, kind) {
  el.textContent = text;
  el.className = `pill pill-${kind}`;
}

function describeError(error) {
  if (error && error.code) return `${error.code}: ${error.message}`;
  return String(error && error.message ? error.message : error);
}

async function refreshHealth() {
  try {
    const response = await fetch('/health');
    const body = await response.json();
    setPill(els.health, `health: ${body.status}`, 'ok');
  } catch (error) {
    setPill(els.health, `health unreachable (${describeError(error)})`, 'bad');
  }
}

async function refreshUsage() {
  try {
    const response = await fetch('/api/usage', { headers: headers() });
    const body = await response.json();
    if (!response.ok) throw body.error || new Error('usage failed');
    const { used, limit, remaining } = body.usage;
    setPill(els.usage, `free tier: ${used}/${limit} used · ${remaining} left`, remaining === 0 ? 'bad' : 'ok');
  } catch (error) {
    setPill(els.usage, `usage unavailable (${describeError(error)})`, 'bad');
  }
}

async function refreshReceipts() {
  const params = new URLSearchParams();
  if (els.statusFilter.value) params.set('status', els.statusFilter.value);
  const query = params.toString();
  try {
    const response = await fetch(`/api/receipts${query ? `?${query}` : ''}`, { headers: headers() });
    const body = await response.json();
    if (!response.ok) throw body.error || new Error('list failed');
    renderRows(body.receipts || []);
    els.listResult.textContent = `${body.count} receipt(s) on file`;
    els.listResult.className = 'result ok';
  } catch (error) {
    els.tableBody.innerHTML = '';
    els.listResult.textContent = describeError(error);
    els.listResult.className = 'result bad';
  }
}

function renderRows(receipts) {
  els.tableBody.innerHTML = '';
  if (receipts.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No receipts yet — capture one above.';
    row.appendChild(cell);
    els.tableBody.appendChild(row);
    return;
  }
  receipts.forEach((receipt) => {
    const row = document.createElement('tr');
    [
      receipt.receiptId,
      receipt.status,
      String((receipt.images || []).length),
      receipt.createdAt,
    ].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    els.tableBody.appendChild(row);
  });
}

/**
 * Step 2 of the capture flow. With UPLOAD_SIGNER=memory the signed URL points at
 * this app, so the browser performs the PUT; with UPLOAD_SIGNER=s3 it points at
 * S3 and the same code sends the bytes straight there.
 */
async function uploadImage(upload, file) {
  const target = upload.uploadUrl.startsWith('/') ? upload.uploadUrl : new URL(upload.uploadUrl).pathname;
  const response = await fetch(target, {
    method: upload.method || 'PUT',
    headers: { ...upload.headers, 'x-user-id': els.userId.value.trim() },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw (body && body.error) || new Error(`upload failed (${response.status})`);
  return body;
}

els.captureForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = els.image.files && els.image.files[0];
  if (!file) {
    els.captureResult.textContent = 'Choose a receipt photo first.';
    els.captureResult.className = 'result bad';
    return;
  }
  els.captureButton.disabled = true;
  try {
    const response = await fetch('/api/receipts', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        image: {
          fileName: file.name,
          contentType: file.type || 'image/jpeg',
          size: file.size,
        },
      }),
    });
    const body = await response.json();
    if (!response.ok) throw body.error || new Error('capture failed');
    pendingReceiptId = body.receipt.receiptId;
    els.completeButton.disabled = false;
    const uploaded = await uploadImage(body.upload, file);
    els.captureResult.textContent =
      `Reserved ${body.receipt.receiptId} (status ${body.receipt.status}) and uploaded ` +
      `${uploaded.size} bytes to ${body.upload.key}.`;
    els.captureResult.className = 'result ok';
  } catch (error) {
    els.captureResult.textContent = describeError(error);
    els.captureResult.className = 'result bad';
  } finally {
    els.captureButton.disabled = false;
    await Promise.all([refreshReceipts(), refreshUsage()]);
  }
});

els.completeButton.addEventListener('click', async () => {
  if (!pendingReceiptId) return;
  try {
    const response = await fetch(`/api/receipts/${encodeURIComponent(pendingReceiptId)}/complete`, {
      method: 'POST',
      headers: headers(),
    });
    const body = await response.json();
    if (!response.ok) throw body.error || new Error('confirm failed');
    els.completeResult.textContent = `${body.receipt.receiptId} is now ${body.receipt.status} — OCR pipeline queued.`;
    els.completeResult.className = 'result ok';
  } catch (error) {
    els.completeResult.textContent = describeError(error);
    els.completeResult.className = 'result bad';
  } finally {
    await refreshReceipts();
  }
});

els.refreshButton.addEventListener('click', () => {
  refreshReceipts();
});
els.statusFilter.addEventListener('change', () => {
  refreshReceipts();
});

refreshHealth();
refreshUsage();
refreshReceipts();
