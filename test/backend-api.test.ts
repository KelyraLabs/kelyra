import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function startApi(options: {
  runnerMode?: string;
  env?: Record<string, string>;
  tokenHolderStatus?: (config: any, address: string) => Promise<any>;
} = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-api-'));
  const { createKelyraApiServer } = await import('../backend/server.mjs');
	  const { server, store } = createKelyraApiServer({
	    env: {
      NODE_ENV: 'test',
      KELYRA_API_SECRET: 'test-kelyra-api-secret-with-enough-length',
      KELYRA_ACCESS_CODE_SHA256: hash('test-access'),
      KELYRA_ALLOWED_ORIGINS: 'http://127.0.0.1:4340',
	      KELYRA_STORE_DIR: tempDir,
	      KELYRA_RUNNER_MODE: options.runnerMode || 'queue-only',
	      ...(options.env || {}),
	    },
	    tokenHolderStatus: options.tokenHolderStatus,
	  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:4340',
    },
    body: JSON.stringify({ accessCode: 'test-access' }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie?.includes('kelyra_session='));
  return cookie;
}

describe('Kelyra hosted API', () => {
  it('exposes health without authentication', async () => {
    const api = await startApi();
    try {
      const response = await fetch(`${api.baseUrl}/api/health`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.service, 'kelyra-api');
      assert.equal(body.runnerMode, 'queue-only');
    } finally {
      await api.close();
    }
  });

  it('exposes public tier configuration from the backend', async () => {
    const api = await startApi();
    try {
      const response = await fetch(`${api.baseUrl}/api/tiers`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.schema, 'kelyra.tiers.v1');
      assert.equal(body.enforced, true);
      assert.equal(body.tiers.length, 4);
      assert.equal(body.internalTiers, undefined);
      assert.equal(body.accessCodeTierId, undefined);
      assert.ok(body.tiers.some((tier: any) => tier.id === 'basic' && tier.tokenMinimum === '5000000'));
      assert.ok(body.tiers.some((tier: any) => tier.id === 'basic' && tier.freshDailyQuota.buildActions === 1));
      assert.ok(body.tiers.some((tier: any) => tier.id === 'ultimate' && tier.tokenMinimum === '1000000000'));
      assert.ok(body.quotaTypes.some((type: any) => type.id === 'buildActions'));
      assert.equal(body.gate.tokenGate.thresholds[0].tierId, 'basic');
      assert.equal(body.gate.accessCodeBeta, true);
    } finally {
      await api.close();
    }
  });

  it('can disable access-code beta without exposing the fallback in public config', async () => {
    const api = await startApi({ env: { KELYRA_ACCESS_CODE_ENABLED: 'false' } });
    try {
      const tiers = await fetch(`${api.baseUrl}/api/tiers`);
      const tiersBody = await tiers.json();
      assert.equal(tiers.status, 200);
      assert.equal(tiersBody.gate.accessCodeBeta, false);

      const login = await fetch(`${api.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ accessCode: 'test-access' }),
      });
      const loginBody = await login.json();
      assert.equal(login.status, 403);
      assert.equal(loginBody.error, 'ACCESS_CODE_DISABLED');
    } finally {
      await api.close();
    }
  });

  it('does not require an access-code hash when beta codes are disabled in production config', async () => {
    const { loadConfig } = await import('../backend/server.mjs');
    const config = loadConfig({
      NODE_ENV: 'production',
      KELYRA_API_SECRET: 'production-kelyra-api-secret-with-enough-length',
      KELYRA_ACCESS_CODE_ENABLED: 'false',
      KELYRA_ALLOWED_ORIGINS: 'https://kelyra.example',
      KELYRA_STORE_DIR: '/tmp/kelyra-disabled-access-code-test',
    });
    assert.equal(config.accessCodeEnabled, false);
    assert.equal(config.accessCodeHash, '');
  });

  it('supports wallet nonce login without requiring token gate by default', async () => {
    const api = await startApi();
    try {
      const account = privateKeyToAccount(generatePrivateKey());
      const nonce = await fetch(`${api.baseUrl}/api/auth/wallet/nonce`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ address: account.address }),
      });
      const nonceBody = await nonce.json();
      assert.equal(nonce.status, 200);
      assert.equal(nonceBody.ok, true);
      assert.match(nonceBody.message, /Nonce:/);

      const signature = await account.signMessage({ message: nonceBody.message });
      const verified = await fetch(`${api.baseUrl}/api/auth/wallet/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({
          address: account.address,
          message: nonceBody.message,
          signature,
        }),
      });
      const verifiedBody = await verified.json();
      assert.equal(verified.status, 200);
      assert.equal(verifiedBody.ok, true);
      assert.equal(verifiedBody.wallet.address, account.address.toLowerCase());

      const cookie = verified.headers.get('set-cookie');
      assert.ok(cookie?.includes('kelyra_session='));
      const session = await fetch(`${api.baseUrl}/api/auth/session`, {
        headers: { cookie },
      });
      const sessionBody = await session.json();
      assert.equal(sessionBody.authenticated, true);
      assert.equal(sessionBody.session.authMode, 'wallet');
      assert.equal(sessionBody.session.sub, `wallet:${account.address.toLowerCase()}`);
    } finally {
      await api.close();
    }
  });

  it('assigns wallet tiers from token-holder balance metadata', async () => {
    const api = await startApi({
      env: {
        KELYRA_REQUIRE_TOKEN_HOLDER: 'true',
        KELYRA_TOKEN_ADDRESS: '0x4200000000000000000000000000000000000006',
        KELYRA_PRO_BUILD_DAILY: '1',
      },
      tokenHolderStatus: async (config) => ({
        required: true,
        ok: true,
        chainId: 8453,
        tokenAddress: config.tokenAddress,
        symbol: 'KELYRA',
        decimals: 18,
        balance: '120000000000000000000000000',
        balanceFormatted: '120,000,000',
        minimum: '5000000000000000000000000',
        minimumFormatted: '5,000,000 KELYRA',
        thresholds: [
          { tierId: 'basic', tierName: 'Basic', tokenMinimum: '5000000', label: '5,000,000 KELYRA' },
          { tierId: 'core', tierName: 'Core', tokenMinimum: '50000000', label: '50,000,000 KELYRA' },
          { tierId: 'pro', tierName: 'Pro', tokenMinimum: '100000000', label: '100,000,000 KELYRA' },
          { tierId: 'ultimate', tierName: 'Ultimate', tokenMinimum: '1000000000', label: '1,000,000,000 KELYRA' },
        ],
        tierId: 'pro',
        tierName: 'Pro',
        tierMinimum: '100,000,000 KELYRA',
        quotaMode: 'full',
      }),
    });
    try {
      const account = privateKeyToAccount(generatePrivateKey());
      const nonce = await fetch(`${api.baseUrl}/api/auth/wallet/nonce`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ address: account.address }),
      });
      const nonceBody = await nonce.json();
      assert.equal(nonce.status, 200);
      assert.equal(nonceBody.tokenGate.thresholds.length, 4);

      const signature = await account.signMessage({ message: nonceBody.message });
      const verified = await fetch(`${api.baseUrl}/api/auth/wallet/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({
          address: account.address,
          message: nonceBody.message,
          signature,
        }),
      });
      const verifiedBody = await verified.json();
      assert.equal(verified.status, 200);
      assert.equal(verifiedBody.tier.id, 'pro');
      assert.equal(verifiedBody.tokenGate.tierId, 'pro');

      const cookie = verified.headers.get('set-cookie') || '';
      const session = await fetch(`${api.baseUrl}/api/auth/session`, {
        headers: { cookie },
      });
      const sessionBody = await session.json();
      assert.equal(sessionBody.session.tierId, 'pro');

      const created = await fetch(`${api.baseUrl}/api/apps/build`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Build a holder-tier proof dashboard' }),
      });
      assert.equal(created.status, 201);
      assert.equal(created.headers.get('x-kelyra-quota-tier'), 'pro');
      assert.equal(created.headers.get('x-kelyra-quota-mode'), 'full');
      assert.equal(created.headers.get('x-kelyra-quota-remaining'), '0');
    } finally {
      await api.close();
    }
  });

  it('reports active quota profile without exposing internal tiers publicly', async () => {
    const api = await startApi();
    try {
      const publicProfile = await fetch(`${api.baseUrl}/api/quota/profile`);
      const publicBody = await publicProfile.json();
      assert.equal(publicProfile.status, 200);
      assert.equal(publicBody.ok, true);
      assert.equal(publicBody.tier.id, 'basic');
      assert.equal(publicBody.quotaMode, 'full');
      assert.equal(publicBody.quotas.active.buildActions, 3);

      const cookie = await login(api.baseUrl);
      const privateProfile = await fetch(`${api.baseUrl}/api/quota/profile`, {
        headers: { cookie },
      });
      const privateBody = await privateProfile.json();
      assert.equal(privateProfile.status, 200);
      assert.equal(privateBody.tier.id, 'operator');
      assert.equal(privateBody.tier.access, 'Internal access');
      assert.equal(privateBody.quotas.active.buildActions, 120);
    } finally {
      await api.close();
    }
  });

  it('uses fresh holder quota until a previous UTC snapshot qualifies for the same tier', async () => {
    const api = await startApi({
      env: {
        KELYRA_REQUIRE_TOKEN_HOLDER: 'true',
        KELYRA_TOKEN_ADDRESS: '0x4200000000000000000000000000000000000006',
        KELYRA_PRO_BUILD_DAILY: '3',
        KELYRA_PRO_FRESH_BUILD_DAILY: '1',
      },
      tokenHolderStatus: async (config) => ({
        required: true,
        ok: true,
        chainId: 8453,
        tokenAddress: config.tokenAddress,
        symbol: 'KELYRA',
        decimals: 18,
        balance: '120000000000000000000000000',
        balanceFormatted: '120,000,000',
        minimum: '5000000000000000000000000',
        minimumFormatted: '5,000,000 KELYRA',
        thresholds: [],
        tierId: 'pro',
        tierName: 'Pro',
        tierMinimum: '100,000,000 KELYRA',
      }),
    });
    try {
      const account = privateKeyToAccount(generatePrivateKey());
      const nonce = await fetch(`${api.baseUrl}/api/auth/wallet/nonce`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ address: account.address }),
      });
      const nonceBody = await nonce.json();
      const signature = await account.signMessage({ message: nonceBody.message });
      const verified = await fetch(`${api.baseUrl}/api/auth/wallet/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({
          address: account.address,
          message: nonceBody.message,
          signature,
        }),
      });
      const verifiedBody = await verified.json();
      assert.equal(verified.status, 200);
      assert.equal(verifiedBody.tokenGate.quotaMode, 'fresh');

      const cookie = verified.headers.get('set-cookie') || '';
      const profile = await fetch(`${api.baseUrl}/api/quota/profile`, {
        headers: { cookie },
      });
      const profileBody = await profile.json();
      assert.equal(profileBody.quotaMode, 'fresh');
      assert.equal(profileBody.quotas.active.buildActions, 1);

      const created = await fetch(`${api.baseUrl}/api/apps/build`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Build a fresh holder quota dashboard' }),
      });
      assert.equal(created.status, 201);
      assert.equal(created.headers.get('x-kelyra-quota-mode'), 'fresh');
      assert.equal(created.headers.get('x-kelyra-quota-limit'), '1');
    } finally {
      await api.close();
    }
  });

  it('requires auth for proof jobs and accepts an authenticated queued job', async () => {
    const api = await startApi();
    try {
      const denied = await fetch(`${api.baseUrl}/api/proof/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Create proof' }),
      });
      assert.equal(denied.status, 401);

      const cookie = await login(api.baseUrl);

      const created = await fetch(`${api.baseUrl}/api/proof/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Create proof', workspaceRef: 'repo:demo' }),
      });
      const createdBody = await created.json();
      assert.equal(created.status, 202);
      assert.equal(createdBody.ok, true);
      assert.equal(createdBody.job.status, 'queued');

      const loaded = await fetch(`${api.baseUrl}/api/proof/jobs/${createdBody.job.id}`, {
        headers: { cookie },
      });
      const loadedBody = await loaded.json();
      assert.equal(loaded.status, 200);
      assert.equal(loadedBody.job.id, createdBody.job.id);
    } finally {
      await api.close();
    }
  });

  it('lets the hosted worker complete queued proof jobs and write receipts', async () => {
    const api = await startApi({ runnerMode: 'hosted-worker' });
    try {
      const { runProofWorkerOnce } = await import('../backend/server.mjs');
      const cookie = await login(api.baseUrl);

      const created = await fetch(`${api.baseUrl}/api/proof/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Create hosted proof', workspaceRef: 'repo:demo' }),
      });
      const createdBody = await created.json();
      assert.equal(created.status, 202);
      assert.equal(createdBody.job.status, 'queued');

      const processed = await runProofWorkerOnce(api.store, { workerId: 'test-worker' });
      assert.equal(processed.ok, true);
      assert.equal(processed.processed, true);
      assert.equal(processed.job.status, 'completed');
      assert.ok(processed.receipt.id.startsWith('hosted-'));

      const loaded = await fetch(`${api.baseUrl}/api/proof/jobs/${createdBody.job.id}`, {
        headers: { cookie },
      });
      const loadedBody = await loaded.json();
      assert.equal(loadedBody.job.status, 'completed');
      assert.equal(loadedBody.job.receiptId, processed.receipt.id);

      const receipts = await fetch(`${api.baseUrl}/api/receipts`, {
        headers: { cookie },
      });
      const receiptsBody = await receipts.json();
      assert.equal(receipts.status, 200);
      assert.equal(receiptsBody.receipts[0].id, processed.receipt.id);
    } finally {
      await api.close();
    }
  });

  it('serves the public console from the hosted backend', async () => {
    const api = await startApi();
    try {
      const response = await fetch(`${api.baseUrl}/console.html`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
      assert.match(body, /Kelyra Console/);
    } finally {
      await api.close();
    }
  });

  it('builds hosted Forge drafts and exposes a sandbox preview', async () => {
    const api = await startApi();
    try {
      const cookie = await login(api.baseUrl);

      const denied = await fetch(`${api.baseUrl}/api/apps`);
      assert.equal(denied.status, 401);

      const created = await fetch(`${api.baseUrl}/api/apps/build`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Build a Base token tracker with Pulse lanes' }),
      });
      const createdBody = await created.json();
      assert.equal(created.status, 201);
      assert.equal(createdBody.ok, true);
      assert.equal(createdBody.app.kind, 'market-dashboard');
      assert.equal(createdBody.app.assets, undefined);
      assert.equal(createdBody.app.version, 1);
      assert.ok(createdBody.app.files.some((file: any) => file.path === 'app.js'));
      assert.ok(createdBody.app.files.some((file: any) => file.path === 'styles.css'));
      assert.ok(createdBody.app.previewUrl.includes('/api/apps/'));
      assert.ok(createdBody.job.id.startsWith('job_'));

      const listed = await fetch(`${api.baseUrl}/api/apps`, {
        headers: { cookie },
      });
      const listedBody = await listed.json();
      assert.equal(listed.status, 200);
      assert.equal(listedBody.apps.length, 1);
      assert.equal(listedBody.apps[0].slug, createdBody.app.slug);

      const preview = await fetch(`${api.baseUrl}${createdBody.app.previewUrl}`, {
        headers: { cookie },
      });
      const previewBody = await preview.text();
      assert.equal(preview.status, 200);
      assert.match(previewBody, /window\.kelyraQuery/);
      assert.match(previewBody, /Run bridge query/);

      const asset = await fetch(`${api.baseUrl}/api/apps/${createdBody.app.slug}/assets/manifest.json`, {
        headers: { cookie },
      });
      const assetBody = await asset.json();
      assert.equal(asset.status, 200);
      assert.equal(assetBody.slug, createdBody.app.slug);

      const updated = await fetch(`${api.baseUrl}/api/apps/${createdBody.app.slug}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ prompt: 'Revise into a proof workspace with receipt timeline' }),
      });
      const updatedBody = await updated.json();
      assert.equal(updated.status, 200);
      assert.equal(updatedBody.app.slug, createdBody.app.slug);
      assert.equal(updatedBody.app.version, 2);
      assert.equal(updatedBody.app.kind, 'proof-workspace');

      const published = await fetch(`${api.baseUrl}/api/apps/${createdBody.app.slug}/publish`, {
        method: 'POST',
        headers: { cookie, origin: 'http://127.0.0.1:4340' },
      });
      const publishedBody = await published.json();
      assert.equal(published.status, 200);
      assert.equal(publishedBody.app.status, 'published');

      const deleted = await fetch(`${api.baseUrl}/api/apps/${createdBody.app.slug}`, {
        method: 'DELETE',
        headers: { cookie, origin: 'http://127.0.0.1:4340' },
      });
      assert.equal(deleted.status, 200);
    } finally {
      await api.close();
    }
  });

  it('enforces the daily Forge build quota for authenticated access-code sessions', async () => {
    const api = await startApi({ env: { KELYRA_OPERATOR_BUILD_DAILY: '1' } });
    try {
      const cookie = await login(api.baseUrl);
      const headers = {
        'content-type': 'application/json',
        cookie,
        origin: 'http://127.0.0.1:4340',
      };

      const first = await fetch(`${api.baseUrl}/api/apps/build`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: 'Build one small proof dashboard' }),
      });
      assert.equal(first.status, 201);
      assert.equal(first.headers.get('x-kelyra-quota-key'), 'buildActions');
      assert.equal(first.headers.get('x-kelyra-quota-tier'), 'operator');
      assert.equal(first.headers.get('x-kelyra-quota-mode'), 'full');
      assert.equal(first.headers.get('x-kelyra-quota-remaining'), '0');

      const second = await fetch(`${api.baseUrl}/api/apps/build`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: 'Build another proof dashboard' }),
      });
      const secondBody = await second.json();
      assert.equal(second.status, 429);
      assert.equal(secondBody.error, 'QUOTA_EXCEEDED');
      assert.equal(secondBody.quota.tierId, 'operator');
      assert.equal(secondBody.quota.quotaKey, 'buildActions');
    } finally {
      await api.close();
    }
  });

  it('requires auth for hosted bridge data and returns workspace context', async () => {
    const api = await startApi();
    try {
      const denied = await fetch(`${api.baseUrl}/api/data`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'workspace.context' }),
      });
      assert.equal(denied.status, 401);

      const cookie = await login(api.baseUrl);
      const response = await fetch(`${api.baseUrl}/api/data`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: 'http://127.0.0.1:4340',
        },
        body: JSON.stringify({ type: 'workspace.context' }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.payload.mode, 'hosted');
      assert.equal(body.payload.runnerMode, 'queue-only');
    } finally {
      await api.close();
    }
  });

  it('rejects mutating requests from unapproved origins', async () => {
    const api = await startApi();
    try {
      const response = await fetch(`${api.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
        },
        body: JSON.stringify({ accessCode: 'test-access' }),
      });
      const body = await response.json();
      assert.equal(response.status, 403);
      assert.equal(body.error, 'ORIGIN_NOT_ALLOWED');
    } finally {
      await api.close();
    }
  });
});
