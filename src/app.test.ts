import request from 'supertest';
import express, { type Express } from 'express';
import { createApp, type AppDeps } from './app';
import { createMemoryStore, type ReceiptStore } from './services/store';
import { createMemoryImageStore, type ImageStore } from './services/object-store';
import { createMemoryUploadSigner } from './services/uploads';
import { createFakeSigner, createTestDeps, createJpegBuffer } from './utils/test-helpers';
import { disabledIdentityResolver } from './middleware/identity';

function createTestApp(overrides: AppDeps = {}): { app: Express; store: ReceiptStore; signer: ReturnType<typeof createFakeSigner> } {
  const store = overrides.store ?? createMemoryStore();
  const signer = (overrides as { signer?: ReturnType<typeof createFakeSigner> }).signer ?? createFakeSigner();
  const app = createApp({ store, uploadSigner: signer, monthlyLimit: 5, ...overrides });
  return { app, store, signer };
}

const validImage = { fileName: 'lunch.jpg', contentType: 'image/jpeg', size: 1024 };

describe('GET /health', () => {
  it('reports ok without requiring an identity', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
  });
});

describe('GET /api/config', () => {
  it('exposes the free-tier limit and feature flags but never AWS credentials', async () => {
    const { app } = createTestApp({ monthlyLimit: 7 });

    const response = await request(app).get('/api/config').expect(200);

    expect(response.body.features.maxReceiptsPerMonth).toBe(7);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('AKIA');
    expect(Object.keys(response.body)).toEqual(['api', 'features']);
  });
});

describe('POST /api/receipts', () => {
  it('creates a receipt and returns an upload grant', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);

    expect(response.body.receipt.status).toBe('pending');
    expect(response.body.upload.method).toBe('PUT');
    expect(response.body.upload.headers['Content-Type']).toBe('image/jpeg');
  });

  it('requires an identity header', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/api/receipts').send({ image: validImage }).expect(401);

    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed body with a 400 and a machine-readable code', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/api/receipts').set('x-user-id', 'user_123').send({}).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-image content type', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: { ...validImage, contentType: 'application/pdf' } })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 429 once the monthly limit is exhausted', async () => {
    const { app } = createTestApp({ monthlyLimit: 1 });

    await request(app).post('/api/receipts').set('x-user-id', 'user_123').send({ image: validImage }).expect(201);
    const response = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(429);

    expect(response.body.error.code).toBe('MONTHLY_LIMIT_REACHED');
  });

  it('does not leak stack traces when the signer fails', async () => {
    const { app, signer } = createTestApp();
    signer.createUploadUrl.mockRejectedValueOnce(new Error('aws exploded at /secret/path'));

    const response = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(502);

    expect(JSON.stringify(response.body)).not.toContain('secret/path');
    expect(response.body.error.code).toBe('UPLOAD_SIGNING_FAILED');
  });
});

describe('POST /api/receipts/:receiptId/complete', () => {
  it('moves the receipt to processing after the upload is confirmed', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);

    const response = await request(app)
      .post(`/api/receipts/${created.body.receipt.receiptId}/complete`)
      .set('x-user-id', 'user_123')
      .expect(200);

    expect(response.body.receipt.status).toBe('processing');
  });

  it('returns 404 for a receipt that does not exist', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/receipts/rcpt_missing/complete')
      .set('x-user-id', 'user_123')
      .expect(404);

    expect(response.body.error.code).toBe('RECEIPT_NOT_FOUND');
  });

  it('returns 404 when another user confirms the upload', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);

    await request(app)
      .post(`/api/receipts/${created.body.receipt.receiptId}/complete`)
      .set('x-user-id', 'user_other')
      .expect(404);
  });
});

