import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SandboxConfig } from '../config.js';

export function authMiddleware(config: SandboxConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.authToken) return;

    const header = request.headers.authorization;
    if (!header || header !== `Bearer ${config.authToken}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}
