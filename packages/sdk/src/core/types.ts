export interface ExecRequest {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ExecStreamEvent {
  type: 'stdout' | 'stderr' | 'exit' | 'error';
  data?: string;
  exitCode?: number;
  durationMs?: number;
  error?: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface FileReadResult {
  type: 'file';
  path: string;
  content: string;
  size: number;
}

export interface DirectoryReadResult {
  type: 'directory';
  path: string;
  entries: FileEntry[];
}

export interface HealthResult {
  status: string;
  uptime: number;
  startedAt: string;
}

export interface SandboxInfo {
  id: string;
  url: string;
  status: 'running' | 'stopped' | 'pending';
  createdAt?: string;
  metadata?: Record<string, string>;
}

export interface SandboxManagerOptions {
  /** Timeout in ms to wait for sandbox to become healthy */
  healthCheckTimeout?: number;
  /** Interval in ms between health check attempts */
  healthCheckInterval?: number;
}
