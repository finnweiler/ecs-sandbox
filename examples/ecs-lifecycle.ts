/**
 * ECS example — spin up isolated sandboxes per project on Fargate.
 *
 * Prerequisites:
 *   - ECS cluster with Fargate capacity
 *   - Task definition registered with the sandbox container image
 *   - VPC with private subnets
 *   - Security group allowing inbound on port 3000 from your agent
 *   - (Optional) Cloud Map namespace for service discovery
 *
 * Run:
 *   npx tsx examples/ecs-lifecycle.ts
 */
import { EcsSandboxManager } from '@ecs-sandbox/sdk';

async function main() {
  const manager = new EcsSandboxManager({
    cluster: 'my-agent-cluster',
    taskDefinition: 'ecs-sandbox-task',
    subnets: ['subnet-abc123', 'subnet-def456'],
    securityGroups: ['sg-sandbox-access'],
    namespace: 'sandboxes.local', // Optional: Cloud Map
  });

  try {
    // Spin up sandboxes for two projects in parallel
    console.log('Creating sandboxes...');
    const [sandboxA, sandboxB] = await Promise.all([
      manager.create('project-alpha'),
      manager.create('project-beta'),
    ]);

    console.log('Sandboxes ready:', manager.list());

    // Work on project A
    await sandboxA.exec('git clone https://github.com/org/project-alpha.git /workspace/repo');
    await sandboxA.exec('cd /workspace/repo && npm install');
    const testResult = await sandboxA.exec('cd /workspace/repo && npm test');
    console.log('Project Alpha tests:', testResult.exitCode === 0 ? 'PASSED' : 'FAILED');

    // Work on project B simultaneously
    await sandboxB.exec('git clone https://github.com/org/project-beta.git /workspace/repo');
    const lintResult = await sandboxB.exec('cd /workspace/repo && npm run lint');
    console.log('Project Beta lint:', lintResult.exitCode === 0 ? 'PASSED' : 'FAILED');

    // Retrieve a sandbox by ID later
    const alphaAgain = manager.get('project-alpha');
    const status = await alphaAgain.exec('cd /workspace/repo && git status');
    console.log('Alpha git status:', status.stdout);
  } finally {
    // Clean up all sandboxes
    console.log('Destroying all sandboxes...');
    await manager.destroyAll();
    console.log('Done.');
  }
}

main().catch(console.error);
