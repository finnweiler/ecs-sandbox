import { readFile, writeFile, rm, stat, readdir, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import type { SandboxConfig } from '../config.js';

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

export class FilesService {
  constructor(private config: SandboxConfig) {}

  private resolvePath(inputPath: string): string {
    // Resolve relative to workspace, prevent path traversal
    const resolved = resolve(this.config.workspaceDir, inputPath);
    if (!resolved.startsWith(this.config.workspaceDir)) {
      throw new Error('Path traversal not allowed');
    }
    return resolved;
  }

  async read(path: string): Promise<FileReadResult | DirectoryReadResult> {
    const resolved = this.resolvePath(path);
    const stats = await stat(resolved);

    if (stats.isDirectory()) {
      const entries = await readdir(resolved, { withFileTypes: true });
      return {
        type: 'directory',
        path: resolved,
        entries: entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' as const : 'file' as const,
          ...(entry.isFile() ? {} : {}),
        })),
      };
    }

    const content = await readFile(resolved, 'utf-8');
    return {
      type: 'file',
      path: resolved,
      content,
      size: stats.size,
    };
  }

  async write(path: string, content: string): Promise<{ path: string; size: number }> {
    const resolved = this.resolvePath(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');
    const stats = await stat(resolved);
    return { path: resolved, size: stats.size };
  }

  async remove(path: string): Promise<{ path: string; deleted: boolean }> {
    const resolved = this.resolvePath(path);
    await rm(resolved, { recursive: true, force: true });
    return { path: resolved, deleted: true };
  }
}
