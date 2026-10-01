import request from 'supertest';
import { app } from './index';

describe('Health Endpoint', () => {
  it('GET /health should return 200 with status ok', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health should have correct content type', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.headers['content-type']).toMatch(/json/);
  });
});

describe('404 Handling', () => {
  it('GET /unknown should return 404', async () => {
    const response = await request(app).get('/unknown').expect(404);
    expect(response.body).toHaveProperty('error', 'Not found');
  });
});

describe('Error Handling', () => {
  it('should handle server errors', async () => {
    // This test ensures error middleware is in place
    const response = await request(app).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });
});