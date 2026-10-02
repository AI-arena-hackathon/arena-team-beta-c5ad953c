import path from 'path';
import express, { type Express } from 'express';
import { createApiRouter } from './routes/api';
import { createCorsMiddleware, securityHeaders } from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { devHeaderIdentityResolver, type IdentityResolver } from './middleware/identity';
import { DEFAULT_MONTHLY_LIMIT } from './services/capture';
import { createMemoryStore, type ReceiptStore } from './services/store';
import type { UploadSigner } from './services/capture';
import { createS3UploadSigner } from './services/uploads';
import { createMemoryImageStore, type ImageStore } from './services/object-store';
import { createMemoryConsentStore, type ConsentStore } from './services/compliance';
import { createMemoryDataSubjectRequestStore, type DataSubjectRequestStore } from './services/compliance';
import type { ReceiptProcessorDeps } from './services/processing';

export interface AppDeps {
  store?: ReceiptStore;
  imageStore?: ImageStore;
  uploadSigner?: UploadSigner;
  monthlyLimit?: number;
  identityResolver?: IdentityResolver;
  ocrFallbackEnabled?: boolean;
  textractEnabled?: boolean;
  serveUi?: boolean;
  corsOrigins?: readonly string[];
  consentStore?: ConsentStore;
  dsrStore?: DataSubjectRequestStore;
  processingDeps?: ReceiptProcessorDeps;
}

/**
 * Composition of the HTTP layer only — no environment reads happen here, so the
 * app is fully testable with injected fakes. `src/index.ts` is the composition
 * root that builds real deps from the environment and starts the listener.
 */
export function createApp(deps: AppDeps = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(createCorsMiddleware(deps.corsOrigins ?? []));
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/uploads', express.raw({ type: () => true, limit: '10mb' }));

  if (deps.serveUi !== false) {
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  app.use(
    createApiRouter({
      store: deps.store ?? createMemoryStore(),
      uploadSigner: deps.uploadSigner ?? createS3UploadSigner(),
      monthlyLimit: deps.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT,
      identityResolver: deps.identityResolver ?? devHeaderIdentityResolver,
      ocrFallbackEnabled: deps.ocrFallbackEnabled,
      textractEnabled: deps.textractEnabled,
      imageStore: deps.imageStore ?? createMemoryImageStore(),
      consentStore: deps.consentStore ?? createMemoryConsentStore(),
      dsrStore: deps.dsrStore ?? createMemoryDataSubjectRequestStore(),
      processingDeps: deps.processingDeps,
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
