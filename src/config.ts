export interface ServerConfig {
  port: number;
  nodeEnv: string;
}

export interface AwsConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface DynamoDbConfig {
  tableReceipts: string;
  tableUsers: string;
  endpoint?: string;
}

export interface S3Config {
  bucketReceipts: string;
  presignedUrlExpiry: number;
}

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

export interface TextractConfig {
  enabled: boolean;
  region: string;
}

export interface FeatureFlags {
  enableOcrFallback: boolean;
  maxReceiptsPerMonth: number;
}

export interface StorageConfig {
  backend: 'memory' | 'dynamodb';
}

export interface AuthConfig {
  devHeaderEnabled: boolean;
}

export interface AppConfig {
  server: ServerConfig;
  aws: AwsConfig;
  dynamodb: DynamoDbConfig;
  s3: S3Config;
  cognito: CognitoConfig;
  textract: TextractConfig;
  features: FeatureFlags;
  storage: StorageConfig;
  auth: AuthConfig;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return parsed;
}

function getEnvEnum<T extends string>(key: string, allowed: readonly T[], defaultValue: T): T {
  const value = getEnv(key, defaultValue);
  if (!allowed.includes(value as T)) {
    throw new Error(`Environment variable ${key} must be one of: ${allowed.join(', ')} (got: ${value})`);
  }
  return value as T;
}

/**
 * The `x-user-id` placeholder identity is never allowed in production, whatever
 * the environment says — production must fail closed until Cognito is wired in.
 */
function devAuthHeaderEnabled(nodeEnv: string): boolean {
  const forced = process.env.DEV_AUTH_HEADER_ENABLED;
  if (nodeEnv === 'production') return false;
  if (forced === undefined) return true;
  return forced.toLowerCase() === 'true';
}

function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.toLowerCase() === 'true';
}

export function loadConfig(): AppConfig {
  const nodeEnv = getEnv('NODE_ENV', 'development');
  return {
    server: {
      port: getEnvNumber('PORT', 3000),
      nodeEnv,
    },
    aws: {
      region: getEnv('AWS_REGION', 'us-east-1'),
      accessKeyId: getEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: getEnv('AWS_SECRET_ACCESS_KEY'),
    },
    dynamodb: {
      tableReceipts: getEnv('DYNAMODB_TABLE_RECEIPTS', 'receipts'),
      tableUsers: getEnv('DYNAMODB_TABLE_USERS', 'users'),
      endpoint: process.env.DYNAMODB_ENDPOINT,
    },
    s3: {
      bucketReceipts: getEnv('S3_BUCKET_RECEIPTS'),
      presignedUrlExpiry: getEnvNumber('S3_PRESIGNED_URL_EXPIRY', 3600),
    },
    cognito: {
      userPoolId: getEnv('COGNITO_USER_POOL_ID'),
      clientId: getEnv('COGNITO_CLIENT_ID'),
      region: getEnv('COGNITO_REGION', 'us-east-1'),
    },
    textract: {
      enabled: getEnvBoolean('TEXTRACT_ENABLED', true),
      region: getEnv('TEXTRACT_REGION', 'us-east-1'),
    },
    features: {
      enableOcrFallback: getEnvBoolean('ENABLE_OCR_FALLBACK', true),
      maxReceiptsPerMonth: getEnvNumber('MAX_RECEIPTS_PER_MONTH', 50),
    },
    storage: {
      backend: getEnvEnum('STORAGE_BACKEND', ['memory', 'dynamodb'] as const, 'memory'),
    },
    auth: {
      devHeaderEnabled: devAuthHeaderEnabled(nodeEnv),
    },
  };
}

export function getConfig(): AppConfig {
  return loadConfig();
}