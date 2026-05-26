import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStore, loadConfig, runProofWorkerOnce } from './server.mjs';

const config = loadConfig();
const store = createStore(config);
const workerId = process.env.KELYRA_WORKER_ID || `worker_${randomBytes(6).toString('hex')}`;
const intervalMs = Number(process.env.KELYRA_WORKER_INTERVAL_MS || 2500);
let stopping = false;

process.once('SIGINT', () => {
  stopping = true;
});

process.once('SIGTERM', () => {
  stopping = true;
});

console.log(`Kelyra worker starting as ${workerId}`);
console.log(`Runner mode: ${config.runnerMode}`);
console.log(`Store: ${config.databaseUrl ? 'postgres' : 'file'}`);

if (config.runnerMode !== 'hosted-worker') {
  console.log('No jobs will be processed until KELYRA_RUNNER_MODE=hosted-worker.');
}

while (!stopping) {
  try {
    const result = await runProofWorkerOnce(store, { workerId });
    if (result.processed) {
      const state = result.ok ? 'completed' : 'failed';
      console.log(`${state} ${result.job.id}`);
    } else {
      await sleep(intervalMs);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    await sleep(intervalMs);
  }
}

await store.close?.();
console.log('Kelyra worker stopped.');
