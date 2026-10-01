import request from 'supertest';

describe('composition root (src/index.ts)', () => {
  const originalEnv = process.env;

  // These tests re-require the composition root with different environments, so
  // the env object is restored after every test — never only at the end of the
  // file, or one test's environment leaks into the next one's expectations.
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('GET /health should return 200 with status ok', async () => {
    const { app } = require('./index');

    const response = await request(app).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health should have correct content type', async () => {
    const { app } = require('./index');

    const response = await request(app).get('/health').expect(200);

    expect(response.headers['content-type']).toMatch(/json/);
  });

  it('returns the structured 404 envelope for unknown paths', async () => {
    const { app } = require('./index');

    const response = await request(app).get('/unknown').expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('wires the free-tier limit from MAX_RECEIPTS_PER_MONTH into /api/config', async () => {
    process.env = { ...originalEnv, MAX_RECEIPTS_PER_MONTH: '3' };
    jest.resetModules();
    const { app } = require('./index');

    const response = await request(app).get('/api/config').expect(200);

    expect(response.body.features.maxReceiptsPerMonth).toBe(3);
  });

  it('fails closed on the dev identity header when NODE_ENV=production', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    jest.resetModules();
    const { app } = require('./index');

    const response = await request(app)
      .post('/api/receipts')
      .set('x-user-id', 'user_123')
      .send({ image: { fileName: 'a.jpg', contentType: 'image/jpeg', size: 10 } })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});
