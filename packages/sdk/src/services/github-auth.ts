import { createSign } from 'node:crypto';
import type { SandboxClient } from '../core/client.js';

export interface GitHubAuthConfig {
  /** GitHub App ID (numeric) */
  appId: string;
  /** GitHub App installation ID */
  installationId: string;
  /** PEM-encoded private key */
  privateKey: string;
  /**
   * Scope the token to a subset of repositories by name (e.g. `["repo-a"]`).
   * Must be a subset of repos the installation can access.
   */
  repositories?: string[];
  /** Scope the token to a subset of repositories by numeric ID. */
  repositoryIds?: number[];
  /** Narrow the token's permissions to a subset of what the app is granted. */
  permissions?: Record<string, string>;
}

export interface GitHubAuthHandle {
  /** Stop the automatic token refresh timer */
  stop(): void;
  /** Force an immediate token refresh */
  refresh(): Promise<void>;
}

const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes (tokens expire after 1 hour)

/**
 * Set up GitHub App authentication on a sandbox.
 *
 * Generates an installation access token from the App credentials,
 * pushes it to the sandbox as GH_TOKEN / GITHUB_TOKEN, and configures
 * the `gh` CLI credential helper for git. Automatically refreshes
 * the token every 50 minutes.
 *
 * The private key never leaves the calling process.
 */
export async function setupGitHubAuth(
  client: SandboxClient,
  config: GitHubAuthConfig,
): Promise<GitHubAuthHandle> {
  async function pushToken() {
    const jwt = createJwt(config.appId, config.privateKey);
    const token = await getInstallationToken(jwt, config.installationId, {
      repositories: config.repositories,
      repositoryIds: config.repositoryIds,
      permissions: config.permissions,
    });
    await client.setEnv({ GH_TOKEN: token, GITHUB_TOKEN: token });
  }

  // Initial token push
  await pushToken();

  // Configure git to use gh as credential helper
  await client.exec('gh auth setup-git');

  // Refresh on interval
  const timer = setInterval(() => {
    pushToken().catch(() => {
      // Token refresh failed — the current token is still valid for up to 10 more minutes.
      // The next interval will retry.
    });
  }, REFRESH_INTERVAL_MS);
  timer.unref?.(); // Don't prevent Node.js from exiting

  const handle: GitHubAuthHandle = {
    stop() {
      clearInterval(timer);
    },
    async refresh() {
      await pushToken();
    },
  };

  // Auto-stop when the client is destroyed
  client.onCleanup(() => handle.stop());

  return handle;
}

// --- Internal helpers ---

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64url(signer.sign(privateKeyPem));

  return `${signingInput}.${signature}`;
}

interface InstallationTokenScope {
  repositories?: string[];
  repositoryIds?: number[];
  permissions?: Record<string, string>;
}

async function getInstallationToken(
  jwt: string,
  installationId: string,
  scope: InstallationTokenScope = {},
): Promise<string> {
  const body: Record<string, unknown> = {};
  if (scope.repositories) body.repositories = scope.repositories;
  if (scope.repositoryIds) body.repository_ids = scope.repositoryIds;
  if (scope.permissions) body.permissions = scope.permissions;
  const hasBody = Object.keys(body).length > 0;

  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ecs-sandbox',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}
