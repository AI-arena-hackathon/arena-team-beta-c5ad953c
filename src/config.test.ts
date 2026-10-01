import { loadConfig } from './config';

describe('Configuration Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const setMinimalEnv = () => {
    process.env.PORT = '3000';
    process.env.NODE_ENV = 'test';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.S3_BUCKET_RECEIPTS = 'test-bucket';
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testPool';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
  };

  it('should load config with all required values', () => {
    setMinimalEnv();

    const config = loadConfig();

    expect(config).toEqual({
      server: { port: 3000, nodeEnv: 'test' },
      aws: { region: 'us-east-1', accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      dynamodb: { tableReceipts: 'receipts', tableUsers: 'users', endpoint: undefined },
      s3: { bucketReceipts: 'test-bucket', presignedUrlExpiry: 3600 },
      cognito: { userPoolId: 'us-east-1_testPool', clientId: 'test-client-id', region: 'us-east-1' },
      textract: { enabled: true, region: 'us-east-1' },
      features: { enableOcrFallback: true, maxReceiptsPerMonth: 50 },
      storage: { backend: 'memory' },
      auth: { devHeaderEnabled: true },
    });
  });

  it('should use default values for optional variables', () => {
    setMinimalEnv();
    delete process.env.DYNAMODB_TABLE_RECEIPTS;
    delete process.env.DYNAMODB_TABLE_USERS;
    delete process.env.S3_PRESIGNED_URL_EXPIRY;
    delete process.env.COGNITO_REGION;
    delete process.env.TEXTRACT_ENABLED;
    delete process.env.TEXTRACT_REGION;
    delete process.env.ENABLE_OCR_FALLBACK;
    delete process.env.MAX_RECEIPTS_PER_MONTH;

    const config = loadConfig();

    expect(config.dynamodb.tableReceipts).toBe('receipts');
    expect(config.dynamodb.tableUsers).toBe('users');
    expect(config.s3.presignedUrlExpiry).toBe(3600);
    expect(config.cognito.region).toBe('us-east-1');
    expect(config.textract.enabled).toBe(true);
    expect(config.textract.region).toBe('us-east-1');
    expect(config.features.enableOcrFallback).toBe(true);
    expect(config.features.maxReceiptsPerMonth).toBe(50);
  });

  it('should throw on missing required AWS_ACCESS_KEY_ID', () => {
    setMinimalEnv();
    delete process.env.AWS_ACCESS_KEY_ID;

    expect(() => loadConfig()).toThrow('Missing required environment variable: AWS_ACCESS_KEY_ID');
  });

  it('should throw on missing required AWS_SECRET_ACCESS_KEY', () => {
    setMinimalEnv();
    delete process.env.AWS_SECRET_ACCESS_KEY;

    expect(() => loadConfig()).toThrow('Missing required environment variable: AWS_SECRET_ACCESS_KEY');
  });

  it('should throw on missing required S3_BUCKET_RECEIPTS', () => {
    setMinimalEnv();
    delete process.env.S3_BUCKET_RECEIPTS;

    expect(() => loadConfig()).toThrow('Missing required environment variable: S3_BUCKET_RECEIPTS');
  });

  it('should throw on missing required COGNITO_USER_POOL_ID', () => {
    setMinimalEnv();
    delete process.env.COGNITO_USER_POOL_ID;

    expect(() => loadConfig()).toThrow('Missing required environment variable: COGNITO_USER_POOL_ID');
  });

  it('should throw on missing required COGNITO_CLIENT_ID', () => {
    setMinimalEnv();
    delete process.env.COGNITO_CLIENT_ID;

    expect(() => loadConfig()).toThrow('Missing required environment variable: COGNITO_CLIENT_ID');
  });

  it('should parse PORT as number', () => {
    setMinimalEnv();
    process.env.PORT = '8080';

    const config = loadConfig();
    expect(config.server.port).toBe(8080);
  });

  it('should throw on invalid PORT number', () => {
    setMinimalEnv();
    process.env.PORT = 'not-a-number';

    expect(() => loadConfig()).toThrow('Environment variable PORT must be a number, got: not-a-number');
  });

  it('should parse S3_PRESIGNED_URL_EXPIRY as number', () => {
    setMinimalEnv();
    process.env.S3_PRESIGNED_URL_EXPIRY = '7200';

    const config = loadConfig();
    expect(config.s3.presignedUrlExpiry).toBe(7200);
  });

  it('should throw on invalid S3_PRESIGNED_URL_EXPIRY number', () => {
    setMinimalEnv();
    process.env.S3_PRESIGNED_URL_EXPIRY = 'invalid';

    expect(() => loadConfig()).toThrow('Environment variable S3_PRESIGNED_URL_EXPIRY must be a number, got: invalid');
  });

  it('should parse MAX_RECEIPTS_PER_MONTH as number', () => {
    setMinimalEnv();
    process.env.MAX_RECEIPTS_PER_MONTH = '100';

    const config = loadConfig();
    expect(config.features.maxReceiptsPerMonth).toBe(100);
  });

  it('should parse TEXTRACT_ENABLED as boolean true', () => {
    setMinimalEnv();
    process.env.TEXTRACT_ENABLED = 'true';

    const config = loadConfig();
    expect(config.textract.enabled).toBe(true);
  });

  it('should parse TEXTRACT_ENABLED as boolean false', () => {
    setMinimalEnv();
    process.env.TEXTRACT_ENABLED = 'false';

    const config = loadConfig();
    expect(config.textract.enabled).toBe(false);
  });

  it('should parse ENABLE_OCR_FALLBACK as boolean', () => {
    setMinimalEnv();
    process.env.ENABLE_OCR_FALLBACK = 'false';

    const config = loadConfig();
    expect(config.features.enableOcrFallback).toBe(false);
  });

  it('should include DYNAMODB_ENDPOINT when set', () => {
    setMinimalEnv();
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';

    const config = loadConfig();
    expect(config.dynamodb.endpoint).toBe('http://localhost:8000');
  });

  it('should exclude DYNAMODB_ENDPOINT when not set', () => {
    setMinimalEnv();
    delete process.env.DYNAMODB_ENDPOINT;

    const config = loadConfig();
    expect(config.dynamodb.endpoint).toBeUndefined();
  });
  it('should default the receipt store to the in-memory backend', () => {
    setMinimalEnv();
    delete process.env.STORAGE_BACKEND;

    expect(loadConfig().storage.backend).toBe('memory');
  });

  it('should accept STORAGE_BACKEND=dynamodb', () => {
    setMinimalEnv();
    process.env.STORAGE_BACKEND = 'dynamodb';

    expect(loadConfig().storage.backend).toBe('dynamodb');
  });

  it('should reject an unknown STORAGE_BACKEND', () => {
    setMinimalEnv();
    process.env.STORAGE_BACKEND = 'sqlite';

    expect(() => loadConfig()).toThrow(/STORAGE_BACKEND/);
  });

  it('should enable the dev identity header outside production', () => {
    setMinimalEnv();
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_AUTH_HEADER_ENABLED;

    expect(loadConfig().auth.devHeaderEnabled).toBe(true);
  });

  it('should disable the dev identity header in production by default', () => {
    setMinimalEnv();
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_AUTH_HEADER_ENABLED;

    expect(loadConfig().auth.devHeaderEnabled).toBe(false);
  });

  it('should never enable the dev identity header in production, even when forced', () => {
    setMinimalEnv();
    process.env.NODE_ENV = 'production';
    process.env.DEV_AUTH_HEADER_ENABLED = 'true';

    expect(loadConfig().auth.devHeaderEnabled).toBe(false);
  });

  it('should let DEV_AUTH_HEADER_ENABLED=false disable the header outside production', () => {
    setMinimalEnv();
    process.env.NODE_ENV = 'development';
    process.env.DEV_AUTH_HEADER_ENABLED = 'false';

    expect(loadConfig().auth.devHeaderEnabled).toBe(false);
  });
});
