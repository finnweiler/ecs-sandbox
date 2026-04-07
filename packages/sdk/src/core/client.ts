import type {
  ExecRequest,
  ExecResult,
  ExecStreamEvent,
  FileReadResult,
  DirectoryReadResult,
  HealthResult,
} from './types.js';

export interface SandboxClientOptions {
  /** Bearer token for authentication */
  authToken?: string;
  /** Request timeout in ms (default: 300000) */
  timeout?: number;
}

export class SandboxClient {
  public readonly files: SandboxFilesClient;
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;

  constructor(baseUrl: string, options: SandboxClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = options.timeout ?? 300_000;
    this.headers = {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    };
    this.files = new SandboxFilesClient(this.baseUrl, this.headers, this.timeout);
  }

  /**
   * Execute a command in the sandbox and wait for completion.
   */
  async exec(command: string, options?: Omit<ExecRequest, 'command'>): Promise<ExecResult> {
    const response = await fetch(`${this.baseUrl}/exec`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ command, ...options }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new SandboxError(`exec failed (${response.status})`, body);
    }

    return response.json() as Promise<ExecResult>;
  }

  /**
   * Execute a command and stream output via SSE.
   */
  async execStream(
    command: string,
    onEvent: (event: ExecStreamEvent) => void,
    options?: Omit<ExecRequest, 'command'>,
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/exec/stream`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ command, ...options }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new SandboxError(`exec/stream failed (${response.status})`, body);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new SandboxError('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as ExecStreamEvent;
            onEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    }
  }

  /**
   * Health check.
   */
  async health(): Promise<HealthResult> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: this.headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new SandboxError(`health check failed (${response.status})`);
    }

    return response.json() as Promise<HealthResult>;
  }

  /**
   * Wait until the sandbox is healthy.
   */
  async waitForReady(timeoutMs = 60_000, intervalMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        await this.health();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    throw new SandboxError(`Sandbox not ready after ${timeoutMs}ms`);
  }
}

class SandboxFilesClient {
  constructor(
    private baseUrl: string,
    private headers: Record<string, string>,
    private timeout: number,
  ) {}

  /**
   * Read a file's content.
   */
  async read(path: string): Promise<FileReadResult | DirectoryReadResult> {
    const url = `${this.baseUrl}/files?path=${encodeURIComponent(path)}`;
    const response = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new SandboxError(`files.read failed (${response.status})`, body);
    }

    return response.json() as Promise<FileReadResult | DirectoryReadResult>;
  }

  /**
   * Write content to a file. Parent directories are created automatically.
   */
  async write(path: string, content: string): Promise<{ path: string; size: number }> {
    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ path, content }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new SandboxError(`files.write failed (${response.status})`, body);
    }

    return response.json() as Promise<{ path: string; size: number }>;
  }

  /**
   * Delete a file or directory.
   */
  async remove(path: string): Promise<{ path: string; deleted: boolean }> {
    const url = `${this.baseUrl}/files?path=${encodeURIComponent(path)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new SandboxError(`files.remove failed (${response.status})`, body);
    }

    return response.json() as Promise<{ path: string; deleted: boolean }>;
  }
}

export class SandboxError extends Error {
  public details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'SandboxError';
    this.details = details;
  }
}
