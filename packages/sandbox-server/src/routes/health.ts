import type { FastifyInstance } from 'fastify';

const startedAt = Date.now();

export function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      status: 'ok',
      uptime: Math.round((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
    };
  });
}
