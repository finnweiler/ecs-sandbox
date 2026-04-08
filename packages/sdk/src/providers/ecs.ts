import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  type KeyValuePair,
} from '@aws-sdk/client-ecs';
import {
  ServiceDiscoveryClient,
  DiscoverInstancesCommand,
} from '@aws-sdk/client-servicediscovery';
import { SandboxClient, type SandboxClientOptions } from '../core/client.js';
import type { SandboxInfo } from '../core/types.js';

export interface EcsSandboxManagerConfig {
  /** ECS cluster name or ARN */
  cluster: string;
  /** Task definition family or ARN */
  taskDefinition: string;
  /** VPC subnets for Fargate tasks */
  subnets: string[];
  /** Security groups for Fargate tasks */
  securityGroups: string[];
  /** Cloud Map namespace for service discovery (e.g. "sandboxes.local") */
  namespace?: string;
  /** Cloud Map service name (default: "sandbox") */
  serviceName?: string;
  /** Container name within the task definition (default: "sandbox") */
  containerName?: string;
  /** Container port (default: 3000) */
  containerPort?: number;
  /** Assign public IP (default: false — use private VPC networking) */
  assignPublicIp?: boolean;
  /** Additional environment variables to inject into sandbox containers */
  defaultEnv?: Record<string, string>;
  /** Options passed to SandboxClient instances */
  clientOptions?: SandboxClientOptions;
  /** AWS region override */
  region?: string;
  /** Timeout in ms to wait for sandbox to become healthy (default: 120000) */
  healthCheckTimeout?: number;
}

export class EcsSandboxManager {
  private ecs: ECSClient;
  private sd: ServiceDiscoveryClient | null;
  private config: EcsSandboxManagerConfig;
  private sandboxes = new Map<string, { taskArn: string; client: SandboxClient }>();

  constructor(config: EcsSandboxManagerConfig) {
    this.config = {
      containerName: 'sandbox',
      containerPort: 3000,
      assignPublicIp: false,
      serviceName: 'sandbox',
      healthCheckTimeout: 120_000,
      ...config,
    };

    const awsConfig = config.region ? { region: config.region } : {};
    this.ecs = new ECSClient(awsConfig);
    this.sd = config.namespace
      ? new ServiceDiscoveryClient(awsConfig)
      : null;
  }

