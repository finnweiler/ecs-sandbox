import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { ExecService } from './services/exec.js';
import { FilesService } from './services/files.js';
import { execRoutes } from './routes/exec.js';
import { filesRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';

async function main() {
  const config = loadConfig();

  const app = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB for file writes
  });

  await app.register(cors);

  // Auth middleware (skipped if AUTH_TOKEN is not set)
  app.addHook('onRequest', authMiddleware(config));

  // Services
  const execService = new ExecService(config);
  const filesService = new FilesService(config);

  // Routes
  healthRoutes(app);
  execRoutes(app, execService);
  filesRoutes(app, filesService);

  await app.listen({ port: config.port, host: config.host });
  console.log(`ecs-sandbox server listening on ${config.host}:${config.port}`);
  console.log(`workspace: ${config.workspaceDir}`);
}

main().catch((err) => {
  console.error('Failed to start sandbox server:', err);
  process.exit(1);
});
