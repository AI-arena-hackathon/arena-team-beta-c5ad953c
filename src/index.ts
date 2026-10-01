import dotenv from 'dotenv';
import { createApp } from './app';
import { getConfig } from './config';
import { devHeaderIdentityResolver, disabledIdentityResolver } from './middleware/identity';
import { createDynamoReceiptStore } from './services/dynamo-store';
import { createMemoryStore, type ReceiptStore } from './services/store';
import { createS3UploadSigner } from './services/uploads';

dotenv.config();

const config = getConfig();

function createStore(): ReceiptStore {
  return config.storage.backend === 'dynamodb' ? createDynamoReceiptStore() : createMemoryStore();
}

export const app = createApp({
  store: createStore(),
  uploadSigner: createS3UploadSigner(),
  monthlyLimit: config.features.maxReceiptsPerMonth,
  identityResolver: config.auth.devHeaderEnabled ? devHeaderIdentityResolver : disabledIdentityResolver,
  ocrFallbackEnabled: config.features.enableOcrFallback,
  textractEnabled: config.textract.enabled,
});

if (require.main === module) {
  app.listen(config.server.port, () => {
    console.log(`Server running on port ${config.server.port} (storage: ${config.storage.backend})`);
  });
}