  /**
   * Create a new sandbox for a given project/identifier.
   * Spins up a Fargate task and waits for it to become healthy.
   */
  async create(
    sandboxId: string,
    options?: {
      env?: Record<string, string>;
      taskDefinition?: string;
      /** If true, reuse an existing sandbox with this ID instead of failing */
      reuse?: boolean;
    },
  ): Promise<SandboxClient> {
    // Check if a task with this sandbox ID is already running in ECS
    const existing = await this.findTask(sandboxId);
    if (existing) {
      if (!options?.reuse) {
        throw new Error(`Sandbox "${sandboxId}" already exists. Destroy it first or pass { reuse: true }.`);
      }
      const ip = await this.getTaskIp(existing);
      const url = `http://${ip}:${this.config.containerPort}`;
      const client = new SandboxClient(url, this.config.clientOptions);
      await client.waitForReady(10_000);
      this.sandboxes.set(sandboxId, { taskArn: existing, client });
      return client;
    }

    const envOverrides: KeyValuePair[] = [
      ...Object.entries(this.config.defaultEnv ?? {}).map(([name, value]) => ({ name, value })),
      ...Object.entries(options?.env ?? {}).map(([name, value]) => ({ name, value })),
      { name: 'SANDBOX_ID', value: sandboxId },
    ];

    const result = await this.ecs.send(
      new RunTaskCommand({
        cluster: this.config.cluster,
        taskDefinition: options?.taskDefinition ?? this.config.taskDefinition,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: this.config.subnets,
            securityGroups: this.config.securityGroups,
            assignPublicIp: this.config.assignPublicIp ? 'ENABLED' : 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: this.config.containerName,
              environment: envOverrides,
            },
          ],
        },
        tags: [
          { key: 'ecs-sandbox', value: 'true' },
          { key: 'ecs-sandbox:id', value: sandboxId },
        ],
        enableExecuteCommand: false,
        propagateTags: 'TASK_DEFINITION',
      }),
    );

    const taskArn = result.tasks?.[0]?.taskArn;
    if (!taskArn) {
      const reason = result.failures?.[0]?.reason ?? 'Unknown failure';
      throw new Error(`Failed to start sandbox task: ${reason}`);
    }

    // Wait for task to reach RUNNING state
    const taskIp = await this.waitForTask(taskArn);
    const url = `http://${taskIp}:${this.config.containerPort}`;
    const client = new SandboxClient(url, this.config.clientOptions);

    // Wait for the server inside to be healthy
    await client.waitForReady(this.config.healthCheckTimeout);

    this.sandboxes.set(sandboxId, { taskArn, client });
    return client;
  }

  /**
   * Get an existing sandbox client by ID.
   */
  get(sandboxId: string): SandboxClient {
    const entry = this.sandboxes.get(sandboxId);
    if (!entry) {
      throw new Error(`Sandbox "${sandboxId}" not found. Create it first.`);
    }
    return entry.client;
  }

  /**
   * Destroy a sandbox — stops the ECS task.
   */
  async destroy(sandboxId: string): Promise<void> {
    const entry = this.sandboxes.get(sandboxId);
    if (!entry) {
      throw new Error(`Sandbox "${sandboxId}" not found.`);
    }

    entry.client.destroy();

    await this.ecs.send(
      new StopTaskCommand({
        cluster: this.config.cluster,
        task: entry.taskArn,
        reason: `Sandbox "${sandboxId}" destroyed by ecs-sandbox manager`,
      }),
    );

    this.sandboxes.delete(sandboxId);
  }

  /**
   * Destroy all managed sandboxes.
   */
  async destroyAll(): Promise<void> {
    const ids = [...this.sandboxes.keys()];
    await Promise.allSettled(ids.map((id) => this.destroy(id)));
  }

  /**
   * List all managed sandboxes.
   */
  list(): SandboxInfo[] {
    return [...this.sandboxes.entries()].map(([id, entry]) => ({
      id,
      url: entry.client['baseUrl'],
      status: 'running' as const,
    }));
  }

  /**
   * Reconnect to an existing sandbox by discovering its IP via Cloud Map or task description.
   */
  async connect(sandboxId: string, taskArn?: string): Promise<SandboxClient> {
    let url: string;

    if (this.sd && this.config.namespace) {
      // Try Cloud Map first
      url = await this.discoverViaSd(sandboxId);
    } else if (taskArn) {
      // Fall back to describing the task
      const ip = await this.getTaskIp(taskArn);
      url = `http://${ip}:${this.config.containerPort}`;
    } else {
      throw new Error(
        'Cannot connect: provide either a Cloud Map namespace or a taskArn.',
      );
    }

    const client = new SandboxClient(url, this.config.clientOptions);
    await client.waitForReady(10_000);
    this.sandboxes.set(sandboxId, { taskArn: taskArn ?? 'unknown', client });
    return client;
  }

  // --- Private helpers ---

  private async waitForTask(taskArn: string, timeoutMs = 120_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const ip = await this.getTaskIp(taskArn).catch(() => null);
      if (ip) return ip;
      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error(`Task ${taskArn} did not reach RUNNING state within ${timeoutMs}ms`);
  }

  private async getTaskIp(taskArn: string): Promise<string> {
    const result = await this.ecs.send(
      new DescribeTasksCommand({
        cluster: this.config.cluster,
        tasks: [taskArn],
      }),
    );

    const task = result.tasks?.[0];
    if (!task) throw new Error(`Task ${taskArn} not found`);

    if (task.lastStatus !== 'RUNNING') {
      throw new Error(`Task is ${task.lastStatus}, not RUNNING`);
    }

    // Find the ENI attachment and extract private IP
    const eniAttachment = task.attachments?.find((a) => a.type === 'ElasticNetworkInterface');
    const privateIp = eniAttachment?.details?.find((d) => d.name === 'privateIPv4Address')?.value;

    if (!privateIp) {
      throw new Error('Could not determine task private IP');
    }

    return privateIp;
  }

  /**
   * Find a running ECS task tagged with the given sandbox ID.
   */
  private async findTask(sandboxId: string): Promise<string | null> {
    const listResult = await this.ecs.send(
      new ListTasksCommand({
        cluster: this.config.cluster,
        desiredStatus: 'RUNNING',
      }),
    );

    const taskArns = listResult.taskArns;
    if (!taskArns || taskArns.length === 0) return null;

    const descResult = await this.ecs.send(
      new DescribeTasksCommand({
        cluster: this.config.cluster,
        tasks: taskArns,
        include: ['TAGS'],
      }),
    );

    const match = descResult.tasks?.find((task) =>
      task.tags?.some((tag) => tag.key === 'ecs-sandbox:id' && tag.value === sandboxId),
    );

    return match?.taskArn ?? null;
  }

  private async discoverViaSd(sandboxId: string): Promise<string> {
    if (!this.sd || !this.config.namespace) {
      throw new Error('Service discovery not configured');
    }

    const result = await this.sd.send(
      new DiscoverInstancesCommand({
        NamespaceName: this.config.namespace,
        ServiceName: this.config.serviceName,
        QueryParameters: { SANDBOX_ID: sandboxId },
      }),
    );

    const instance = result.Instances?.[0];
    const ip = instance?.Attributes?.['AWS_INSTANCE_IPV4'];
    if (!ip) {
      throw new Error(`Sandbox "${sandboxId}" not found via service discovery`);
    }

    return `http://${ip}:${this.config.containerPort}`;
  }
}
