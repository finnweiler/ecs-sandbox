# ecs-sandbox

A minimal, self-hostable sandbox container for AI agents. Turn any ECS task (or Docker container) into an isolated remote execution environment.

## Why?

AI agents that interact with code repositories need isolated environments — one per project, branch, or task. Hosted platforms like E2B and Daytona solve this, but lock you into their infrastructure. **ecs-sandbox** gives you the same primitives (exec, filesystem, lifecycle) as a lightweight container you run on your own infra.

## Architecture

```
┌──────────────────────────────┐
│  Your Agent                  │
│  (Strands, LangChain, etc.)  │
│                              │
│  const sandbox = await       │
│    manager.create("proj-a")  │
│  sandbox.exec("git clone")   │
│  sandbox.files.read("src/")  │
└──────────┬───────────────────┘
           │ HTTP (VPC-internal)
     ┌─────┼─────────┐
     ▼     ▼         ▼
┌────────┐┌────────┐┌────────┐
│Sandbox ││Sandbox ││Sandbox │
│Task A  ││Task B  ││Task C  │
│  :3000 ││  :3000 ││  :3000 │
└────────┘└────────┘└────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@ecs-sandbox/server` | The sandbox container — a Fastify HTTP server exposing exec, filesystem, and health APIs |
| `@ecs-sandbox/sdk` | TypeScript client SDK with a provider-agnostic core and an ECS lifecycle adapter |

## Installation

```bash
npm install @ecs-sandbox/sdk
```

```bash
docker pull finnweiler/ecs-sandbox
```

## Quick Start

### Run the sandbox container

```bash
docker run -p 3000:3000 finnweiler/ecs-sandbox
```

### Use the SDK

```typescript
import { SandboxClient } from '@ecs-sandbox/sdk';

// Connect to a running sandbox
const sandbox = new SandboxClient('http://localhost:3000');

// Execute commands
const result = await sandbox.exec('echo "hello from sandbox"');
console.log(result.stdout); // "hello from sandbox"

// Read files
const content = await sandbox.files.read('/workspace/README.md');

// Write files
await sandbox.files.write('/workspace/config.json', JSON.stringify({ key: 'value' }));
```

### With ECS lifecycle management

```typescript
import { EcsSandboxManager } from '@ecs-sandbox/sdk';

const manager = new EcsSandboxManager({
  cluster: 'my-cluster',
  taskDefinition: 'sandbox-task',
  subnets: ['subnet-abc123'],
  securityGroups: ['sg-abc123'],
  namespace: 'sandboxes.local', // Cloud Map namespace
});

// Spin up an isolated sandbox for a project
const sandbox = await manager.create('project-alpha');

// Use it
await sandbox.exec('git clone https://github.com/org/repo.git /workspace');
await sandbox.exec('cd /workspace && npm install');
const result = await sandbox.exec('cd /workspace && npm test');

// Tear it down
await manager.destroy('project-alpha');
```

### With Strands Agents

```typescript
import { Agent } from '@strands-agents/sdk';
import { SandboxClient, createSandboxTools } from '@ecs-sandbox/sdk';

const client = new SandboxClient('http://localhost:3000');
const agent = new Agent({
  tools: [...createSandboxTools(client)],
});

await agent.invoke('Clone the repo and run the tests');
```

`createSandboxTools` returns four tools: `sandbox_exec`, `sandbox_read_file`, `sandbox_write_file`, and `sandbox_remove_file`. Requires `@strands-agents/sdk` and `zod` as peer dependencies.

### With GitHub App Authentication

Authenticate the `gh` CLI and `git` inside a sandbox using a GitHub App. The private key stays in your agent's process — only short-lived installation tokens are sent to the sandbox.

```typescript
import { SandboxClient, setupGitHubAuth } from '@ecs-sandbox/sdk';
import { readFileSync } from 'fs';

const client = new SandboxClient('http://localhost:3000');

const auth = await setupGitHubAuth(client, {
  appId: '123456',
  installationId: '78901234',
  privateKey: readFileSync('private-key.pem', 'utf-8'),
});

// gh and git are now authenticated inside the sandbox
await client.exec('gh repo clone org/private-repo /workspace');
await client.exec('cd /workspace && git push');

// Stop the automatic token refresh when done
auth.stop();
```

Tokens are refreshed automatically every 50 minutes (GitHub installation tokens expire after 1 hour). Call `auth.refresh()` to force an immediate refresh.

#### Scoping the token

By default the token grants access to every repository the installation can reach. To narrow it, pass any of `repositories`, `repositoryIds`, or `permissions`:

```typescript
const auth = await setupGitHubAuth(client, {
  appId: '123456',
  installationId: '78901234',
  privateKey: readFileSync('private-key.pem', 'utf-8'),
  repositories: ['repo-a', 'repo-b'],
  permissions: { contents: 'read', pull_requests: 'write' },
});
```

`repositories` / `repositoryIds` must be a subset of the repos the installation can access, and `permissions` must be a subset of what the App is granted.

## API Reference

### Sandbox Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/exec` | Execute a command |
| `POST` | `/exec/stream` | Execute with SSE streaming |
| `GET` | `/files` | Read file or list directory |
| `POST` | `/files` | Write file |
| `DELETE` | `/files` | Delete file or directory |
| `POST` | `/env` | Set environment variables |
| `GET` | `/health` | Health check |

### POST /exec

```json
// Request
{ "command": "git status", "cwd": "/workspace", "timeout": 30000 }

// Response
{ "stdout": "On branch main\n...", "stderr": "", "exitCode": 0, "durationMs": 42 }
```

### POST /exec/stream

Same request body as `/exec`, returns an SSE stream:

```
data: {"type":"stdout","data":"Installing dependencies...\n"}
data: {"type":"stdout","data":"Done.\n"}
data: {"type":"exit","exitCode":0,"durationMs":1234}
```

### GET /files?path=/workspace/src

```json
// File response
{ "type": "file", "path": "/workspace/src/index.ts", "content": "...", "size": 1234 }

// Directory response
{ "type": "directory", "path": "/workspace/src", "entries": [
  { "name": "index.ts", "type": "file", "size": 1234 },
  { "name": "utils", "type": "directory" }
]}
```

### POST /files

```json
{ "path": "/workspace/config.json", "content": "{\"key\": \"value\"}" }
```

## Configuration

### Sandbox Server

| Env Var | Default | Description |
|---------|---------|-------------|
| `PORT` | `3000` | Server port |
| `WORKSPACE_DIR` | `/workspace` | Default working directory |
| `AUTH_TOKEN` | — | Optional bearer token for authentication |
| `MAX_COMMAND_TIMEOUT` | `300000` | Maximum command execution time (ms) |

## Security

The sandbox container is designed to run in a private VPC. **Do not expose it to the public internet.** Use security groups to restrict access to your agent's ECS service only.

For additional security, set `AUTH_TOKEN` to require bearer token authentication on all requests.

## License

MIT