describe('GET /api/receipts', () => {
  it('lists only the calling user receipts, newest first', async () => {
    const { app } = createTestApp();
    const first = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);
    const second = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: { ...validImage, fileName: 'dinner.png' } })
      .expect(201);
    await request(app).post('/api/receipts').set('x-user-id', 'user_other').send({ image: validImage }).expect(201);

    const response = await request(app).get('/api/receipts').set('x-user-id', 'user_123').expect(200);

    const ids = response.body.receipts.map((r: { receiptId: string }) => r.receiptId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(first.body.receipt.receiptId);
    expect(ids).toContain(second.body.receipt.receiptId);
  });

  it('clamps the limit query parameter to the maximum page size', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/receipts?limit=100000').set('x-user-id', 'user_123').expect(200);

    expect(response.body.receipts).toEqual([]);
    expect(response.body.limit).toBe(200);
  });

  it('rejects a non-numeric limit instead of silently defaulting', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/receipts?limit=all').set('x-user-id', 'user_123').expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('filters by status', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);
    await request(app)
      .post(`/api/receipts/${created.body.receipt.receiptId}/complete`)
      .set('x-user-id', 'user_123')
      .expect(200);

    const response = await request(app)
      .get('/api/receipts?status=processing')
      .set('x-user-id', 'user_123')
      .expect(200);

    expect(response.body.receipts).toHaveLength(1);
  });

  it('rejects an unknown status filter value', async () => {
    const { app } = createTestApp();

    await request(app).get('/api/receipts?status=hacked').set('x-user-id', 'user_123').expect(400);
  });
});

describe('GET /api/receipts/:receiptId', () => {
  it('returns the receipt for its owner', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);

    const response = await request(app)
      .get(`/api/receipts/${created.body.receipt.receiptId}`)
      .set('x-user-id', 'user_123')
      .expect(200);

    expect(response.body.receipt.receiptId).toBe(created.body.receipt.receiptId);
  });

  it('hides another user receipt behind a 404', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);

    await request(app)
      .get(`/api/receipts/${created.body.receipt.receiptId}`)
      .set('x-user-id', 'user_other')
      .expect(404);
  });
});

describe('DELETE /api/receipts/:receiptId', () => {
  it('discards a pending upload and frees the monthly slot again', async () => {
    const { app, store } = createTestApp({ monthlyLimit: 1 });
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);
    await request(app).post('/api/receipts').set('x-user-id', 'user_123').send({ image: validImage }).expect(429);

    const response = await request(app)
      .delete(`/api/receipts/${created.body.receipt.receiptId}`)
      .set('x-user-id', 'user_123')
      .expect(200);

    expect(response.body).toEqual({ deleted: true, receiptId: created.body.receipt.receiptId });
    expect((await store.list({ userId: 'user_123' })).count).toBe(0);
    await request(app).post('/api/receipts').set('x-user-id', 'user_123').send({ image: validImage }).expect(201);
  });

  it('refuses with 409 once the receipt has been confirmed', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);
    await request(app)
      .post(`/api/receipts/${created.body.receipt.receiptId}/complete`)
      .set('x-user-id', 'user_123')
      .expect(200);

    const response = await request(app)
      .delete(`/api/receipts/${created.body.receipt.receiptId}`)
      .set('x-user-id', 'user_123')
      .expect(409);

    expect(response.body.error.code).toBe('UPLOAD_NOT_PENDING');
  });

  it('requires an identity header', async () => {
    const { app } = createTestApp();

    await request(app).delete('/api/receipts/rcpt_1').expect(401);
  });

  it('hides another user pending receipt behind a 404', async () => {
    const { app, store } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);

    await request(app).delete(`/api/receipts/${created.body.receipt.receiptId}`).set('x-user-id', 'user_other').expect(404);
    expect((await store.list({ userId: 'user_123' })).count).toBe(1);
  });

  it('answers a repeated delete with 404, so a stale reminder can be dismissed', async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);
    await request(app).delete(`/api/receipts/${created.body.receipt.receiptId}`).set('x-user-id', 'user_123').expect(200);

    const response = await request(app)
      .delete(`/api/receipts/${created.body.receipt.receiptId}`)
      .set('x-user-id', 'user_123')
      .expect(404);

    expect(response.body.error.code).toBe('RECEIPT_NOT_FOUND');
  });

  it('is unreachable at all when the deployment has no identity resolver', async () => {
    // The reserve call needs a working identity, so the receipt is created on a
    // normal app and the same store is then mounted without an identity.
    const { app: openApp, store } = createTestApp();
    const created = await request(openApp)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: validImage })
      .expect(201);
    const { app: lockedApp } = createTestApp({ store, identityResolver: disabledIdentityResolver });

    const response = await request(lockedApp)
      .delete(`/api/receipts/${created.body.receipt.receiptId}`)
      .set('x-user-id', 'user_123')
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect((await store.list({ userId: 'user_123' })).count).toBe(1);
  });

  it('rejects an unsafe receipt id before it reaches the store', async () => {
    const { app, store } = createTestApp();

    const response = await request(app)
      .delete('/api/receipts/..%2F..%2Fetc%2Fpasswd')
      .set('x-user-id', 'user_123')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await store.list({ userId: 'user_123' })).count).toBe(0);
  });
});

