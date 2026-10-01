// Jest setup file - runs before all tests
process.env.PORT = '3000';
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET_RECEIPTS = 'test-bucket';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_testPool';
process.env.COGNITO_CLIENT_ID = 'test-client-id';