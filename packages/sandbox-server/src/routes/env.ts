import type { FastifyInstance } from 'fastify';

export function envRoutes(app: FastifyInstance) {
  app.post<{ Body: { vars: Record<string, string> } }>('/env', async (request, reply) => {
    const { vars } = request.body;

    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
      return reply.code(400).send({ error: '"vars" is required and must be an object' });
    }

    const keys = Object.keys(vars);
    if (keys.length === 0) {
      return reply.code(400).send({ error: '"vars" must not be empty' });
    }

    for (const [key, value] of Object.entries(vars)) {
      if (typeof value !== 'string') {
        return reply.code(400).send({ error: `Value for "${key}" must be a string` });
      }
      process.env[key] = value;
    }

    return { set: keys };
  });
}
