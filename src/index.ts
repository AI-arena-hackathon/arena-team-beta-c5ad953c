import dotenv from 'dotenv';
import { createApp } from './app';
import { getConfig } from './config';
import { devHeaderIdentityResolver, disabledIdentityResolver } from './middleware/identity';
import { createDynamoReceiptStore } from './services/dynamo-store';
import { createMemoryStore, type ReceiptStore } from './services/store';
import { createMemoryUploadSigner, createS3UploadSigner } from './services/uploads';
import { createMemoryImageStore, type ImageStore } from './services/object-store';
import type { UploadSigner } from './services/capture';

dotenv.config();

const config = getConfig();

function createStore(): ReceiptStore {
  return config.storage.backend === 'dynamodb' ? createDynamoReceiptStore() : createMemoryStore();
}

// `memory` signer serves the bytes through this app's own /api/uploads routes,
// so the capture flow runs end to end with no AWS account.
const imageStore: ImageStore = createMemoryImageStore();

function createUploadSigner(): UploadSigner {
  return config.uploads.signer === 's3' ? createS3UploadSigner() : createMemoryUploadSigner(imageStore);
}

export const app = createApp({
  store: createStore(),
  uploadSigner: createUploadSigner(),
  imageStore,
  monthlyLimit: config.features.maxReceiptsPerMonth,
  identityResolver: config.auth.devHeaderEnabled ? devHeaderIdentityResolver : disabledIdentityResolver,
  ocrFallbackEnabled: config.features.enableOcrFallback,
  textractEnabled: config.textract.enabled,
  corsOrigins: config.cors.allowedOrigins,
});

if (require.main === module) {
  app.listen(config.server.port, () => {
    console.log(`Server running on port ${config.server.port} (storage: ${config.storage.backend})`);
  });
}
