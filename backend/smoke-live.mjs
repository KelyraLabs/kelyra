const baseUrl = (process.env.KELYRA_SMOKE_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const accessCode = process.env.KELYRA_SMOKE_ACCESS_CODE || 'dev-kelyra';
const pollSeconds = Number(process.env.KELYRA_SMOKE_POLL_SECONDS || 12);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok || body?.ok === false) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return { response, body };
}

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('Login did not set a session cookie.');
  return cookie.split(';')[0];
}

async function main() {
  console.log(`Smoke target: ${baseUrl}`);

  const health = await request('/api/health');
  console.log(`Health: ${health.body.service} ${health.body.environment} runner=${health.body.runnerMode}`);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ accessCode }),
  });
  const cookie = cookieFrom(login.response);
  console.log('Auth: access-code session ok');

  const app = await request('/api/apps/build', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ prompt: 'Build a smoke-test Base token tracker with Pulse lanes' }),
  });
  console.log(`Forge: ${app.body.app.slug}`);

  await request(app.body.app.previewUrl, { headers: { cookie } });
  console.log('Preview: sandbox html ok');

  const job = await request('/api/proof/jobs', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ prompt: 'Create hosted smoke proof', workspaceRef: 'smoke-live' }),
  });
  console.log(`Proof job: ${job.body.job.id} status=${job.body.job.status}`);

  const deadline = Date.now() + pollSeconds * 1000;
  let latest = job.body.job;
  while (Date.now() < deadline) {
    const loaded = await request(`/api/proof/jobs/${job.body.job.id}`, {
      headers: { cookie },
    });
    latest = loaded.body.job;
    if (['completed', 'failed', 'blocked'].includes(latest.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`Proof final: ${latest.status}${latest.receiptId ? ` receipt=${latest.receiptId}` : ''}`);
  if (health.body.runnerMode === 'hosted-worker' && latest.status !== 'completed') {
    throw new Error(`Expected hosted-worker to complete the proof job, got ${latest.status}`);
  }

  const data = await request('/api/data', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ type: 'workspace.context' }),
  });
  console.log(`Bridge: ${data.body.payload.jobs.length} jobs, ${data.body.payload.receipts.length} receipts`);
  console.log('Smoke live passed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