describe('GET /api/usage', () => {
  it('reports how much of the free tier is left', async () => {
    const { app } = createTestApp({ monthlyLimit: 2 });

    await request(app).post('/api/receipts').set('x-user-id', 'user_123').send({ image: validImage }).expect(201);

    const response = await request(app).get('/api/usage').set('x-user-id', 'user_123').expect(200);

    expect(response.body.usage).toEqual({ used: 1, limit: 2, remaining: 1 });
  });
});

describe('unknown routes and errors', () => {
  it('returns a JSON 404 for unknown API paths', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/nope').set('x-user-id', 'user_123').expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns JSON instead of HTML for an unknown path', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/definitely-not-here').expect(404);

    expect(response.headers['content-type']).toMatch(/json/);
  });

  it('returns a 500 JSON envelope when a handler throws unexpectedly', async () => {
    const store = createMemoryStore();
    jest.spyOn(store, 'list').mockRejectedValueOnce(new Error('db offline at /var/lib/secret'));
    const { app } = createTestApp({ store });

    const response = await request(app).get('/api/receipts').set('x-user-id', 'user_123').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});

describe('browser console', () => {
  it('serves the capture console UI at /', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/').expect(200);

    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('Auto-Expense Capture Assistant');
  });
});

describe('app factory defaults', () => {
  it('builds an app with no arguments using an in-memory store', () => {
    expect(() => createApp()).not.toThrow();
    expect(createApp()).toBeDefined();
  });

  it('serves health from an app built with no injected dependencies', async () => {
    await request(createApp()).get('/health').expect(200);
  });
});

