import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openApiSpec } from './docs/openapi';
import { errorHandler } from './lib/errors';
import { adminRouter } from './routes/admin.routes';
import { authRouter } from './routes/auth.routes';
import { inventoryRouter } from './routes/inventory.routes';

export function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: env.nodeEnv === 'development' ? true : env.corsOrigin.split(','),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', dbClient: env.dbClient });
  });

  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/inventory', inventoryRouter);

  app.use(errorHandler);

  return app;
}
