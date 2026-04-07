import { spawn } from 'node:child_process';
import type { SandboxConfig } from '../config.js';

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

export class ExecService {
  constructor(private config: SandboxConfig) {}

  async run(request: ExecRequest): Promise<ExecResult> {
    const timeout = Math.min(
      request.timeout ?? this.config.maxCommandTimeout,
      this.config.maxCommandTimeout,
    );
    const cwd = request.cwd ?? this.config.workspaceDir;

    return new Promise((resolve, reject) => {
      const start = performance.now();

      const child = spawn('sh', ['-c', request.command], {
        cwd,
        env: { ...process.env, ...request.env },
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          durationMs: Math.round(performance.now() - start),
        });
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  runStream(
    request: ExecRequest,
    onEvent: (event: ExecStreamEvent) => void,
    onDone: () => void,
  ): () => void {
    const timeout = Math.min(
      request.timeout ?? this.config.maxCommandTimeout,
      this.config.maxCommandTimeout,
    );
    const cwd = request.cwd ?? this.config.workspaceDir;
    const start = performance.now();

    const child = spawn('sh', ['-c', request.command], {
      cwd,
      env: { ...process.env, ...request.env },
      timeout,
    });

    child.stdout.on('data', (data: Buffer) => {
      onEvent({ type: 'stdout', data: data.toString() });
    });

    child.stderr.on('data', (data: Buffer) => {
      onEvent({ type: 'stderr', data: data.toString() });
    });

    child.on('close', (code) => {
      onEvent({
        type: 'exit',
        exitCode: code ?? 1,
        durationMs: Math.round(performance.now() - start),
      });
      onDone();
    });

    child.on('error', (err) => {
      onEvent({ type: 'error', error: err.message });
      onDone();
    });

    // Return abort function
    return () => {
      child.kill('SIGTERM');
    };
  }
}