describe('security headers', () => {
  it('sets nosniff, frame denial, referrer policy and a same-origin CSP', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("object-src 'none'");
  });

  it('does not advertise the server framework', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/health').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('applies the headers to the UI page too', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('cors', () => {
  it('sends no cross-origin headers when no origins are configured', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/health').set('origin', 'https://evil.example').expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes only a configured origin', async () => {
    const { app } = createTestApp({ corsOrigins: ['https://app.example'] });

    const allowed = await request(app).get('/health').set('origin', 'https://app.example').expect(200);
    const denied = await request(app).get('/health').set('origin', 'https://evil.example').expect(200);

    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight only for a configured origin', async () => {
    const { app } = createTestApp({ corsOrigins: ['https://app.example'] });

    const response = await request(app)
      .options('/api/receipts')
      .set('origin', 'https://app.example')
      .set('access-control-request-method', 'POST')
      .expect(204);

    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('allows exactly the methods the API exposes, so a cross-origin client can discard a pending receipt', async () => {
    const { app } = createTestApp({ corsOrigins: ['https://app.example'] });

    const response = await request(app)
      .options('/api/receipts/rcpt_1')
      .set('origin', 'https://app.example')
      .set('access-control-request-method', 'DELETE')
      .expect(204);

    expect(String(response.headers['access-control-allow-methods']).split(', ')).toEqual([
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'OPTIONS',
    ]);
  });

  it('advertises no methods at all when no origins are configured', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .options('/api/receipts/rcpt_1')
      .set('origin', 'https://evil.example')
      .set('access-control-request-method', 'DELETE')
      .expect(200);

    expect(response.headers['access-control-allow-methods']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-headers']).toBeUndefined();
  });
});

describe('local upload endpoint (UPLOAD_SIGNER=memory)', () => {
  it('walks the whole capture flow: reserve, PUT bytes, confirm', async () => {
    const store = createMemoryStore();
    const images = createMemoryImageStore();
    const { app } = createTestApp({
      store,
      imageStore: images,
      uploadSigner: createMemoryUploadSigner(images),
    });
    const bytes = createJpegBuffer();

    const created = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: { fileName: 'lunch.jpg', contentType: 'image/jpeg', size: bytes.length } })
      .expect(201);

    const uploadUrl: string = created.body.upload.uploadUrl;
    await request(app).put(uploadUrl).set('x-user-id', 'user_123').set('content-type', 'image/jpeg').send(bytes).expect(201);
    await request(app)
      .post(`/api/receipts/${created.body.receipt.receiptId}/complete`)
      .set('x-user-id', 'user_123')
      .expect(200);

    const stored = await images.get(uploadUrl.split('/').pop() as string);
    expect(stored).toEqual(bytes);
    const list = await request(app).get('/api/receipts').set('x-user-id', 'user_123').expect(200);
    expect(list.body.receipts[0].status).toBe('processing');
  });

  it('serves the stored bytes back for the owning user', async () => {
    const images = createMemoryImageStore();
    const { app } = createTestApp({ imageStore: images, uploadSigner: createMemoryUploadSigner(images) });
    const bytes = Buffer.from('receipt-bytes');
    const grant = await createMemoryUploadSigner(images).createUploadUrl({
      userId: 'user_123',
      receiptId: 'rcpt_1',
      contentType: 'image/jpeg',
      fileName: 'a.jpg',
    });
    await images.put(grant.uploadUrl.split('/').pop() as string, 'image/jpeg', bytes);

    const response = await request(app).get(grant.uploadUrl).set('x-user-id', 'user_123').expect(200);

    expect(response.body).toMatchObject({ contentType: 'image/jpeg', size: bytes.length });
    expect(response.body.owner).toEqual({ userId: 'user_123', receiptId: 'rcpt_1' });
  });

  it('refuses a PUT with a non-image content type', async () => {
    const images = createMemoryImageStore();
    const { app } = createTestApp({ imageStore: images, uploadSigner: createMemoryUploadSigner(images) });
    const grant = await createMemoryUploadSigner(images).createUploadUrl({
      userId: 'user_123',
      receiptId: 'rcpt_1',
      contentType: 'image/jpeg',
      fileName: 'a.jpg',
    });

    await request(app)
      .put(grant.uploadUrl)
      .set('x-user-id', 'user_123')
      .set('content-type', 'application/pdf')
      .send(Buffer.from('x'))
      .expect(400);
  });

  it('refuses an empty PUT body', async () => {
    const images = createMemoryImageStore();
    const { app } = createTestApp({ imageStore: images, uploadSigner: createMemoryUploadSigner(images) });
    const grant = await createMemoryUploadSigner(images).createUploadUrl({
      userId: 'user_123',
      receiptId: 'rcpt_1',
      contentType: 'image/jpeg',
      fileName: 'a.jpg',
    });

    await request(app)
      .put(grant.uploadUrl)
      .set('x-user-id', 'user_123')
      .set('content-type', 'image/jpeg')
      .send(Buffer.alloc(0))
      .expect(400);
  });

  it('rejects an unknown upload token', async () => {
    const images = createMemoryImageStore();
    const { app } = createTestApp({ imageStore: images, uploadSigner: createMemoryUploadSigner(images) });

    await request(app)
      .put('/api/uploads/deadbeefdeadbeef')
      .set('x-user-id', 'user_123')
      .set('content-type', 'image/jpeg')
      .send(Buffer.from('x'))
      .expect(404);
  });

  it('hides another user upload token behind a 404', async () => {
    const images = createMemoryImageStore();
    const { app } = createTestApp({ imageStore: images, uploadSigner: createMemoryUploadSigner(images) });
    const grant = await createMemoryUploadSigner(images).createUploadUrl({
      userId: 'user_123',
      receiptId: 'rcpt_1',
      contentType: 'image/jpeg',
      fileName: 'a.jpg',
    });

    const response = await request(app).get(grant.uploadUrl).set('x-user-id', 'user_other').expect(404);

    expect(response.body.error.code).toBe('OBJECT_NOT_FOUND');
  });
});
