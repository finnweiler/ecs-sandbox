import type { FastifyInstance } from 'fastify';
import type { ExecService, ExecRequest } from '../services/exec.js';

export function execRoutes(app: FastifyInstance, execService: ExecService) {
  app.post<{ Body: ExecRequest }>('/exec', async (request, reply) => {
    const { command, cwd, timeout, env } = request.body;

    if (!command || typeof command !== 'string') {
      return reply.code(400).send({ error: '"command" is required and must be a string' });
    }

    try {
      const result = await execService.run({ command, cwd, timeout, env });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Command execution failed';
      return reply.code(500).send({ error: message });
    }
  });

  app.post<{ Body: ExecRequest }>('/exec/stream', async (request, reply) => {
    const { command, cwd, timeout, env } = request.body;

    if (!command || typeof command !== 'string') {
      return reply.code(400).send({ error: '"command" is required and must be a string' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const abort = execService.runStream(
      { command, cwd, timeout, env },
      (event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      () => {
        reply.raw.end();
      },
    );

    request.raw.on('close', () => {
      abort();
    });
  });
}
