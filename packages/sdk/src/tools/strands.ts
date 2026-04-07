import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { SandboxClient } from '../core/client.js';

/**
 * Create Strands Agents tools backed by a sandbox client.
 * Pass the returned array to `new Agent({ tools: [...] })`.
 */
export function createSandboxTools(client: SandboxClient) {
  const exec = tool({
    name: 'sandbox_exec',
    description:
      'Execute a shell command in a sandboxed environment. Returns stdout, stderr, exit code, and duration in milliseconds.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Working directory (relative to workspace root)'),
      timeout: z.number().optional().describe('Timeout in milliseconds'),
    }),
    callback: async (input) => {
      const result = await client.exec(input.command, {
        cwd: input.cwd,
        timeout: input.timeout,
      });
      return JSON.stringify(result);
    },
  });

  const readFile = tool({
    name: 'sandbox_read_file',
    description:
      'Read a file or list a directory in the sandbox. Returns file content and size, or a list of directory entries.',
    inputSchema: z.object({
      path: z.string().describe('Path to the file or directory to read'),
    }),
    callback: async (input) => {
      const result = await client.files.read(input.path);
      return JSON.stringify(result);
    },
  });

  const writeFile = tool({
    name: 'sandbox_write_file',
    description:
      'Write content to a file in the sandbox. Parent directories are created automatically.',
    inputSchema: z.object({
      path: z.string().describe('Path to the file to write'),
      content: z.string().describe('Content to write to the file'),
    }),
    callback: async (input) => {
      const result = await client.files.write(input.path, input.content);
      return JSON.stringify(result);
    },
  });

  const removeFile = tool({
    name: 'sandbox_remove_file',
    description: 'Delete a file or directory in the sandbox.',
    inputSchema: z.object({
      path: z.string().describe('Path to the file or directory to delete'),
    }),
    callback: async (input) => {
      const result = await client.files.remove(input.path);
      return JSON.stringify(result);
    },
  });

  return [exec, readFile, writeFile, removeFile] as const;
}
