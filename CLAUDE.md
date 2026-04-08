# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build all packages
npm run build

# Lint all packages
npm run lint

# Run tests
npm test

# Run sandbox server locally (with hot reload)
npm run dev --workspace=packages/sandbox-server

# Build and run via Docker Compose
docker compose up --build

# Run a single example
npx tsx examples/basic.ts
npx tsx examples/ecs-lifecycle.ts
```

TypeScript is compiled to `dist/` in each package. The sandbox server runs as `node dist/index.js` in production (see Dockerfile).

## Architecture

This is a monorepo (`npm workspaces`) with two packages:

**`packages/sdk`** — TypeScript client library (`@ecs-sandbox/sdk`)
- `src/core/client.ts`: `SandboxClient` — generic HTTP client for any running sandbox. Handles exec, streaming exec (SSE), and file CRUD.
- `src/core/types.ts`: Shared request/response types used by both client and server.
- `src/providers/ecs.ts`: `EcsSandboxManager` — AWS-specific lifecycle management. Creates Fargate tasks, waits for them to become healthy, discovers their IPs (directly via ECS ENI or via Cloud Map), and destroys them. AWS SDK packages are optional peer dependencies.
- `src/services/github-auth.ts`: `setupGitHubAuth()` — generates GitHub App installation tokens (JWT + token exchange) and pushes them to a sandbox via `POST /env`. Handles automatic token refresh.
- `src/index.ts`: Public API surface.

**`packages/sandbox-server`** — Fastify HTTP server that runs inside the container
- `src/config.ts`: Reads config from environment variables (`PORT`, `WORKSPACE_DIR`, `AUTH_TOKEN`, `MAX_COMMAND_TIMEOUT`).
- `src/middleware/auth.ts`: Optional Bearer token auth — only enforced if `AUTH_TOKEN` env var is set.
- `src/services/exec.ts`: Spawns commands via `sh -c`, supports both buffered and SSE-streaming execution.
- `src/services/files.ts`: File CRUD scoped to `WORKSPACE_DIR` with path traversal protection.
- Routes under `src/routes/`: `GET /health`, `POST /exec`, `POST /exec/stream`, `GET|POST|DELETE /files`, `POST /env`.

**Execution flow**: An AI agent instantiates `EcsSandboxManager`, calls `create()` to spin up an ECS Fargate task running the sandbox-server container, then uses the returned `SandboxClient` to exec commands and read/write files over HTTP. The server runs inside the VPC; only the client needs AWS credentials.

**Streaming**: `POST /exec/stream` returns Server-Sent Events. The client uses `execStream(request, onEvent)` which parses the SSE stream line-by-line.

## Server Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Listening host |
| `WORKSPACE_DIR` | `/workspace` | Root for all file operations |
| `AUTH_TOKEN` | _(none)_ | If set, requires `Authorization: Bearer <token>` |
| `MAX_COMMAND_TIMEOUT` | `300000` | Hard ceiling on exec timeout (ms) |

## SDK — EcsSandboxManager Config

Key fields in `EcsSandboxManagerConfig`:
- `cluster`, `taskDefinition`, `subnets`, `securityGroups` — required ECS Fargate config
- `cloudMapNamespace` — optional; enables Cloud Map service discovery instead of direct ENI IP lookup
- `containerPort` (default `3000`), `containerName` — customize if task definition differs
- `healthCheckTimeout`, `taskStartTimeout` — tune startup wait behavior
