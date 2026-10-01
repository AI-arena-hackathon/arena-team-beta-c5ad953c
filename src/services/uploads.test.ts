import { createMemoryImageStore, ImageStoreError } from './object-store';
import { createMemoryUploadSigner } from './uploads';

describe('createMemoryImageStore', () => {
  it('stores an object and returns it byte-for-byte', async () => {
    const store = createMemoryImageStore();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const stored = await store.put('token-1', 'image/jpeg', bytes);

    expect(stored.size).toBe(bytes.length);
    expect(stored.contentType).toBe('image/jpeg');
    await expect(store.get('token-1')).resolves.toEqual(bytes);
  });

  it('rejects an empty body', async () => {
    const store = createMemoryImageStore();

    await expect(store.put('token-1', 'image/jpeg', Buffer.alloc(0))).rejects.toBeInstanceOf(ImageStoreError);
  });

  it('rejects a body over the size cap', async () => {
    const store = createMemoryImageStore({ maxBytes: 4 });

    await expect(store.put('token-1', 'image/jpeg', Buffer.alloc(8))).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
      statusCode: 413,
    });
  });

  it('rejects an unsupported content type', async () => {
    const store = createMemoryImageStore();

    await expect(store.put('token-1', 'application/pdf', Buffer.from('x'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects an unsafe token', async () => {
    const store = createMemoryImageStore();

    await expect(store.put('../etc/passwd', 'image/jpeg', Buffer.from('x'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns null for a token that was never written', async () => {
    const store = createMemoryImageStore();

    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('overwrites the bytes when the same token is uploaded twice', async () => {
    const store = createMemoryImageStore();

    await store.put('token-1', 'image/jpeg', Buffer.from('first'));
    await store.put('token-1', 'image/jpeg', Buffer.from('second-bytes'));

    await expect(store.get('token-1')).resolves.toEqual(Buffer.from('second-bytes'));
  });
});

describe('createMemoryUploadSigner', () => {
  it('issues a same-origin upload URL the client can PUT bytes to', async () => {
    const store = createMemoryImageStore();
    const signer = createMemoryUploadSigner(store);

    const grant = await signer.createUploadUrl({
      userId: 'user_123',
      receiptId: 'rcpt_1',
      contentType: 'image/jpeg',
      fileName: 'lunch.jpg',
    });

    expect(grant.uploadUrl).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]+$/);
    expect(grant.bucket).toBe('memory-images');
    expect(grant.expiresIn).toBeGreaterThan(0);
    expect(grant.key).toBe(grant.uploadUrl.replace('/api/uploads/', 'memory://'));
  });

  it('hands out a distinct token per upload', async () => {
    const store = createMemoryImageStore();
    const signer = createMemoryUploadSigner(store);

    const first = await signer.createUploadUrl({ userId: 'u', receiptId: 'r1', contentType: 'image/jpeg', fileName: 'a.jpg' });
    const second = await signer.createUploadUrl({ userId: 'u', receiptId: 'r2', contentType: 'image/jpeg', fileName: 'b.jpg' });

    expect(first.key).not.toBe(second.key);
  });

  it('scopes the token to the owning user and receipt', async () => {
    const store = createMemoryImageStore();
    const signer = createMemoryUploadSigner(store);

    const grant = await signer.createUploadUrl({
      userId: 'user_123',
      receiptId: 'rcpt_1',
      contentType: 'image/jpeg',
      fileName: 'lunch.jpg',
    });

    const owner = await store.ownerOf(grant.uploadUrl.split('/').pop() as string);
    expect(owner).toEqual({ userId: 'user_123', receiptId: 'rcpt_1' });
  });

  it('rejects an unsafe userId before minting a token', async () => {
    const store = createMemoryImageStore();
    const signer = createMemoryUploadSigner(store);

    await expect(
      signer.createUploadUrl({ userId: '../evil', receiptId: 'rcpt_1', contentType: 'image/jpeg', fileName: 'a.jpg' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('reports the stored metadata through stat', async () => {
    const store = createMemoryImageStore();
    const bytes = Buffer.from('meta-bytes');

    await store.put('token-1', 'image/png', bytes);

    await expect(store.stat('token-1')).resolves.toMatchObject({ contentType: 'image/png', size: bytes.length });
  });

  it('returns null from stat for a reserved token with no bytes yet', async () => {
    const store = createMemoryImageStore();

    store.reserve('token-1', { userId: 'user_1', receiptId: 'rcpt_1' });

    await expect(store.stat('token-1')).resolves.toBeNull();
  });
});
