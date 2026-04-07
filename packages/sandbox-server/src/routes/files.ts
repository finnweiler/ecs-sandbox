import type { FastifyInstance } from 'fastify';
import type { FilesService } from '../services/files.js';

export function filesRoutes(app: FastifyInstance, filesService: FilesService) {
  app.get<{ Querystring: { path: string } }>('/files', async (request, reply) => {
    const { path } = request.query;

    if (!path || typeof path !== 'string') {
      return reply.code(400).send({ error: '"path" query parameter is required' });
    }

    try {
      return await filesService.read(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'Path not found' });
      }
      const message = err instanceof Error ? err.message : 'Failed to read path';
      return reply.code(500).send({ error: message });
    }
  });

  app.post<{ Body: { path: string; content: string } }>('/files', async (request, reply) => {
    const { path, content } = request.body;

    if (!path || typeof path !== 'string') {
      return reply.code(400).send({ error: '"path" is required' });
    }
    if (content === undefined || typeof content !== 'string') {
      return reply.code(400).send({ error: '"content" is required and must be a string' });
    }

    try {
      return await filesService.write(path, content);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to write file';
      return reply.code(500).send({ error: message });
    }
  });

  app.delete<{ Querystring: { path: string } }>('/files', async (request, reply) => {
    const { path } = request.query;

    if (!path || typeof path !== 'string') {
      return reply.code(400).send({ error: '"path" query parameter is required' });
    }

    try {
      return await filesService.remove(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete path';
      return reply.code(500).send({ error: message });
    }
  });
}
