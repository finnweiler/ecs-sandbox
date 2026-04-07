/**
 * Basic example — connect to a locally running sandbox container.
 *
 * Start the sandbox first:
 *   docker run -p 3000:3000 ecs-sandbox
 *
 * Then run this:
 *   npx tsx examples/basic.ts
 */
import { SandboxClient } from '@ecs-sandbox/sdk';

async function main() {
  const sandbox = new SandboxClient('http://localhost:3000');

  // Health check
  const health = await sandbox.health();
  console.log('Sandbox healthy:', health);

  // Execute a command
  const result = await sandbox.exec('echo "Hello from ecs-sandbox!"');
  console.log('stdout:', result.stdout);
  console.log('exitCode:', result.exitCode);
  console.log('duration:', result.durationMs, 'ms');

  // Clone a repo
  const clone = await sandbox.exec('git clone https://github.com/octocat/Hello-World.git /workspace/hello');
  console.log('Clone exit code:', clone.exitCode);

  // List files
  const dir = await sandbox.files.read('/workspace/hello');
  console.log('Files:', dir);

  // Read a file
  const readme = await sandbox.files.read('/workspace/hello/README');
  console.log('README:', readme);

  // Write a file
  await sandbox.files.write('/workspace/output.txt', 'Agent was here.');
  const written = await sandbox.files.read('/workspace/output.txt');
  console.log('Written:', written);

  // Stream a long-running command
  console.log('\n--- Streaming ---');
  await sandbox.execStream('for i in 1 2 3 4 5; do echo "step $i"; sleep 0.5; done', (event) => {
    if (event.type === 'stdout') process.stdout.write(event.data ?? '');
    if (event.type === 'exit') console.log(`\nDone (exit ${event.exitCode}, ${event.durationMs}ms)`);
  });
}

main().catch(console.error);
