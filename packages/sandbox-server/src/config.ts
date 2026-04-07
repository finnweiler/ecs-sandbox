export interface SandboxConfig {
  port: number;
  host: string;
  workspaceDir: string;
  authToken: string | null;
  maxCommandTimeout: number;
}

export function loadConfig(): SandboxConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
    workspaceDir: process.env.WORKSPACE_DIR ?? '/workspace',
    authToken: process.env.AUTH_TOKEN ?? null,
    maxCommandTimeout: parseInt(process.env.MAX_COMMAND_TIMEOUT ?? '300000', 10),
  };
}
