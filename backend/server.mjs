import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, parseUnits, verifyMessage } from 'viem';
import { base } from 'viem/chains';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = resolve(moduleDir, '..');
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_DEV_ORIGINS = ['http://127.0.0.1:4340', 'http://localhost:4340'];
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEXSCREENER_BASE = 'https://api.dexscreener.com';
const DEX_CACHE_TTL_MS = 120_000;
const EXPLORER_CACHE_TTL_MS = 180_000;
const KELYRA_REFERENCE_TOKEN_ADDRESS = '0x4200000000000000000000000000000000000006';
const BASE_CHAIN_ID = 8453;
const dexCache = new Map();
const explorerCache = new Map();
const QUOTA_KEYS = ['oracleMessages', 'dataCalls', 'buildActions', 'proofJobs'];

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
]);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function numericEnv(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function buildTierConfig(env, rateLimitPerMinute) {
  const tokenSymbol = env.KELYRA_TIER_TOKEN_SYMBOL || 'KELYRA';
  const basicTokenMinimum = env.KELYRA_BASIC_TOKEN_MIN || '5000000';
  const coreTokenMinimum = env.KELYRA_CORE_TOKEN_MIN || '50000000';
  const proTokenMinimum = env.KELYRA_PRO_TOKEN_MIN || '100000000';
  const ultimateTokenMinimum = env.KELYRA_ULTIMATE_TOKEN_MIN || '1000000000';
  const operatorQuota = {
    oracleMessages: numericEnv(env, 'KELYRA_OPERATOR_ORACLE_DAILY', 500),
    dataCalls: numericEnv(env, 'KELYRA_OPERATOR_DATA_DAILY', 5000),
    buildActions: numericEnv(env, 'KELYRA_OPERATOR_BUILD_DAILY', 120),
    proofJobs: numericEnv(env, 'KELYRA_OPERATOR_PROOF_DAILY', 250),
  };

  const config = {
    schema: 'kelyra.tiers.v1',
    quotaWindow: 'UTC day',
    defaultTierId: env.KELYRA_DEFAULT_TIER_ID || 'basic',
    accessCodeTierId: env.KELYRA_ACCESS_CODE_TIER_ID || 'operator',
    anonymousTierId: env.KELYRA_ANONYMOUS_TIER_ID || 'basic',
    token: {
      chainId: BASE_CHAIN_ID,
      symbol: tokenSymbol,
      address: env.KELYRA_TOKEN_ADDRESS || null,
    },
    quotaTypes: [
      {
        id: 'oracleMessages',
        label: 'Oracle messages',
        description: 'Chat, token analysis, market questions, and source-backed follow-up prompts.',
      },
      {
        id: 'dataCalls',
        label: 'Data calls',
        description: 'Live source requests used by Pulse, Oracle, sandboxed Forge apps, and bridge tools.',
      },
      {
        id: 'buildActions',
        label: 'Build actions',
        description: 'Hosted Forge builds and app repair actions that create or update project drafts.',
      },
      {
        id: 'proofJobs',
        label: 'Proof jobs',
        description: 'Hosted proof jobs processed by an isolated worker and recorded as receipts.',
      },
    ],
    safetyLimits: [
      { label: 'Route burst safety', value: `${rateLimitPerMinute} requests per minute per IP/path` },
      { label: 'Pulse cache', value: `${Math.floor(DEX_CACHE_TTL_MS / 1000)} seconds` },
      { label: 'Request body cap', value: `${Math.floor(MAX_BODY_BYTES / 1024)} KB` },
      { label: 'Hosted prompt cap', value: '4,000 characters for Forge build prompts' },
      { label: 'Proof execution boundary', value: 'Hosted worker only, no browser-side filesystem execution' },
    ],
    tiers: [
      {
        id: 'basic',
        name: 'Basic',
        access: `Wallet holding at least ${formatTokenAmount(basicTokenMinimum)} ${tokenSymbol}`,
        minimum: `${formatTokenAmount(basicTokenMinimum)} ${tokenSymbol} minimum`,
        tokenMinimum: basicTokenMinimum,
        dailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_BASIC_ORACLE_DAILY', 25),
          dataCalls: numericEnv(env, 'KELYRA_BASIC_DATA_DAILY', 150),
          buildActions: numericEnv(env, 'KELYRA_BASIC_BUILD_DAILY', 3),
          proofJobs: numericEnv(env, 'KELYRA_BASIC_PROOF_DAILY', 6),
        },
        freshDailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_BASIC_FRESH_ORACLE_DAILY', 15),
          dataCalls: numericEnv(env, 'KELYRA_BASIC_FRESH_DATA_DAILY', 50),
          buildActions: numericEnv(env, 'KELYRA_BASIC_FRESH_BUILD_DAILY', 1),
          proofJobs: numericEnv(env, 'KELYRA_BASIC_FRESH_PROOF_DAILY', 2),
        },
      },
      {
        id: 'core',
        name: 'Core',
        access: `Wallet holding at least ${formatTokenAmount(coreTokenMinimum)} ${tokenSymbol}`,
        minimum: `${formatTokenAmount(coreTokenMinimum)} ${tokenSymbol} minimum`,
        tokenMinimum: coreTokenMinimum,
        dailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_CORE_ORACLE_DAILY', 100),
          dataCalls: numericEnv(env, 'KELYRA_CORE_DATA_DAILY', 400),
          buildActions: numericEnv(env, 'KELYRA_CORE_BUILD_DAILY', 10),
          proofJobs: numericEnv(env, 'KELYRA_CORE_PROOF_DAILY', 25),
        },
        freshDailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_CORE_FRESH_ORACLE_DAILY', 50),
          dataCalls: numericEnv(env, 'KELYRA_CORE_FRESH_DATA_DAILY', 100),
          buildActions: numericEnv(env, 'KELYRA_CORE_FRESH_BUILD_DAILY', 3),
          proofJobs: numericEnv(env, 'KELYRA_CORE_FRESH_PROOF_DAILY', 8),
        },
      },
      {
        id: 'pro',
        name: 'Pro',
        access: `Wallet holding at least ${formatTokenAmount(proTokenMinimum)} ${tokenSymbol}`,
        minimum: `${formatTokenAmount(proTokenMinimum)} ${tokenSymbol} minimum`,
        tokenMinimum: proTokenMinimum,
        dailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_PRO_ORACLE_DAILY', 200),
          dataCalls: numericEnv(env, 'KELYRA_PRO_DATA_DAILY', 800),
          buildActions: numericEnv(env, 'KELYRA_PRO_BUILD_DAILY', 25),
          proofJobs: numericEnv(env, 'KELYRA_PRO_PROOF_DAILY', 80),
        },
        freshDailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_PRO_FRESH_ORACLE_DAILY', 50),
          dataCalls: numericEnv(env, 'KELYRA_PRO_FRESH_DATA_DAILY', 250),
          buildActions: numericEnv(env, 'KELYRA_PRO_FRESH_BUILD_DAILY', 5),
          proofJobs: numericEnv(env, 'KELYRA_PRO_FRESH_PROOF_DAILY', 20),
        },
      },
      {
        id: 'ultimate',
        name: 'Ultimate',
        access: `Wallet holding at least ${formatTokenAmount(ultimateTokenMinimum)} ${tokenSymbol}`,
        minimum: `${formatTokenAmount(ultimateTokenMinimum)} ${tokenSymbol} minimum`,
        tokenMinimum: ultimateTokenMinimum,
        dailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_ULTIMATE_ORACLE_DAILY', 750),
          dataCalls: numericEnv(env, 'KELYRA_ULTIMATE_DATA_DAILY', 2500),
          buildActions: numericEnv(env, 'KELYRA_ULTIMATE_BUILD_DAILY', 75),
          proofJobs: numericEnv(env, 'KELYRA_ULTIMATE_PROOF_DAILY', 300),
        },
        freshDailyQuota: {
          oracleMessages: numericEnv(env, 'KELYRA_ULTIMATE_FRESH_ORACLE_DAILY', 150),
          dataCalls: numericEnv(env, 'KELYRA_ULTIMATE_FRESH_DATA_DAILY', 500),
          buildActions: numericEnv(env, 'KELYRA_ULTIMATE_FRESH_BUILD_DAILY', 10),
          proofJobs: numericEnv(env, 'KELYRA_ULTIMATE_FRESH_PROOF_DAILY', 50),
        },
      },
    ],
    internalTiers: [
      {
        id: 'operator',
        name: 'Operator',
        access: 'Internal beta access code',
        minimum: 'Internal access only',
        hidden: true,
        dailyQuota: operatorQuota,
        freshDailyQuota: operatorQuota,
      },
    ],
  };

  if (!env.KELYRA_TIER_CONFIG_JSON) return config;

  try {
    const parsed = JSON.parse(env.KELYRA_TIER_CONFIG_JSON);
    if (!Array.isArray(parsed?.tiers) || parsed.tiers.length === 0) throw new Error('tiers missing');
    return {
      ...config,
      ...parsed,
      safetyLimits: Array.isArray(parsed.safetyLimits) ? parsed.safetyLimits : config.safetyLimits,
      quotaTypes: Array.isArray(parsed.quotaTypes) ? parsed.quotaTypes : config.quotaTypes,
      tiers: parsed.tiers,
      internalTiers: Array.isArray(parsed.internalTiers) ? parsed.internalTiers : config.internalTiers,
    };
  } catch (err) {
    throw new Error(`KELYRA_TIER_CONFIG_JSON is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function tokenTiersFromConfig(tierConfig) {
  return (tierConfig.tiers || [])
    .filter((tier) => tier.tokenMinimum !== null && tier.tokenMinimum !== undefined && String(tier.tokenMinimum).trim() !== '')
    .map((tier) => ({ ...tier, tokenMinimum: String(tier.tokenMinimum).trim() }));
}

function allTiersFromConfig(tierConfig) {
  return [
    ...(Array.isArray(tierConfig.tiers) ? tierConfig.tiers : []),
    ...(Array.isArray(tierConfig.internalTiers) ? tierConfig.internalTiers : []),
  ];
}

function lowestTokenMinimum(tierConfig) {
  const tiers = tokenTiersFromConfig(tierConfig);
  if (tiers.length === 0) return '0';
  return tiers
    .map((tier) => String(tier.tokenMinimum))
    .sort((a, b) => Number(a) - Number(b))[0] || '0';
}

export function loadConfig(env = process.env) {
  const environment = env.NODE_ENV || 'development';
  const production = environment === 'production';
  const accessCodeEnabled = boolEnv(env.KELYRA_ACCESS_CODE_ENABLED, true);
  const apiSecret = env.KELYRA_API_SECRET || (production ? '' : 'dev-kelyra-api-secret-change-before-production');
  const accessCodeHash = accessCodeEnabled
    ? env.KELYRA_ACCESS_CODE_SHA256 || (production ? '' : sha256('dev-kelyra'))
    : '';
  const databaseUrl = env.DATABASE_URL || '';
  const storeDirValue = env.KELYRA_STORE_DIR || (production ? '' : '.kelyra-cloud-dev');
  const storeDir = storeDirValue ? resolve(storeDirValue) : '';
  const allowedOrigins = parseList(env.KELYRA_ALLOWED_ORIGINS || DEFAULT_DEV_ORIGINS.join(','));
  const staticDir = resolve(env.KELYRA_STATIC_DIR || join(packageRoot, 'site'));
  const tokenAddress = env.KELYRA_TOKEN_ADDRESS || '';
  const rateLimitPerMinute = Number(env.KELYRA_RATE_LIMIT_PER_MINUTE || 80);
  const tierConfig = buildTierConfig(env, rateLimitPerMinute);

  if (apiSecret.length < 32) {
    throw new Error('KELYRA_API_SECRET must be at least 32 characters.');
  }

  if (accessCodeEnabled && !accessCodeHash) {
    throw new Error('KELYRA_ACCESS_CODE_SHA256 is required.');
  }

  if (production && !databaseUrl && !storeDirValue) {
    throw new Error('DATABASE_URL or KELYRA_STORE_DIR is required in production.');
  }

  if (production && allowedOrigins.length === 0) {
    throw new Error('KELYRA_ALLOWED_ORIGINS is required in production.');
  }

  return {
    accessCodeHash,
    accessCodeEnabled,
    allowedOrigins,
    apiSecret,
    baseRpcUrl: env.KELYRA_BASE_RPC_URL || 'https://mainnet.base.org',
    cookieSecure: production,
    databaseSsl: boolEnv(env.KELYRA_DATABASE_SSL, false),
    databaseUrl,
    environment,
    baseScanApiKey: env.KELYRA_BASESCAN_API_KEY || '',
    baseScanApiUrl: env.KELYRA_BASESCAN_API_URL || 'https://api.etherscan.io/v2/api',
    port: Number(env.PORT || 8080),
    publicBaseUrl: env.KELYRA_PUBLIC_BASE_URL || '',
    rateLimitPerMinute,
    requireTokenHolder: boolEnv(env.KELYRA_REQUIRE_TOKEN_HOLDER, false),
    runnerMode: env.KELYRA_RUNNER_MODE || 'queue-only',
    sessionTtlSeconds: Number(env.KELYRA_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS),
    staticDir,
    storeDir,
    tierConfig,
    tokenAddress,
    tokenMinBalance: env.KELYRA_TOKEN_MIN_BALANCE || lowestTokenMinimum(tierConfig),
    walletAuthDomain: env.KELYRA_WALLET_AUTH_DOMAIN || 'Kelyra Console',
  };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function slugify(value) {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 46)
    .replace(/-+$/g, '') || 'kelyra-app';
  return `${base}-${sha256(value).slice(0, 6)}`;
}

function titleFromPrompt(prompt) {
  const words = String(prompt || '')
    .replace(/0x[a-fA-F0-9]{40}/g, 'Base token')
    .replace(/[^a-zA-Z0-9 $-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  if (words.length === 0) return 'Kelyra App';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function classifyForgeApp(prompt) {
  if (/\b(receipt|proof|swd|verify|audit trail|ricevut|prova|verifica)\b/i.test(prompt)) return 'proof-workspace';
  if (/\b(risk|scanner|honeypot|holder|deployer|lp|security|sicurezza)\b/i.test(prompt)) return 'risk-scanner';
  if (/\b(pulse|trend|market|token|base|liquidity|volume|prezzo|mercato)\b/i.test(prompt)) return 'market-dashboard';
  return 'operator-tool';
}

function forgeCapabilities(kind) {
  const shared = ['source metadata', 'loading/error states', 'sandbox bridge boundary'];
  if (kind === 'proof-workspace') return ['receipt timeline', 'verification state', 'file-action review', ...shared];
  if (kind === 'risk-scanner') return ['risk flags', 'unknown-source panel', 'token drilldown', ...shared];
  if (kind === 'market-dashboard') return ['Pulse lanes', 'Oracle token report', 'liquidity filters', ...shared];
  return ['task queue', 'review drawer', 'saved operator state', ...shared];
}

function forgeBridgeCalls(kind) {
  if (kind === 'proof-workspace') return ['receipts.latest', 'receipts.list', 'proof.verify'];
  if (kind === 'risk-scanner') return ['oracle.token', 'oracle.search', 'pulse.risk'];
  if (kind === 'market-dashboard') return ['pulse.lanes', 'oracle.token', 'market.search'];
  return ['workspace.context', 'proof.verify', 'oracle.search'];
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostedForgeHtml(app) {
  const calls = app.bridgeCalls || [];
  const capabilities = app.capabilities || [];
  const defaultCall = calls.includes('pulse.lanes') ? 'pulse.lanes' : calls[0] || 'workspace.context';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(app.title)}</title>
    <style>
      :root { color-scheme: dark; --bg: #08090d; --panel: #11141c; --ink: #f7f4f8; --muted: #a7a1b0; --line: rgba(255,255,255,.12); --cyan: #7de9f0; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 18% 10%, rgba(125,233,240,.12), transparent 32%), var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 46px 0; }
      header { display: grid; gap: 14px; margin-bottom: 24px; }
      span { color: var(--cyan); font: 800 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
      h1 { margin: 0; max-width: 780px; font-size: clamp(40px, 7vw, 78px); line-height: .92; letter-spacing: 0; }
      p { color: var(--muted); font-size: 16px; line-height: 1.65; }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
      article, .result { border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(180deg, rgba(255,255,255,.04), transparent), rgba(17,20,28,.84); padding: 18px; }
      strong { display: block; margin-top: 10px; font-size: 18px; }
      button { border: 1px solid rgba(125,233,240,.32); border-radius: 9px; background: rgba(125,233,240,.1); color: var(--ink); padding: 12px 15px; font: 800 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; cursor: pointer; }
      pre { overflow: auto; margin: 14px 0 0; color: var(--muted); white-space: pre-wrap; }
      @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } main { padding-top: 28px; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <span>${escapeHtml(app.kind)}</span>
        <h1>${escapeHtml(app.title)}</h1>
        <p>This hosted Forge draft is sandboxed. It can only request approved data through the Kelyra bridge, and unknown fields stay unknown.</p>
      </header>
      <section class="grid">
        ${capabilities.slice(0, 6).map((capability) => `<article><span>Capability</span><strong>${escapeHtml(capability)}</strong></article>`).join('\n        ')}
      </section>
      <button type="button" id="run-query">Run bridge query</button>
      <section class="result" aria-live="polite">
        <span>Bridge result</span>
        <pre id="output">Waiting for ${escapeHtml(defaultCall)}...</pre>
      </section>
    </main>
    <script>
      (() => {
        const pending = new Map();
        window.kelyraQuery = (type, target, params = {}) => new Promise((resolve, reject) => {
          const queryId = Math.random().toString(36).slice(2);
          pending.set(queryId, { resolve, reject });
          window.parent.postMessage({
            source: 'kelyra-forge',
            type: 'DATA_REQUEST',
            queryId,
            payload: { type, target, params },
          }, '*');
          window.setTimeout(() => {
            if (!pending.has(queryId)) return;
            pending.delete(queryId);
            reject(new Error('Kelyra bridge timeout'));
          }, 15000);
        });

        window.addEventListener('message', (event) => {
          const message = event.data || {};
          if (message.source !== 'kelyra-console' || message.type !== 'DATA_RESPONSE') return;
          const item = pending.get(message.queryId);
          if (!item) return;
          pending.delete(message.queryId);
          if (message.ok) item.resolve(message.payload);
          else item.reject(new Error(message.error || 'Kelyra bridge error'));
        });

        const output = document.getElementById('output');
        document.getElementById('run-query')?.addEventListener('click', async () => {
          output.textContent = 'Loading source-backed data...';
          try {
            const result = await window.kelyraQuery(${JSON.stringify(defaultCall)}, ${JSON.stringify(KELYRA_REFERENCE_TOKEN_ADDRESS)}, { limit: 6 });
            output.textContent = JSON.stringify({ summary: result.summary, payload: result.payload }, null, 2);
          } catch (err) {
            output.textContent = err instanceof Error ? err.message : String(err);
          }
        });
      })();
    </script>
  </body>
</html>`;
}

function hostedForgeStyles() {
  return [
    ':root { color-scheme: dark; --bg: #08090d; --panel: #11141c; --ink: #f7f4f8; --muted: #a7a1b0; --line: rgba(255,255,255,.12); --cyan: #7de9f0; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 18% 10%, rgba(125,233,240,.12), transparent 32%), var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    'main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 46px 0; }',
    'header { display: grid; gap: 14px; margin-bottom: 24px; }',
    '.eyebrow, span { color: var(--cyan); font: 800 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }',
    'h1 { margin: 0; max-width: 780px; font-size: clamp(40px, 7vw, 78px); line-height: .92; letter-spacing: 0; }',
    'p { color: var(--muted); font-size: 16px; line-height: 1.65; }',
    '.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }',
    'article, .result { border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(180deg, rgba(255,255,255,.04), transparent), rgba(17,20,28,.84); padding: 18px; }',
    'strong { display: block; margin-top: 10px; font-size: 18px; }',
    'button { border: 1px solid rgba(125,233,240,.32); border-radius: 9px; background: rgba(125,233,240,.1); color: var(--ink); padding: 12px 15px; font: 800 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; cursor: pointer; }',
    'pre { overflow: auto; margin: 14px 0 0; color: var(--muted); white-space: pre-wrap; }',
    '@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } main { padding-top: 28px; } }',
  ].join('\n');
}

function hostedForgeScript(defaultCall) {
  return `(() => {
  const pending = new Map();
  window.kelyraQuery = (type, target, params = {}) => new Promise((resolve, reject) => {
    const queryId = Math.random().toString(36).slice(2);
    pending.set(queryId, { resolve, reject });
    window.parent.postMessage({
      source: 'kelyra-forge',
      type: 'DATA_REQUEST',
      queryId,
      payload: { type, target, params },
    }, '*');
    window.setTimeout(() => {
      if (!pending.has(queryId)) return;
      pending.delete(queryId);
      reject(new Error('Kelyra bridge timeout'));
    }, 15000);
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.source !== 'kelyra-console' || message.type !== 'DATA_RESPONSE') return;
    const item = pending.get(message.queryId);
    if (!item) return;
    pending.delete(message.queryId);
    if (message.ok) item.resolve(message.payload);
    else item.reject(new Error(message.error || 'Kelyra bridge error'));
  });

  const output = document.getElementById('output');
  document.getElementById('run-query')?.addEventListener('click', async () => {
    output.textContent = 'Loading source-backed data...';
    try {
      const result = await window.kelyraQuery(${JSON.stringify(defaultCall)}, ${JSON.stringify(KELYRA_REFERENCE_TOKEN_ADDRESS)}, { limit: 6 });
      output.textContent = JSON.stringify({ summary: result.summary, payload: result.payload }, null, 2);
    } catch (err) {
      output.textContent = err instanceof Error ? err.message : String(err);
    }
  });
})();`;
}

function buildProofJob(input) {
  const now = new Date().toISOString();
  return {
    id: `job_${randomBytes(12).toString('hex')}`,
    createdAt: now,
    updatedAt: now,
    status: input.runnerMode === 'disabled' ? 'blocked' : 'queued',
    reason: input.runnerMode === 'disabled' ? 'No hosted proof runner is configured.' : undefined,
    promptHash: sha256(input.prompt),
    promptPreview: String(input.prompt || '').slice(0, 180),
    workspaceRef: input.workspaceRef || null,
    runnerMode: input.runnerMode,
    ownerSub: input.ownerSub || 'access-code',
  };
}

function buildForgeApp(input) {
  const prompt = String(input.prompt || '').trim();
  const previous = input.previous || null;
  const generatedAt = previous?.generatedAt || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  const title = titleFromPrompt(prompt);
  const kind = classifyForgeApp(prompt);
  const slug = previous?.slug || slugify(`${prompt}-${input.ownerSub || 'access-code'}`);
  const version = Number(previous?.version || 0) + 1;
  const capabilities = forgeCapabilities(kind);
  const bridgeCalls = forgeBridgeCalls(kind);
  const defaultCall = bridgeCalls.includes('pulse.lanes') ? 'pulse.lanes' : bridgeCalls[0] || 'workspace.context';
  const manifest = {
    schema: 'kelyra.forge.hosted.v1',
    slug,
    title,
    kind,
    generatedAt,
    updatedAt,
    version,
    promptHash: sha256(prompt),
    sourceDiscipline: 'Unknown values must stay unknown unless returned by an approved Kelyra bridge call.',
    sandbox: {
      directBrowserFetch: false,
      bridgeApi: 'window.kelyraQuery(type, target, params)',
    },
    bridgeCalls,
    capabilities,
  };
  const previewHtml = hostedForgeHtml({ ...manifest, capabilities, bridgeCalls });
  const assets = {
    'index.html': previewHtml,
    'styles.css': `${hostedForgeStyles()}\n`,
    'app.js': `${hostedForgeScript(defaultCall)}\n`,
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  };

  return {
    slug,
    title,
    kind,
    version,
    promptPreview: prompt.slice(0, 220),
    promptHash: sha256(prompt),
    generatedAt,
    updatedAt,
    ownerSub: input.ownerSub || 'access-code',
    status: input.status || previous?.status || 'draft',
    proofJobId: input.proofJobId || null,
    proofStatus: input.proofStatus || (input.proofJobId ? 'queued' : previous?.proofStatus || 'unverified'),
    proofJobStatus: input.proofJobId ? 'queued' : previous?.proofJobStatus || null,
    receiptId: input.receiptId || null,
    proofCompletedAt: input.proofCompletedAt || null,
    proofError: input.proofError || null,
    bridgeCalls,
    capabilities,
    previewUrl: `/api/apps/${slug}/preview`,
    files: Object.entries(assets).map(([path, content]) => ({
      path,
      bytes: Buffer.byteLength(content, 'utf8'),
    })),
    assets,
  };
}

function publicForgeApp(app) {
  if (!app) return null;
  const { assets, ...publicApp } = app;
  return {
    ...publicApp,
    previewUrl: publicApp.previewUrl || `/api/apps/${publicApp.slug}/preview`,
  };
}

function normalizeAddress(address) {
  const value = String(address || '').trim();
  if (!isAddress(value)) return '';
  return value.toLowerCase();
}

function walletAuthMessage(config, { address, nonce, issuedAt, expiresAt }) {
  return [
    `${config.walletAuthDomain} wants you to sign in with your wallet.`,
    '',
    `Address: ${address}`,
    `Chain: Base (${BASE_CHAIN_ID})`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    '',
    'This signature does not approve a transaction or spend funds.',
  ].join('\n');
}

function parseWalletAuthMessage(message) {
  const nonce = String(message || '').match(/^Nonce:\s*(.+)$/m)?.[1]?.trim();
  const address = String(message || '').match(/^Address:\s*(0x[a-fA-F0-9]{40})$/m)?.[1]?.trim();
  return { nonce, address: normalizeAddress(address) };
}

function buildAuthNonce(config, address) {
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60_000);
  const nonce = randomBytes(16).toString('hex');
  const normalizedAddress = normalizeAddress(address);
  const issuedAt = now.toISOString();
  const expiresAt = expires.toISOString();
  const message = walletAuthMessage(config, {
    address: normalizedAddress,
    nonce,
    issuedAt,
    expiresAt,
  });

  return {
    nonce,
    address: normalizedAddress,
    chainId: BASE_CHAIN_ID,
    issuedAt,
    expiresAt,
    message,
  };
}

function formatTokenAmount(value) {
  const text = String(value ?? '').trim();
  if (!text) return '0';
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  return number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function tokenThresholds(config) {
  const symbol = config.tierConfig.token?.symbol || 'KELYRA';
  return tokenTiersFromConfig(config.tierConfig).map((tier) => ({
    tierId: tier.id,
    tierName: tier.name,
    tokenMinimum: tier.tokenMinimum,
    label: `${formatTokenAmount(tier.tokenMinimum)} ${symbol}`,
  }));
}

function tokenTierForBalance(config, balance, decimals) {
  const tiers = tokenTiersFromConfig(config.tierConfig)
    .map((tier) => ({
      tier,
      minimumRaw: parseUnits(String(tier.tokenMinimum), decimals),
    }))
    .sort((a, b) => a.minimumRaw > b.minimumRaw ? -1 : a.minimumRaw < b.minimumRaw ? 1 : 0);

  return tiers.find((item) => balance >= item.minimumRaw) || null;
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function previousUtcDay(date = new Date()) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - 1,
    0,
    0,
    0,
    0,
  )).toISOString().slice(0, 10);
}

function nextUtcReset(date = new Date()) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )).toISOString();
}

function validQuotaMode(value) {
  return value === 'full' || value === 'fresh';
}

async function applyHolderQuotaMode(config, store, address, tokenGate) {
  if (!tokenGate?.required || !tokenGate.tierId) {
    return {
      ...tokenGate,
      quotaMode: validQuotaMode(tokenGate?.quotaMode) ? tokenGate.quotaMode : 'full',
    };
  }

  const now = new Date();
  const currentDay = utcDay(now);
  const previousDay = previousUtcDay(now);
  const explicitMode = validQuotaMode(tokenGate.quotaMode) ? tokenGate.quotaMode : '';
  let quotaMode = explicitMode || 'fresh';
  const tier = tierById(config, tokenGate.tierId);
  const decimals = Number(tokenGate.decimals ?? 18);

  if (!explicitMode && tier?.tokenMinimum && Number.isInteger(decimals)) {
    const previous = await store.getHolderSnapshot(address, previousDay).catch(() => null);
    if (previous?.balance !== undefined && previous?.balance !== null) {
      try {
        const previousBalance = BigInt(String(previous.balance));
        const minimum = parseUnits(String(tier.tokenMinimum), decimals);
        if (previousBalance >= minimum) quotaMode = 'full';
      } catch {
        quotaMode = 'fresh';
      }
    }
  }

  const snapshot = {
    address,
    snapshotDay: currentDay,
    balance: String(tokenGate.balance || '0'),
    balanceFormatted: tokenGate.balanceFormatted || null,
    decimals: Number.isInteger(decimals) ? decimals : 18,
    symbol: tokenGate.symbol || config.tierConfig.token?.symbol || 'KELYRA',
    tierId: tokenGate.tierId,
    tierName: tokenGate.tierName,
    recordedAt: now.toISOString(),
  };
  await store.recordHolderSnapshot(snapshot).catch(() => {});

  return {
    ...tokenGate,
    quotaMode,
    quotaSnapshot: {
      mode: quotaMode,
      previousDay,
      currentDay,
      nextFullQuotaCheckAt: nextUtcReset(now),
    },
  };
}

async function tokenHolderStatus(config, address) {
  if (!config.requireTokenHolder) {
    return {
      required: false,
      ok: true,
      chainId: BASE_CHAIN_ID,
      tokenAddress: config.tokenAddress,
      thresholds: tokenThresholds(config),
    };
  }

  if (!normalizeAddress(config.tokenAddress)) {
    throw Object.assign(new Error('TOKEN_ADDRESS_INVALID'), { status: 500 });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(config.baseRpcUrl),
  });

  const [balance, decimals, symbol] = await Promise.all([
    client.readContract({
      address: config.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    client.readContract({
      address: config.tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
    client.readContract({
      address: config.tokenAddress,
      abi: erc20Abi,
      functionName: 'symbol',
    }).catch(() => 'TOKEN'),
  ]);
  const matched = tokenTierForBalance(config, balance, decimals);
  const minimum = parseUnits(config.tokenMinBalance, decimals);
  const symbolText = String(symbol || config.tierConfig.token?.symbol || 'KELYRA');

  return {
    required: true,
    ok: Boolean(matched) && balance >= minimum,
    chainId: BASE_CHAIN_ID,
    tokenAddress: config.tokenAddress,
    symbol: symbolText,
    decimals,
    balance: balance.toString(),
    balanceFormatted: formatTokenAmount(formatUnits(balance, decimals)),
    minimum: minimum.toString(),
    minimumFormatted: `${formatTokenAmount(config.tokenMinBalance)} ${symbolText}`,
    thresholds: tokenThresholds(config),
    tierId: matched?.tier.id || null,
    tierName: matched?.tier.name || null,
    tierMinimum: matched ? `${formatTokenAmount(matched.tier.tokenMinimum)} ${symbolText}` : null,
  };
}

function buildHostedReceipt(job, workerId) {
  const now = new Date().toISOString();
  const source = {
    jobId: job.id,
    promptHash: job.promptHash,
    workspaceRef: job.workspaceRef || 'hosted-console',
    runnerMode: job.runnerMode,
    workerId,
  };
  return {
    id: `hosted-${stamp()}-${sha256(`${job.id}:${now}`).slice(0, 12)}`,
    type: 'kelyra.hosted.proof.v1',
    timestamp: now,
    success: true,
    ownerSub: job.ownerSub,
    provider: 'kelyra-hosted-worker',
    fileCount: 0,
    summary: 'Hosted proof job completed in an isolated Kelyra worker without local filesystem access.',
    jobId: job.id,
    promptHash: job.promptHash,
    source,
    checks: [
      { id: 'auth', ok: true, label: 'Authenticated session' },
      { id: 'queue', ok: true, label: 'Job claimed by hosted worker' },
      { id: 'boundary', ok: true, label: 'No browser-side filesystem execution' },
      { id: 'sources', ok: true, label: 'Unknowns are preserved unless returned by approved sources' },
    ],
  };
}

class FileStore {
  constructor(storeDir) {
    this.storeDir = storeDir;
    this.jobsPath = join(storeDir, 'proof-jobs.json');
    this.receiptsPath = join(storeDir, 'receipts.json');
    this.appsPath = join(storeDir, 'forge-apps.json');
    this.noncesPath = join(storeDir, 'auth-nonces.json');
    this.usagePath = join(storeDir, 'usage-counters.json');
    this.holderSnapshotsPath = join(storeDir, 'holder-snapshots.json');
  }

  async readJson(path, fallback) {
    try {
      return JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      return fallback;
    }
  }

  async writeJson(path, value) {
    await mkdir(this.storeDir, { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async listReceipts(limit = 50, ownerSub = '') {
    const receipts = await this.readJson(this.receiptsPath, []);
    return receipts
      .filter((receipt) => !ownerSub || receipt.ownerSub === ownerSub)
      .slice(0, limit);
  }

  async createReceipt(receipt) {
    const receipts = await this.readJson(this.receiptsPath, []);
    const next = [receipt, ...receipts.filter((item) => item.id !== receipt.id)].slice(0, 1000);
    await this.writeJson(this.receiptsPath, next);
    return receipt;
  }

  async createProofJob(input) {
    const jobs = await this.readJson(this.jobsPath, []);
    const job = buildProofJob(input);
    jobs.unshift(job);
    await this.writeJson(this.jobsPath, jobs.slice(0, 500));
    return job;
  }

  async listProofJobs(ownerSub, limit = 50) {
    const jobs = await this.readJson(this.jobsPath, []);
    return jobs
      .filter((job) => !ownerSub || job.ownerSub === ownerSub)
      .slice(0, limit);
  }

  async getProofJob(id) {
    const jobs = await this.readJson(this.jobsPath, []);
    return jobs.find((job) => job.id === id) || null;
  }

  async updateProofJob(job) {
    const jobs = await this.readJson(this.jobsPath, []);
    const next = jobs.map((item) => item.id === job.id ? job : item);
    await this.writeJson(this.jobsPath, next);
    return job;
  }

  async claimNextProofJob(workerId) {
    const jobs = await this.readJson(this.jobsPath, []);
    const index = jobs.findIndex((job) => job.status === 'queued' && job.runnerMode === 'hosted-worker');
    if (index === -1) return null;

    const now = new Date().toISOString();
    const job = {
      ...jobs[index],
      status: 'processing',
      workerId,
      lockedAt: now,
      updatedAt: now,
      attempts: (jobs[index].attempts || 0) + 1,
    };
    jobs[index] = job;
    await this.writeJson(this.jobsPath, jobs);
    return job;
  }

  async createForgeApp(input) {
    const apps = await this.readJson(this.appsPath, []);
    const app = buildForgeApp(input);
    const next = [app, ...apps.filter((item) => item.slug !== app.slug)].slice(0, 250);
    await this.writeJson(this.appsPath, next);
    return app;
  }

  async listForgeApps(ownerSub, limit = 50) {
    const apps = await this.readJson(this.appsPath, []);
    return apps
      .filter((app) => !ownerSub || app.ownerSub === ownerSub)
      .slice(0, limit);
  }

  async getForgeApp(slug) {
    const apps = await this.readJson(this.appsPath, []);
    return apps.find((app) => app.slug === slug) || null;
  }

  async findForgeAppByProofJobId(proofJobId, ownerSub = '') {
    const apps = await this.readJson(this.appsPath, []);
    return apps.find((app) => (
      app.proofJobId === proofJobId &&
      (!ownerSub || app.ownerSub === ownerSub)
    )) || null;
  }

  async updateForgeApp(app) {
    const apps = await this.readJson(this.appsPath, []);
    const next = apps.map((item) => item.slug === app.slug ? app : item);
    if (!next.some((item) => item.slug === app.slug)) next.unshift(app);
    await this.writeJson(this.appsPath, next.slice(0, 250));
    return app;
  }

  async deleteForgeApp(slug, ownerSub) {
    const apps = await this.readJson(this.appsPath, []);
    const next = apps.filter((app) => !(app.slug === slug && app.ownerSub === ownerSub));
    await this.writeJson(this.appsPath, next);
    return next.length !== apps.length;
  }

  async createAuthNonce(nonceRecord) {
    const records = await this.readJson(this.noncesPath, []);
    const now = Date.now();
    const active = records.filter((item) => !item.usedAt && Date.parse(item.expiresAt) > now);
    active.unshift(nonceRecord);
    await this.writeJson(this.noncesPath, active.slice(0, 500));
    return nonceRecord;
  }

  async useAuthNonce(address, nonce) {
    const records = await this.readJson(this.noncesPath, []);
    const now = new Date().toISOString();
    const index = records.findIndex((item) => (
      item.address === address &&
      item.nonce === nonce &&
      !item.usedAt &&
      Date.parse(item.expiresAt) > Date.now()
    ));
    if (index === -1) return null;
    const record = { ...records[index], usedAt: now };
    records[index] = record;
    await this.writeJson(this.noncesPath, records);
    return record;
  }

  async recordHolderSnapshot(snapshot) {
    const snapshots = await this.readJson(this.holderSnapshotsPath, []);
    const next = [
      snapshot,
      ...snapshots.filter((item) => !(item.address === snapshot.address && item.snapshotDay === snapshot.snapshotDay)),
    ].slice(0, 5000);
    await this.writeJson(this.holderSnapshotsPath, next);
    return snapshot;
  }

  async getHolderSnapshot(address, snapshotDay) {
    const snapshots = await this.readJson(this.holderSnapshotsPath, []);
    return snapshots.find((item) => item.address === address && item.snapshotDay === snapshotDay) || null;
  }

  async getUsage(ownerSub, quotaKey, windowId) {
    const counters = await this.readJson(this.usagePath, []);
    const current = counters.find((item) => (
      item.ownerSub === ownerSub &&
      item.quotaKey === quotaKey &&
      item.windowId === windowId
    ));
    return {
      ownerSub,
      quotaKey,
      windowId,
      used: Number(current?.count || 0),
      resetAt: current?.resetAt || null,
    };
  }

  async consumeUsage(ownerSub, quotaKey, limit, windowId, resetAt) {
    if (!Number.isFinite(limit)) {
      return { ok: true, ownerSub, quotaKey, limit: null, used: 0, remaining: null, resetAt };
    }

    const counters = await this.readJson(this.usagePath, []);
    const active = counters.filter((item) => item.windowId === windowId);
    const index = active.findIndex((item) => item.ownerSub === ownerSub && item.quotaKey === quotaKey);
    const current = index >= 0 ? active[index] : { ownerSub, quotaKey, windowId, count: 0, resetAt };
    if (current.count >= limit) {
      await this.writeJson(this.usagePath, active);
      return { ok: false, ownerSub, quotaKey, limit, used: current.count, remaining: 0, resetAt };
    }

    const next = { ...current, count: current.count + 1, resetAt, updatedAt: new Date().toISOString() };
    if (index >= 0) active[index] = next;
    else active.push(next);
    await this.writeJson(this.usagePath, active);
    return { ok: true, ownerSub, quotaKey, limit, used: next.count, remaining: Math.max(0, limit - next.count), resetAt };
  }
}

class PostgresStore {
  constructor(config) {
    this.config = config;
    this.poolPromise = import('pg').then(({ Pool }) => new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    }));
    this.ready = null;
  }

  async pool() {
    return this.poolPromise;
  }

  async ensureSchema() {
    if (!this.ready) {
      this.ready = this.pool().then((pool) => pool.query(`
        CREATE TABLE IF NOT EXISTS proof_jobs (
          id text PRIMARY KEY,
          owner_sub text NOT NULL DEFAULT 'access-code',
          status text NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          data jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS proof_jobs_owner_created_idx ON proof_jobs (owner_sub, created_at DESC);

        CREATE TABLE IF NOT EXISTS receipts (
          id text PRIMARY KEY,
          owner_sub text NOT NULL DEFAULT 'access-code',
          created_at timestamptz NOT NULL DEFAULT now(),
          data jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS receipts_owner_created_idx ON receipts (owner_sub, created_at DESC);

        CREATE TABLE IF NOT EXISTS forge_apps (
          slug text PRIMARY KEY,
          owner_sub text NOT NULL DEFAULT 'access-code',
          title text NOT NULL,
          kind text NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          data jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS forge_apps_owner_updated_idx ON forge_apps (owner_sub, updated_at DESC);

        CREATE TABLE IF NOT EXISTS auth_nonces (
          nonce text PRIMARY KEY,
          address text NOT NULL,
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          data jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS auth_nonces_address_idx ON auth_nonces (address, expires_at DESC);

        CREATE TABLE IF NOT EXISTS usage_counters (
          owner_sub text NOT NULL,
          quota_key text NOT NULL,
          window_id text NOT NULL,
          count integer NOT NULL DEFAULT 0,
          reset_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (owner_sub, quota_key, window_id)
        );

        CREATE TABLE IF NOT EXISTS holder_snapshots (
          address text NOT NULL,
          snapshot_day text NOT NULL,
          balance text NOT NULL,
          decimals integer NOT NULL,
          tier_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          data jsonb NOT NULL,
          PRIMARY KEY (address, snapshot_day)
        );
        CREATE INDEX IF NOT EXISTS holder_snapshots_day_idx ON holder_snapshots (snapshot_day, tier_id);
      `));
    }
    await this.ready;
  }

  async listReceipts(limit = 50, ownerSub = 'access-code') {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      'SELECT data FROM receipts WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT $2',
      [ownerSub, limit],
    );
    return result.rows.map((row) => row.data);
  }

  async createReceipt(receipt) {
    await this.ensureSchema();
    const pool = await this.pool();
    await pool.query(
      `INSERT INTO receipts (id, owner_sub, created_at, data)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      [receipt.id, receipt.ownerSub || 'access-code', receipt.timestamp || new Date().toISOString(), receipt],
    );
    return receipt;
  }

  async createProofJob(input) {
    await this.ensureSchema();
    const pool = await this.pool();
    const job = buildProofJob(input);
    await pool.query(
      `INSERT INTO proof_jobs (id, owner_sub, status, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [job.id, job.ownerSub, job.status, job.createdAt, job.updatedAt, job],
    );
    return job;
  }

  async listProofJobs(ownerSub = 'access-code', limit = 50) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      'SELECT data FROM proof_jobs WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT $2',
      [ownerSub, limit],
    );
    return result.rows.map((row) => row.data);
  }

  async getProofJob(id) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query('SELECT data FROM proof_jobs WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0]?.data || null;
  }

  async updateProofJob(job) {
    await this.ensureSchema();
    const pool = await this.pool();
    await pool.query(
      'UPDATE proof_jobs SET status = $2, updated_at = $3, data = $4 WHERE id = $1',
      [job.id, job.status, job.updatedAt || new Date().toISOString(), job],
    );
    return job;
  }

  async claimNextProofJob(workerId) {
    await this.ensureSchema();
    const pool = await this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT data FROM proof_jobs
         WHERE status = 'queued' AND data->>'runnerMode' = 'hosted-worker'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }

      const now = new Date().toISOString();
      const job = {
        ...result.rows[0].data,
        status: 'processing',
        workerId,
        lockedAt: now,
        updatedAt: now,
        attempts: (result.rows[0].data.attempts || 0) + 1,
      };
      await client.query(
        'UPDATE proof_jobs SET status = $2, updated_at = $3, data = $4 WHERE id = $1',
        [job.id, job.status, job.updatedAt, job],
      );
      await client.query('COMMIT');
      return job;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async createForgeApp(input) {
    await this.ensureSchema();
    const pool = await this.pool();
    const app = buildForgeApp(input);
    await pool.query(
      `INSERT INTO forge_apps (slug, owner_sub, title, kind, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (slug) DO UPDATE SET
         title = excluded.title,
         kind = excluded.kind,
         updated_at = excluded.updated_at,
         data = excluded.data`,
      [app.slug, app.ownerSub, app.title, app.kind, app.generatedAt, app.updatedAt, app],
    );
    return app;
  }

  async listForgeApps(ownerSub = 'access-code', limit = 50) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      'SELECT data FROM forge_apps WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT $2',
      [ownerSub, limit],
    );
    return result.rows.map((row) => row.data);
  }

  async getForgeApp(slug) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query('SELECT data FROM forge_apps WHERE slug = $1 LIMIT 1', [slug]);
    return result.rows[0]?.data || null;
  }

  async findForgeAppByProofJobId(proofJobId, ownerSub = 'access-code') {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      `SELECT data FROM forge_apps
       WHERE data->>'proofJobId' = $1 AND owner_sub = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [proofJobId, ownerSub],
    );
    return result.rows[0]?.data || null;
  }

  async updateForgeApp(app) {
    await this.ensureSchema();
    const pool = await this.pool();
    await pool.query(
      `UPDATE forge_apps
       SET title = $2, kind = $3, updated_at = $4, data = $5
       WHERE slug = $1 AND owner_sub = $6`,
      [app.slug, app.title, app.kind, app.updatedAt || new Date().toISOString(), app, app.ownerSub],
    );
    return app;
  }

  async deleteForgeApp(slug, ownerSub) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      'DELETE FROM forge_apps WHERE slug = $1 AND owner_sub = $2',
      [slug, ownerSub],
    );
    return Number(result.rowCount || 0) > 0;
  }

  async createAuthNonce(nonceRecord) {
    await this.ensureSchema();
    const pool = await this.pool();
    await pool.query(
      `INSERT INTO auth_nonces (nonce, address, expires_at, data)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (nonce) DO UPDATE SET
         address = excluded.address,
         expires_at = excluded.expires_at,
         used_at = null,
         data = excluded.data`,
      [nonceRecord.nonce, nonceRecord.address, nonceRecord.expiresAt, nonceRecord],
    );
    return nonceRecord;
  }

  async useAuthNonce(address, nonce) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      `UPDATE auth_nonces
       SET used_at = now(), data = jsonb_set(data, '{usedAt}', to_jsonb(now()::text), true)
       WHERE address = $1
         AND nonce = $2
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING data`,
      [address, nonce],
    );
    return result.rows[0]?.data || null;
  }

  async recordHolderSnapshot(snapshot) {
    await this.ensureSchema();
    const pool = await this.pool();
    await pool.query(
      `INSERT INTO holder_snapshots (address, snapshot_day, balance, decimals, tier_id, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (address, snapshot_day) DO UPDATE SET
         balance = excluded.balance,
         decimals = excluded.decimals,
         tier_id = excluded.tier_id,
         data = excluded.data`,
      [
        snapshot.address,
        snapshot.snapshotDay,
        String(snapshot.balance || '0'),
        Number(snapshot.decimals || 18),
        snapshot.tierId || null,
        snapshot,
      ],
    );
    return snapshot;
  }

  async getHolderSnapshot(address, snapshotDay) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      'SELECT data FROM holder_snapshots WHERE address = $1 AND snapshot_day = $2 LIMIT 1',
      [address, snapshotDay],
    );
    return result.rows[0]?.data || null;
  }

  async getUsage(ownerSub, quotaKey, windowId) {
    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      `SELECT count, reset_at FROM usage_counters
       WHERE owner_sub = $1 AND quota_key = $2 AND window_id = $3
       LIMIT 1`,
      [ownerSub, quotaKey, windowId],
    );
    return {
      ownerSub,
      quotaKey,
      windowId,
      used: Number(result.rows[0]?.count || 0),
      resetAt: result.rows[0]?.reset_at ? new Date(result.rows[0].reset_at).toISOString() : null,
    };
  }

  async consumeUsage(ownerSub, quotaKey, limit, windowId, resetAt) {
    if (!Number.isFinite(limit)) {
      return { ok: true, ownerSub, quotaKey, limit: null, used: 0, remaining: null, resetAt };
    }

    await this.ensureSchema();
    const pool = await this.pool();
    const result = await pool.query(
      `INSERT INTO usage_counters (owner_sub, quota_key, window_id, count, reset_at, updated_at)
       VALUES ($1, $2, $3, 1, $5, now())
       ON CONFLICT (owner_sub, quota_key, window_id) DO UPDATE SET
         count = usage_counters.count + 1,
         reset_at = excluded.reset_at,
         updated_at = now()
       WHERE usage_counters.count < $4
       RETURNING count`,
      [ownerSub, quotaKey, windowId, limit, resetAt],
    );

    const count = result.rows[0]?.count;
    if (count !== undefined) {
      const used = Number(count);
      return { ok: true, ownerSub, quotaKey, limit, used, remaining: Math.max(0, limit - used), resetAt };
    }

    const current = await pool.query(
      `SELECT count FROM usage_counters
       WHERE owner_sub = $1 AND quota_key = $2 AND window_id = $3
       LIMIT 1`,
      [ownerSub, quotaKey, windowId],
    );
    const used = Number(current.rows[0]?.count || limit);
    return { ok: false, ownerSub, quotaKey, limit, used, remaining: 0, resetAt };
  }

  async close() {
    const pool = await this.pool();
    await pool.end();
  }
}

export function createStore(config) {
  if (config.databaseUrl) return new PostgresStore(config);
  return new FileStore(config.storeDir);
}

function signSession(config, payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', config.apiSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySession(config, token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = createHmac('sha256', config.apiSecret).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index === -1) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

function sessionCookie(config, value, maxAge = config.sessionTtlSeconds) {
  const secure = config.cookieSecure ? '; Secure' : '';
  return `kelyra_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function createRateLimiter(config) {
  const buckets = new Map();
  return function rateLimit(req) {
    const key = `${req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'}:${req.url}`;
    const now = Date.now();
    const current = buckets.get(key) || { count: 0, resetAt: now + 60_000 };
    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + 60_000;
    }
    current.count += 1;
    buckets.set(key, current);
    return {
      ok: current.count <= config.rateLimitPerMinute,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  };
}

function publicTierConfig(config) {
  const { internalTiers, accessCodeTierId, ...publicConfig } = config.tierConfig;
  const gate = {
    walletAuth: true,
    accessCodeBeta: config.accessCodeEnabled,
    tokenGate: config.requireTokenHolder
      ? {
	          required: true,
	          chainId: BASE_CHAIN_ID,
	          tokenAddress: config.tokenAddress,
	          symbol: config.tierConfig.token?.symbol || 'KELYRA',
	          minimum: config.tokenMinBalance,
	          minimumLabel: `${formatTokenAmount(config.tokenMinBalance)} ${config.tierConfig.token?.symbol || 'KELYRA'}`,
	          thresholds: tokenThresholds(config),
	        }
	      : {
	          required: false,
	          symbol: config.tierConfig.token?.symbol || 'KELYRA',
	          thresholds: tokenThresholds(config),
	        },
	  };

  return {
    ...publicConfig,
    gate,
    enforced: true,
  };
}

function tierById(config, tierId) {
  const tiers = allTiersFromConfig(config.tierConfig);
  return tiers.find((tier) => tier.id === tierId) ||
    tiers.find((tier) => tier.id === config.tierConfig.defaultTierId) ||
    tiers[0] ||
    null;
}

function tierForSession(config, session) {
  if (!session) return tierById(config, config.tierConfig.anonymousTierId || config.tierConfig.defaultTierId || 'basic');
  if (session.tierId) return tierById(config, session.tierId);
  if (session.authMode === 'access-code') return tierById(config, config.tierConfig.accessCodeTierId);
  return tierById(config, config.tierConfig.defaultTierId);
}

function quotaModeForSession(session) {
  if (!session) return 'full';
  if (validQuotaMode(session.quotaMode)) return session.quotaMode;
  if (validQuotaMode(session.tokenGate?.quotaMode)) return session.tokenGate.quotaMode;
  return session.authMode === 'wallet' && session.tokenGate?.required ? 'fresh' : 'full';
}

function quotaLimitFor(tier, quotaKey, quotaMode = 'full') {
  const quota = quotaMode === 'fresh' && tier?.freshDailyQuota ? tier.freshDailyQuota : tier?.dailyQuota;
  const value = quota?.[quotaKey];
  if (value === null || value === 'unlimited') return Number.POSITIVE_INFINITY;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function quotaWindow(now = new Date()) {
  const windowId = now.toISOString().slice(0, 10);
  const resetAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )).toISOString();
  return { windowId, resetAt };
}

function anonymousSubject(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  return `public:${sha256(ip).slice(0, 18)}`;
}

function quotaHeaders(quota) {
  if (!quota) return {};
  return {
    'x-kelyra-quota-tier': quota.tierId,
    'x-kelyra-quota-key': quota.quotaKey,
    'x-kelyra-quota-mode': quota.quotaMode || 'full',
    'x-kelyra-quota-limit': quota.limit === null ? 'unlimited' : String(quota.limit),
    'x-kelyra-quota-used': String(quota.used),
    'x-kelyra-quota-remaining': quota.remaining === null ? 'unlimited' : String(quota.remaining),
    'x-kelyra-quota-reset': quota.resetAt,
  };
}

function quotaValuesForMode(tier, quotaMode) {
  return Object.fromEntries(QUOTA_KEYS.map((key) => [key, quotaLimitFor(tier, key, quotaMode)]));
}

async function quotaProfile(config, store, req, session) {
  const tier = tierForSession(config, session);
  const quotaMode = quotaModeForSession(session);
  const { windowId, resetAt } = quotaWindow();
  const ownerSub = session?.sub || anonymousSubject(req);
  const usageEntries = await Promise.all(QUOTA_KEYS.map((quotaKey) => store.getUsage(ownerSub, quotaKey, windowId)));
  const usage = Object.fromEntries(usageEntries.map((entry) => {
    const limit = quotaLimitFor(tier, entry.quotaKey, quotaMode);
    return [entry.quotaKey, {
      used: entry.used,
      limit: Number.isFinite(limit) ? limit : null,
      remaining: Number.isFinite(limit) ? Math.max(0, limit - entry.used) : null,
      resetAt: entry.resetAt || resetAt,
    }];
  }));

  return {
    ok: true,
    authenticated: Boolean(session),
    tier: tier ? {
      id: tier.id,
      name: tier.name,
      access: tier.hidden ? 'Internal access' : tier.access,
      minimum: tier.hidden ? 'Internal access only' : tier.minimum,
    } : null,
    quotaMode,
    window: { id: windowId, resetAt },
    quotas: {
      active: quotaValuesForMode(tier, quotaMode),
      full: quotaValuesForMode(tier, 'full'),
      fresh: quotaValuesForMode(tier, 'fresh'),
      usage,
    },
    tokenGate: session?.tokenGate || null,
  };
}

async function requireQuota(config, store, req, res, session, quotaKey) {
  if (!QUOTA_KEYS.includes(quotaKey)) {
    throw Object.assign(new Error('QUOTA_KEY_INVALID'), { status: 500 });
  }

  const tier = tierForSession(config, session);
  const quotaMode = quotaModeForSession(session);
  const limit = quotaLimitFor(tier, quotaKey, quotaMode);
  const { windowId, resetAt } = quotaWindow();
  const ownerSub = session?.sub || anonymousSubject(req);
  const result = await store.consumeUsage(ownerSub, quotaKey, limit, windowId, resetAt);
  const quota = {
    ...result,
    tierId: tier?.id || 'unknown',
    tierName: tier?.name || 'Unknown',
    quotaMode,
    windowId,
  };

  if (!quota.ok) {
    json(config, req, res, 429, {
      ok: false,
      error: 'QUOTA_EXCEEDED',
      quota,
    }, {
      ...quotaHeaders(quota),
      'retry-after': String(Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000))),
    });
    return null;
  }

  return quota;
}

function responseHeaders(config, req, extra = {}) {
  const origin = req.headers.origin;
  const cors = origin && config.allowedOrigins.includes(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        vary: 'Origin',
      }
    : {};

  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...cors,
    ...extra,
  };
}

function staticHeaders(contentType) {
  return {
    'cache-control': 'no-store, max-age=0',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    'content-type': contentType,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function previewHeaders() {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

function json(config, req, res, status, payload, extra = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, responseHeaders(config, req, {
    'content-type': 'application/json; charset=utf-8',
    ...extra,
  }));
  res.end(`${body}\n`);
}

function html(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...previewHeaders(),
    ...headers,
  });
  res.end(body);
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
  }
}

function requireAllowedOrigin(config, req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) return true;
  const origin = req.headers.origin;
  return !origin || config.allowedOrigins.includes(origin);
}

function getSession(config, req) {
  return verifySession(config, parseCookies(req).kelyra_session);
}

function requireSession(config, req, res) {
  const session = getSession(config, req);
  if (!session) {
    json(config, req, res, 401, { ok: false, error: 'AUTH_REQUIRED' });
    return null;
  }
  return session;
}

function requireMachineSession(config, req, res) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  if (!token || !safeEqual(token, config.apiSecret)) {
    json(config, req, res, 401, { ok: false, error: 'MACHINE_AUTH_REQUIRED' });
    return null;
  }
  return {
    sub: 'access-code',
    authMode: 'api-secret',
    tierId: config.tierConfig.accessCodeTierId || config.tierConfig.defaultTierId,
    quotaMode: 'full',
  };
}

function importedReceipt(body, fallbackOwnerSub) {
  const receipt = body?.receipt;
  if (!receipt || typeof receipt !== 'object') {
    throw Object.assign(new Error('RECEIPT_REQUIRED'), { status: 400 });
  }
  if (typeof receipt.id !== 'string' || !/^swd-[a-zA-Z0-9_-]+$/.test(receipt.id)) {
    throw Object.assign(new Error('RECEIPT_ID_INVALID'), { status: 400 });
  }
  if (receipt.version !== 1) {
    throw Object.assign(new Error('RECEIPT_VERSION_UNSUPPORTED'), { status: 400 });
  }
  if (!Array.isArray(receipt.files)) {
    throw Object.assign(new Error('RECEIPT_FILES_INVALID'), { status: 400 });
  }
  const ownerSub = typeof body.ownerSub === 'string' && body.ownerSub.trim()
    ? body.ownerSub.trim().slice(0, 120)
    : fallbackOwnerSub;
  return {
    ...receipt,
    ownerSub,
    importedAt: new Date().toISOString(),
    importSource: 'kelyra-cli',
  };
}

function safeLimit(value, fallback = 50, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.floor(number));
}

function redactedPrompt(value) {
  const addresses = [];
  const placeholder = (index) => `@@KELYRA_ADDRESS_${index}@@`;
  const input = String(value || '')
    .replace(/0x[a-fA-F0-9]{40}/g, (match) => {
      addresses.push(match);
      return placeholder(addresses.length - 1);
    });

  return input
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-...redacted')
    .replace(/\b((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s"'`]+/gi, '$1...redacted')
    .replace(/[A-Za-z0-9_-]{48,}/g, '...redacted-token...')
    .replace(/@@KELYRA_ADDRESS_(\d+)@@/g, (_, index) => addresses[Number(index)] || '')
    .trim()
    .slice(0, 4000);
}

function isBaseAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim());
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function txns24(pair) {
  const txns = pair?.txns?.h24 || {};
  return {
    buys: toNumber(txns.buys) || 0,
    sells: toNumber(txns.sells) || 0,
  };
}

function pairAgeHours(pair) {
  const createdAt = toNumber(pair?.pairCreatedAt);
  if (!createdAt) return null;
  return Math.max(0, (Date.now() - createdAt) / 3_600_000);
}

function buyPressure(pair) {
  const txns = txns24(pair);
  const total = txns.buys + txns.sells;
  return total > 0 ? txns.buys / total : null;
}

function riskFlags(pair) {
  const flags = [];
  const liquidity = toNumber(pair?.liquidity?.usd) || 0;
  const volume24h = toNumber(pair?.volume?.h24) || 0;
  const priceChange24h = toNumber(pair?.priceChange?.h24);
  const pressure = buyPressure(pair);
  const ageHours = pairAgeHours(pair);

  if (liquidity > 0 && liquidity < 15_000) flags.push('thin liquidity');
  if (ageHours !== null && ageHours < 6 && liquidity < 30_000) flags.push('very new thin pool');
  if (pressure !== null && (pressure < 0.3 || pressure > 0.82)) flags.push('one-sided flow');
  if (priceChange24h !== null && Math.abs(priceChange24h) > 80) flags.push('extreme 24h move');
  if (liquidity > 0 && volume24h / liquidity > 8) flags.push('high volume/liquidity churn');
  if (volume24h < 5_000) flags.push('low 24h volume sample');

  return flags;
}

function sourceHealth(pair) {
  const missing = [];
  if (!pair?.priceUsd) missing.push('price');
  if (!pair?.liquidity?.usd) missing.push('liquidity');
  if (!pair?.volume?.h24) missing.push('24h volume');
  if (!pair?.txns?.h24) missing.push('24h txns');
  return {
    ok: missing.length === 0,
    missing,
    source: 'DEX Screener public API',
    sourceUrl: pair?.url || null,
    fetchedAt: new Date().toISOString(),
  };
}

function normalizePair(pair, score = 0, lane = 'source') {
  const txns = txns24(pair);
  const pressure = buyPressure(pair);
  const ageHours = pairAgeHours(pair);
  const valuation = toNumber(pair?.marketCap) ?? toNumber(pair?.fdv);

  return {
    chainId: pair?.chainId || null,
    dexId: pair?.dexId || null,
    pairAddress: pair?.pairAddress || null,
    url: pair?.url || null,
    token: {
      address: pair?.baseToken?.address || null,
      name: pair?.baseToken?.name || null,
      symbol: pair?.baseToken?.symbol || null,
    },
    quote: {
      address: pair?.quoteToken?.address || null,
      symbol: pair?.quoteToken?.symbol || null,
    },
    priceUsd: toNumber(pair?.priceUsd),
    liquidityUsd: toNumber(pair?.liquidity?.usd),
    volume24h: toNumber(pair?.volume?.h24),
    txns24h: txns,
    buyPressure: pressure,
    priceChange24h: toNumber(pair?.priceChange?.h24),
    marketCap: toNumber(pair?.marketCap),
    fdv: toNumber(pair?.fdv),
    valuation,
    pairCreatedAt: toNumber(pair?.pairCreatedAt),
    ageHours,
    riskFlags: riskFlags(pair),
    score,
    lane,
    sourceHealth: sourceHealth(pair),
  };
}

async function fetchDex(path, ttlMs = DEX_CACHE_TTL_MS) {
  const url = `${DEXSCREENER_BASE}${path}`;
  const cached = dexCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DEX Screener ${response.status}`);
    const value = await response.json();
    dexCache.set(url, { expiresAt: Date.now() + ttlMs, value });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExplorer(config, params, ttlMs = EXPLORER_CACHE_TTL_MS) {
  if (!config?.baseScanApiKey) {
    throw Object.assign(new Error('EXPLORER_API_NOT_CONFIGURED'), { status: 424 });
  }

  const url = new URL(config.baseScanApiUrl || 'https://api.etherscan.io/v2/api');
  url.searchParams.set('chainid', String(BASE_CHAIN_ID));
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('apikey', config.baseScanApiKey);

  const cacheKey = url.toString().replace(config.baseScanApiKey, '<redacted>');
  const cached = explorerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Explorer API ${response.status}`);
    const value = await response.json();
    explorerCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function uniquePairs(pairs) {
  const byKey = new Map();
  for (const pair of pairs) {
    if (!pair || pair.chainId !== 'base') continue;
    const key = pair.pairAddress || `${pair.baseToken?.address}:${pair.quoteToken?.address}:${pair.dexId}`;
    if (!key || byKey.has(key)) continue;
    byKey.set(key, pair);
  }
  return [...byKey.values()];
}

async function tokenPairs(address) {
  if (!isBaseAddress(address)) return [];
  const pairs = await fetchDex(`/tokens/v1/base/${address}`);
  return Array.isArray(pairs) ? uniquePairs(pairs) : [];
}

async function searchBasePairs(query) {
  const search = await fetchDex(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  return uniquePairs(Array.isArray(search?.pairs) ? search.pairs : []);
}

function fulfilledValue(result, fallback = null) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

async function baseContractSnapshot(config, address) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return {
      ok: false,
      source: 'Base RPC',
      status: 'address_required',
      unknowns: ['contract bytecode', 'ERC-20 metadata'],
    };
  }

  const client = createPublicClient({
    chain: base,
    transport: http(config?.baseRpcUrl || 'https://mainnet.base.org'),
  });
  const [bytecodeResult, nameResult, symbolResult, decimalsResult, supplyResult] = await Promise.allSettled([
    client.getBytecode({ address: normalized }),
    client.readContract({ address: normalized, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: normalized, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: normalized, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: normalized, abi: erc20Abi, functionName: 'totalSupply' }),
  ]);
  const bytecode = fulfilledValue(bytecodeResult, '');
  const decimals = fulfilledValue(decimalsResult, null);
  const totalSupply = fulfilledValue(supplyResult, null);
  const hasErc20Metadata = nameResult.status === 'fulfilled' || symbolResult.status === 'fulfilled' || decimals !== null;
  const unknowns = [];
  if (!bytecode || bytecode === '0x') unknowns.push('contract bytecode');
  if (!hasErc20Metadata) unknowns.push('ERC-20 metadata');

  return {
    ok: true,
    source: 'Base RPC',
    sourceUrl: `https://basescan.org/address/${normalized}`,
    fetchedAt: new Date().toISOString(),
    address: normalized,
    hasBytecode: Boolean(bytecode && bytecode !== '0x'),
    erc20: {
      name: fulfilledValue(nameResult, null),
      symbol: fulfilledValue(symbolResult, null),
      decimals,
      totalSupply: totalSupply !== null ? totalSupply.toString() : null,
      totalSupplyFormatted: totalSupply !== null && decimals !== null
        ? formatTokenAmount(formatUnits(totalSupply, decimals))
        : null,
    },
    unknowns,
  };
}

function explorerResultOk(payload) {
  return payload?.status === '1' && payload.result !== undefined && payload.result !== null;
}

function firstExplorerRow(payload) {
  return Array.isArray(payload?.result) ? payload.result[0] || null : null;
}

function parseHolderCount(payload) {
  if (!explorerResultOk(payload)) return null;
  const value = Array.isArray(payload.result) ? payload.result[0] : payload.result;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function baseExplorerSnapshot(config, address) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return {
      ok: false,
      source: 'Etherscan API V2',
      status: 'address_required',
      unknowns: ['verified source code', 'deployer history', 'holder count'],
    };
  }

  if (!config?.baseScanApiKey) {
    return {
      ok: false,
      source: 'Etherscan API V2',
      status: 'not_configured',
      sourceUrl: `https://basescan.org/address/${normalized}`,
      unknowns: ['verified source code', 'deployer history', 'holder count'],
    };
  }

  const [sourceResult, creationResult, holderResult] = await Promise.allSettled([
    fetchExplorer(config, {
      module: 'contract',
      action: 'getsourcecode',
      address: normalized,
    }),
    fetchExplorer(config, {
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: normalized,
    }),
    fetchExplorer(config, {
      module: 'token',
      action: 'tokenholdercount',
      contractaddress: normalized,
    }),
  ]);

  const sourcePayload = fulfilledValue(sourceResult, null);
  const creationPayload = fulfilledValue(creationResult, null);
  const holderPayload = fulfilledValue(holderResult, null);
  const source = firstExplorerRow(sourcePayload);
  const creation = firstExplorerRow(creationPayload);
  const holderCount = parseHolderCount(holderPayload);
  const sourceCode = String(source?.SourceCode || '').trim();
  const abi = String(source?.ABI || '').trim();
  const verifiedSource = Boolean(sourceCode || (abi && !/not verified/i.test(abi)));
  const deployer = normalizeAddress(creation?.contractCreator || creation?.creator || '');
  const creationTxHash = creation?.txHash || creation?.transactionHash || null;
  const errors = [sourceResult, creationResult, holderResult]
    .filter((item) => item.status === 'rejected')
    .map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason));
  const unknowns = [];
  if (!explorerResultOk(sourcePayload)) unknowns.push('verified source code');
  if (!explorerResultOk(creationPayload) || !deployer) unknowns.push('deployer history');
  if (holderCount === null) unknowns.push('holder count');

  return {
    ok: errors.length < 3,
    source: 'Etherscan API V2',
    status: errors.length < 3 ? 'available' : 'unavailable',
    sourceUrl: `https://basescan.org/address/${normalized}`,
    fetchedAt: new Date().toISOString(),
    address: normalized,
    verifiedSource,
    contractName: source?.ContractName || null,
    compilerVersion: source?.CompilerVersion || null,
    licenseType: source?.LicenseType || null,
    proxy: source?.Proxy || null,
    implementation: normalizeAddress(source?.Implementation || '') || null,
    deployer,
    creationTxHash,
    holderCount,
    unknowns,
    errors,
  };
}

async function resolveOraclePairs(target) {
  const value = String(target || '').trim();
  const address = value.match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (address) return tokenPairs(address);
  return searchBasePairs(value.slice(0, 120));
}

function pairLiquiditySort(a, b) {
  return (toNumber(b?.liquidity?.usd) || 0) - (toNumber(a?.liquidity?.usd) || 0);
}

function momentumScore(pair) {
  const liquidity = toNumber(pair?.liquidity?.usd) || 0;
  const volume = toNumber(pair?.volume?.h24) || 0;
  const txns = txns24(pair);
  const txnsTotal = txns.buys + txns.sells;
  const pressure = buyPressure(pair) ?? 0.5;
  const change = toNumber(pair?.priceChange?.h24) || 0;
  const volumeLiquidity = liquidity > 0 ? volume / liquidity : 0;
  return volumeLiquidity * 35 + txnsTotal * 0.08 + Math.max(0, change) * 0.5 + pressure * 8;
}

function undervaluedEligible(pair) {
  const valuation = toNumber(pair?.marketCap) ?? toNumber(pair?.fdv);
  const liquidity = toNumber(pair?.liquidity?.usd) || 0;
  const volume = toNumber(pair?.volume?.h24) || 0;
  const txns = txns24(pair);
  const totalTxns = txns.buys + txns.sells;
  const pressure = buyPressure(pair);
  const volumeLiquidity = liquidity > 0 ? volume / liquidity : 0;
  const ageHours = pairAgeHours(pair);
  const change = Math.abs(toNumber(pair?.priceChange?.h24) || 0);

  return (
    valuation !== null &&
    valuation >= 25_000 &&
    valuation <= 25_000_000 &&
    liquidity >= 15_000 &&
    liquidity >= valuation * 0.015 &&
    volume >= 5_000 &&
    volume >= valuation * 0.02 &&
    totalTxns >= 20 &&
    pressure !== null &&
    pressure >= 0.3 &&
    pressure <= 0.82 &&
    volumeLiquidity >= 0.08 &&
    volumeLiquidity <= 8 &&
    (ageHours === null || ageHours >= 6) &&
    change <= 80
  );
}

function undervaluedScore(pair) {
  const valuation = toNumber(pair?.marketCap) ?? toNumber(pair?.fdv) ?? 1;
  const liquidity = toNumber(pair?.liquidity?.usd) || 0;
  const volume = toNumber(pair?.volume?.h24) || 0;
  const txns = txns24(pair);
  return (liquidity / valuation) * 80 + (volume / valuation) * 50 + (txns.buys + txns.sells) * 0.04;
}

async function pulseCandidates() {
  const [profiles, latestBoosts, topBoosts] = await Promise.all([
    fetchDex('/token-profiles/latest/v1', 60_000).catch(() => []),
    fetchDex('/token-boosts/latest/v1', 60_000).catch(() => []),
    fetchDex('/token-boosts/top/v1', 60_000).catch(() => []),
  ]);

  const addresses = [...profiles, ...latestBoosts, ...topBoosts]
    .filter((item) => item?.chainId === 'base' && isBaseAddress(item.tokenAddress))
    .map((item) => item.tokenAddress);
  const uniqueAddresses = [...new Set(addresses)].slice(0, 18);

  const settled = await Promise.allSettled(uniqueAddresses.map((address) => tokenPairs(address)));
  const pairs = settled.flatMap((item) => item.status === 'fulfilled' ? item.value : []);
  if (pairs.length > 0) return uniquePairs(pairs);

  return searchBasePairs('base');
}

function buildPulseLanes(pairs) {
  const momentum = [...pairs]
    .filter((pair) => (toNumber(pair?.liquidity?.usd) || 0) >= 15_000)
    .map((pair) => normalizePair(pair, momentumScore(pair), 'momentum'))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const fresh = [...pairs]
    .filter((pair) => pairAgeHours(pair) !== null)
    .map((pair) => normalizePair(pair, -(pairAgeHours(pair) || 0), 'fresh'))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const risk = [...pairs]
    .map((pair) => normalizePair(pair, riskFlags(pair).length, 'risk'))
    .filter((pair) => pair.riskFlags.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const undervalued = [...pairs]
    .filter(undervaluedEligible)
    .map((pair) => normalizePair(pair, undervaluedScore(pair), 'undervalued'))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return { momentum, fresh, risk, undervalued };
}

async function oraclePayload(targetValue, config = null) {
  const target = redactedPrompt(targetValue);
  if (!target) {
    throw Object.assign(new Error('Target is required.'), { status: 400 });
  }

  const pairs = (await resolveOraclePairs(target)).sort(pairLiquiditySort);
  if (pairs.length === 0) {
    throw Object.assign(new Error('No Base DEX pairs found for this target.'), {
      status: 404,
      payload: {
        ok: false,
        error: 'No Base DEX pairs found for this target.',
        target,
        source: 'DEX Screener public API',
      },
    });
  }

  const primary = pairs[0];
  const address = target.match(/0x[a-fA-F0-9]{40}/)?.[0] || primary?.baseToken?.address || '';
  const [contractResult, explorerResult] = config && address
    ? await Promise.allSettled([
        baseContractSnapshot(config, address),
        baseExplorerSnapshot(config, address),
      ])
    : [null, null];
  const contract = contractResult?.status === 'fulfilled'
    ? contractResult.value
    : address
      ? {
          ok: false,
          source: 'Base RPC',
          sourceUrl: `https://basescan.org/address/${normalizeAddress(address)}`,
          error: contractResult?.reason instanceof Error ? contractResult.reason.message : String(contractResult?.reason || 'unavailable'),
          unknowns: ['contract bytecode', 'ERC-20 metadata'],
        }
      : null;
  const explorer = explorerResult?.status === 'fulfilled'
    ? explorerResult.value
    : address
      ? {
          ok: false,
          source: 'Etherscan API V2',
          sourceUrl: `https://basescan.org/address/${normalizeAddress(address)}`,
          status: 'unavailable',
          error: explorerResult?.reason instanceof Error ? explorerResult.reason.message : String(explorerResult?.reason || 'unavailable'),
          unknowns: ['verified source code', 'deployer history', 'holder count'],
        }
      : null;
  const unknowns = [
    'holder concentration',
    'deployer history',
    'honeypot simulation',
    'LP lock state',
    'verified source code',
  ];
  if (explorer?.deployer) {
    const index = unknowns.indexOf('deployer history');
    if (index !== -1) unknowns.splice(index, 1);
  }
  if (explorer?.verifiedSource) {
    const index = unknowns.indexOf('verified source code');
    if (index !== -1) unknowns.splice(index, 1);
  }
  const normalized = pairs.slice(0, 8).map((pair, index) => normalizePair(pair, index === 0 ? 1 : 0, 'oracle'));
  return {
    ok: true,
    target,
    chainId: 'base',
    token: normalizePair(primary).token,
    contract,
    explorer,
    primary: normalized[0],
    pairs: normalized,
    unknowns,
    sources: [
      { label: 'DEX Screener public API', ok: true, url: primary?.url || null },
      { label: 'Base RPC contract metadata', ok: Boolean(contract?.ok), url: contract?.sourceUrl || null },
      { label: 'Etherscan API V2 explorer metadata', ok: Boolean(explorer?.ok), url: explorer?.sourceUrl || null },
    ],
    notes: [
      'Market and pair data are source-backed by DEX Screener.',
      'Contract bytecode and ERC-20 metadata are source-backed by Base RPC when a token address resolves.',
      'Explorer metadata is source-backed only when KELYRA_BASESCAN_API_KEY is configured.',
      'Unknown fields stay unknown until a wallet, explorer, or simulation source is connected.',
    ],
  };
}

async function pulsePayload() {
  const pairs = await pulseCandidates();
  return {
    ok: true,
    chainId: 'base',
    source: 'DEX Screener public API',
    fetchedAt: new Date().toISOString(),
    candidateCount: pairs.length,
    lanes: buildPulseLanes(pairs),
  };
}

function dataSummary(type, payload) {
  if (type.startsWith('pulse')) {
    const lanes = payload.lanes || {};
    const top = Object.entries(lanes)
      .map(([lane, items]) => `${lane}: ${(items || []).slice(0, 3).map((item) => item.token?.symbol || item.token?.name || 'unknown').join(', ') || 'none'}`)
      .join(' | ');
    return `Pulse lanes loaded from ${payload.source}. ${top}`;
  }

  if (type.startsWith('oracle') || type.startsWith('market')) {
    const token = payload.primary?.token || payload.token || {};
    return `${token.symbol || token.name || 'Token'} source-backed report: ${payload.primary?.liquidityUsd ?? 'unknown'} liquidity, ${payload.primary?.volume24h ?? 'unknown'} 24h volume.`;
  }

  if (type.startsWith('receipts') || type.startsWith('proof')) {
    return 'Proof state returned from the hosted Kelyra backend.';
  }

  return 'Kelyra bridge query completed.';
}

async function hostedDataQuery(input, context) {
  const type = String(input?.type || '').trim();
  const target = redactedPrompt(input?.target || input?.params?.target || input?.params?.address || '');
  const params = input?.params && typeof input.params === 'object' ? input.params : {};

  if (!type) {
    throw Object.assign(new Error('DATA_TYPE_REQUIRED'), { status: 400 });
  }

  let payload;
  if (type === 'pulse.lanes' || type === 'pulse.risk' || type === 'market.discovery') {
    payload = await pulsePayload();
  } else if (type === 'oracle.token') {
    payload = await oraclePayload(isBaseAddress(target) ? target : KELYRA_REFERENCE_TOKEN_ADDRESS, context.config);
  } else if (type === 'market.search') {
    payload = await oraclePayload(target || params.query || KELYRA_REFERENCE_TOKEN_ADDRESS, context.config);
  } else if (type === 'oracle.search') {
    payload = target ? await oraclePayload(target, context.config) : await pulsePayload();
  } else if (type === 'receipts.list') {
    payload = {
      ok: true,
      receipts: await context.store.listReceipts(safeLimit(params.limit, 10, 50), context.session.sub),
    };
  } else if (type === 'receipts.latest' || type === 'proof.verify') {
    const receipts = await context.store.listReceipts(1, context.session.sub);
    const jobs = receipts.length ? [] : await context.store.listProofJobs(context.session.sub, 1);
    payload = {
      ok: true,
      receipt: receipts[0] || null,
      job: jobs[0] || null,
      state: receipts[0] ? 'receipt_found' : jobs[0]?.status || 'empty',
    };
  } else if (type === 'workspace.context') {
    payload = {
      ok: true,
      mode: 'hosted',
      runnerMode: context.config.runnerMode,
      receipts: await context.store.listReceipts(5, context.session.sub),
      jobs: await context.store.listProofJobs(context.session.sub, 5),
    };
  } else {
    throw Object.assign(new Error(`Unsupported Kelyra bridge type: ${type}`), { status: 400 });
  }

  return {
    ok: true,
    type,
    target: target || null,
    summary: dataSummary(type, payload),
    payload,
  };
}

function isPathInside(root, target) {
  const rel = relative(root, target);
  return Boolean(rel) && !rel.startsWith('..') && !resolve(rel).startsWith('..');
}

async function serveStatic(config, req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }

  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/console') pathname = '/console.html';
  if (pathname.endsWith('/')) pathname = `${pathname}index.html`;

  const filePath = resolve(config.staticDir, `.${pathname}`);
  if (!isPathInside(config.staticDir, filePath)) return false;

  try {
    const content = await readFile(filePath);
    const type = mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
    res.writeHead(200, staticHeaders(type));
    res.end(req.method === 'HEAD' ? undefined : content);
    return true;
  } catch {
    return false;
  }
}

async function getOwnedApp(store, session, slug) {
  const app = await store.getForgeApp(slug);
  if (!app || app.ownerSub !== session.sub) return null;
  return app;
}

async function updateForgeAppProofState(store, job, patch) {
  if (!job?.id || typeof store.findForgeAppByProofJobId !== 'function') return null;
  const app = await store.findForgeAppByProofJobId(job.id, job.ownerSub).catch(() => null);
  if (!app) return null;
  const updated = {
    ...app,
    ...patch,
    proofJobStatus: patch.proofJobStatus || patch.proofStatus || app.proofJobStatus || null,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  };
  await store.updateForgeApp(updated);
  return updated;
}

export async function runProofWorkerOnce(store, options = {}) {
  const workerId = options.workerId || `worker_${randomBytes(6).toString('hex')}`;
  const job = await store.claimNextProofJob(workerId);
  if (!job) return { ok: true, processed: false };

  try {
    const receipt = buildHostedReceipt(job, workerId);
    await store.createReceipt(receipt);
    const completed = {
      ...job,
      status: 'completed',
      updatedAt: receipt.timestamp,
      completedAt: receipt.timestamp,
      receiptId: receipt.id,
      result: {
        receiptId: receipt.id,
        summary: receipt.summary,
      },
    };
    await store.updateProofJob(completed);
    const app = await updateForgeAppProofState(store, completed, {
      proofStatus: 'verified',
      proofJobStatus: 'completed',
      receiptId: receipt.id,
      proofCompletedAt: receipt.timestamp,
      proofError: null,
      updatedAt: receipt.timestamp,
    });
    return { ok: true, processed: true, job: completed, receipt, app: publicForgeApp(app) };
  } catch (err) {
    const now = new Date().toISOString();
    const failed = {
      ...job,
      status: 'failed',
      updatedAt: now,
      failedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
    await store.updateProofJob(failed);
    const app = await updateForgeAppProofState(store, failed, {
      proofStatus: 'failed',
      proofJobStatus: 'failed',
      proofError: failed.error,
      updatedAt: now,
    });
    return { ok: false, processed: true, job: failed, app: publicForgeApp(app), error: failed.error };
  }
}

export function createKelyraApiServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const store = options.store || createStore(config);
  const rateLimit = createRateLimiter(config);
  const resolveTokenHolderStatus = options.tokenHolderStatus || tokenHolderStatus;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://kelyra.local');

      if (req.method === 'OPTIONS') {
        res.writeHead(204, responseHeaders(config, req, {
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-max-age': '600',
        }));
        res.end();
        return;
      }

      const limited = rateLimit(req);
      if (!limited.ok) {
        json(config, req, res, 429, { ok: false, error: 'RATE_LIMITED', retryAfter: limited.retryAfter }, {
          'retry-after': String(limited.retryAfter),
        });
        return;
      }

      if (!requireAllowedOrigin(config, req)) {
        json(config, req, res, 403, { ok: false, error: 'ORIGIN_NOT_ALLOWED' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(config, req, res, 200, {
          ok: true,
          service: 'kelyra-api',
          environment: config.environment,
          runnerMode: config.runnerMode,
          store: config.databaseUrl ? 'postgres' : 'file',
          static: true,
          features: {
            auth: config.accessCodeEnabled ? 'access-code-beta+wallet' : 'wallet',
            accessCodeBeta: config.accessCodeEnabled,
            tokenGate: config.requireTokenHolder,
            tiers: true,
            pulse: true,
            oracle: true,
            explorer: Boolean(config.baseScanApiKey),
            proofJobs: true,
            forgeApps: true,
            hostedWorker: config.runnerMode === 'hosted-worker',
          },
        });
        return;
	      }

	      if (req.method === 'GET' && url.pathname === '/api/tiers') {
	        const session = getSession(config, req);
	        const currentTier = tierForSession(config, session);
	        json(config, req, res, 200, {
	          ok: true,
	          ...publicTierConfig(config),
	          currentTier: currentTier ? {
	            id: currentTier.id,
	            name: currentTier.name,
	            authenticated: Boolean(session),
	          } : null,
	        });
	        return;
	      }

	      if (req.method === 'GET' && url.pathname === '/api/auth/session') {
        const session = getSession(config, req);
        json(config, req, res, 200, {
          ok: true,
          authenticated: Boolean(session),
          authMode: config.accessCodeEnabled ? 'access-code-beta+wallet' : 'wallet',
          session: session ? {
	            sub: session.sub,
	            authMode: session.authMode || 'access-code',
	            tierId: session.tierId || tierForSession(config, session)?.id || null,
	            tier: tierForSession(config, session) ? {
	              id: tierForSession(config, session).id,
	              name: tierForSession(config, session).name,
	            } : null,
	            wallet: session.wallet || null,
            tokenGate: session.tokenGate || null,
            quotaMode: quotaModeForSession(session),
            iat: session.iat,
            exp: session.exp,
          } : null,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/quota/profile') {
        const session = getSession(config, req);
        json(config, req, res, 200, await quotaProfile(config, store, req, session));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        if (!config.accessCodeEnabled) {
          json(config, req, res, 403, { ok: false, error: 'ACCESS_CODE_DISABLED' });
          return;
        }
        const body = await readJsonBody(req);
        if (!safeEqual(sha256(body.accessCode || ''), config.accessCodeHash)) {
          json(config, req, res, 403, { ok: false, error: 'ACCESS_DENIED' });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const token = signSession(config, {
          sid: randomBytes(16).toString('hex'),
	          sub: 'access-code',
	          authMode: 'access-code',
	          tierId: config.tierConfig.accessCodeTierId,
	          quotaMode: 'full',
	          iat: now,
          exp: now + config.sessionTtlSeconds,
        });
        json(config, req, res, 200, { ok: true, authenticated: true }, {
          'set-cookie': sessionCookie(config, token),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/wallet/nonce') {
        const body = await readJsonBody(req);
        const address = normalizeAddress(body.address);
        if (!address) {
          json(config, req, res, 400, { ok: false, error: 'ADDRESS_INVALID' });
          return;
        }
        const nonceRecord = await store.createAuthNonce(buildAuthNonce(config, address));
        json(config, req, res, 200, {
          ok: true,
          address,
          chainId: BASE_CHAIN_ID,
          nonce: nonceRecord.nonce,
          message: nonceRecord.message,
          expiresAt: nonceRecord.expiresAt,
	          tokenGate: {
	            required: config.requireTokenHolder,
	            tokenAddress: config.tokenAddress,
	            symbol: config.tierConfig.token?.symbol || 'KELYRA',
	            minimum: config.tokenMinBalance,
	            thresholds: tokenThresholds(config),
	          },
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/wallet/verify') {
        const body = await readJsonBody(req);
        const address = normalizeAddress(body.address);
        const message = String(body.message || '');
        const signature = String(body.signature || '');
        const parsed = parseWalletAuthMessage(message);
        if (!address || !signature || !parsed.nonce || parsed.address !== address) {
          json(config, req, res, 400, { ok: false, error: 'WALLET_AUTH_INVALID' });
          return;
        }

        const nonceRecord = await store.useAuthNonce(address, parsed.nonce);
        if (!nonceRecord || nonceRecord.message !== message) {
          json(config, req, res, 403, { ok: false, error: 'NONCE_INVALID_OR_EXPIRED' });
          return;
        }

        const verified = await verifyMessage({
          address,
          message,
          signature,
        }).catch(() => false);
        if (!verified) {
          json(config, req, res, 403, { ok: false, error: 'SIGNATURE_INVALID' });
          return;
        }

	        const tokenGate = await resolveTokenHolderStatus(config, address).catch((err) => {
          throw Object.assign(new Error(err instanceof Error ? err.message : 'TOKEN_GATE_UNAVAILABLE'), { status: 503 });
        });
        if (!tokenGate.ok) {
          json(config, req, res, 403, { ok: false, error: 'TOKEN_HOLDER_REQUIRED', tokenGate });
          return;
        }
        const quotaTokenGate = await applyHolderQuotaMode(config, store, address, tokenGate);

        const now = Math.floor(Date.now() / 1000);
        const token = signSession(config, {
          sid: randomBytes(16).toString('hex'),
          sub: `wallet:${address}`,
	          authMode: 'wallet',
	          wallet: { address, chainId: BASE_CHAIN_ID },
	          tokenGate: quotaTokenGate,
	          tierId: quotaTokenGate.tierId,
	          quotaMode: quotaTokenGate.quotaMode,
	          iat: now,
          exp: now + config.sessionTtlSeconds,
        });
        json(config, req, res, 200, {
          ok: true,
          authenticated: true,
	          wallet: { address, chainId: BASE_CHAIN_ID },
	          tokenGate: quotaTokenGate,
	          tier: quotaTokenGate.tierId ? { id: quotaTokenGate.tierId, name: quotaTokenGate.tierName } : null,
	        }, {
          'set-cookie': sessionCookie(config, token),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        json(config, req, res, 200, { ok: true, authenticated: false }, {
          'set-cookie': sessionCookie(config, '', 0),
        });
        return;
      }

	      if (req.method === 'GET' && url.pathname === '/api/pulse') {
	        const quota = await requireQuota(config, store, req, res, getSession(config, req), 'dataCalls');
	        if (!quota) return;
	        json(config, req, res, 200, { ...(await pulsePayload()), quota }, quotaHeaders(quota));
	        return;
	      }

	      if (req.method === 'POST' && url.pathname === '/api/oracle/analyze') {
	        const body = await readJsonBody(req);
	        const quota = await requireQuota(config, store, req, res, getSession(config, req), 'oracleMessages');
	        if (!quota) return;
	        json(config, req, res, 200, { ...(await oraclePayload(body.target || body.prompt, config)), quota }, quotaHeaders(quota));
	        return;
	      }

	      if (req.method === 'POST' && url.pathname === '/api/data') {
	        const session = requireSession(config, req, res);
	        if (!session) return;
	        const quota = await requireQuota(config, store, req, res, session, 'dataCalls');
	        if (!quota) return;
	        const body = await readJsonBody(req);
	        json(config, req, res, 200, { ...(await hostedDataQuery(body, { config, store, session })), quota }, quotaHeaders(quota));
	        return;
	      }

      if (req.method === 'GET' && url.pathname === '/api/receipts') {
        const session = requireSession(config, req, res);
        if (!session) return;
        json(config, req, res, 200, {
          ok: true,
          receipts: await store.listReceipts(50, session.sub),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/receipts/import') {
        const session = requireMachineSession(config, req, res);
        if (!session) return;
        const body = await readJsonBody(req);
        const receipt = importedReceipt(body, session.sub);
        await store.createReceipt(receipt);
        json(config, req, res, 201, {
          ok: true,
          receiptId: receipt.id,
          ownerSub: receipt.ownerSub,
          receipt,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/proof/jobs') {
        const session = requireSession(config, req, res);
        if (!session) return;
        json(config, req, res, 200, {
          ok: true,
          jobs: await store.listProofJobs(session.sub, safeLimit(url.searchParams.get('limit'), 50, 100)),
        });
        return;
      }

	      if (req.method === 'POST' && url.pathname === '/api/proof/jobs') {
	        const session = requireSession(config, req, res);
	        if (!session) return;
	        const body = await readJsonBody(req);
	        const prompt = String(body.prompt || '').trim();
	        if (!prompt) {
	          json(config, req, res, 400, { ok: false, error: 'PROMPT_REQUIRED' });
	          return;
	        }
	        const quota = await requireQuota(config, store, req, res, session, 'proofJobs');
	        if (!quota) return;
	        const job = await store.createProofJob({
          prompt,
          ownerSub: session.sub,
          workspaceRef: typeof body.workspaceRef === 'string' ? body.workspaceRef.slice(0, 200) : '',
          runnerMode: config.runnerMode,
        });
	        json(config, req, res, 202, { ok: true, job, quota }, quotaHeaders(quota));
	        return;
	      }

      const jobMatch = url.pathname.match(/^\/api\/proof\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && jobMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const job = await store.getProofJob(jobMatch[1]);
        if (!job || job.ownerSub !== session.sub) {
          json(config, req, res, 404, { ok: false, error: 'JOB_NOT_FOUND' });
          return;
        }
        json(config, req, res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/apps') {
        const session = requireSession(config, req, res);
        if (!session) return;
        const apps = await store.listForgeApps(session.sub, safeLimit(url.searchParams.get('limit'), 50, 100));
        json(config, req, res, 200, { ok: true, apps: apps.map(publicForgeApp) });
        return;
      }

	      if (req.method === 'POST' && url.pathname === '/api/apps/build') {
	        const session = requireSession(config, req, res);
	        if (!session) return;
	        const body = await readJsonBody(req);
	        const prompt = String(body.prompt || '').trim();
	        if (!prompt) {
          json(config, req, res, 400, { ok: false, error: 'PROMPT_REQUIRED' });
          return;
        }
        if (prompt.length > 4000) {
	          json(config, req, res, 400, { ok: false, error: 'PROMPT_TOO_LONG' });
	          return;
	        }
	        const quota = await requireQuota(config, store, req, res, session, 'buildActions');
	        if (!quota) return;
	        const job = await store.createProofJob({
          prompt: `Hosted Forge draft: ${prompt}`,
          ownerSub: session.sub,
          workspaceRef: 'hosted-forge',
          runnerMode: config.runnerMode,
        });
        const app = await store.createForgeApp({
          prompt,
          ownerSub: session.sub,
          proofJobId: job.id,
        });
	        json(config, req, res, 201, { ok: true, app: publicForgeApp(app), job, quota }, quotaHeaders(quota));
	        return;
	      }

      const appMatch = url.pathname.match(/^\/api\/apps\/([^/]+)$/);
      if (req.method === 'GET' && appMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const app = await getOwnedApp(store, session, appMatch[1]);
        if (!app) {
          json(config, req, res, 404, { ok: false, error: 'APP_NOT_FOUND' });
          return;
        }
        json(config, req, res, 200, { ok: true, app: publicForgeApp(app) });
        return;
      }

      if (req.method === 'PATCH' && appMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const app = await getOwnedApp(store, session, appMatch[1]);
        if (!app) {
          json(config, req, res, 404, { ok: false, error: 'APP_NOT_FOUND' });
          return;
        }
        const body = await readJsonBody(req);
        const prompt = String(body.prompt || body.brief || app.promptPreview || app.title || '').trim();
        if (!prompt) {
          json(config, req, res, 400, { ok: false, error: 'PROMPT_REQUIRED' });
          return;
        }
        if (prompt.length > 4000) {
          json(config, req, res, 400, { ok: false, error: 'PROMPT_TOO_LONG' });
          return;
        }
        const quota = await requireQuota(config, store, req, res, session, 'buildActions');
        if (!quota) return;
        const job = await store.createProofJob({
          prompt: `Hosted Forge revision: ${prompt}`,
          ownerSub: session.sub,
          workspaceRef: `hosted-forge:${app.slug}`,
          runnerMode: config.runnerMode,
        });
        const updated = buildForgeApp({
          prompt,
          ownerSub: session.sub,
          proofJobId: job.id,
          previous: app,
          status: 'draft',
        });
        await store.updateForgeApp(updated);
        json(config, req, res, 200, { ok: true, app: publicForgeApp(updated), job, quota }, quotaHeaders(quota));
        return;
      }

      if (req.method === 'DELETE' && appMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const deleted = await store.deleteForgeApp(appMatch[1], session.sub);
        if (!deleted) {
          json(config, req, res, 404, { ok: false, error: 'APP_NOT_FOUND' });
          return;
        }
        json(config, req, res, 200, { ok: true, deleted: true });
        return;
      }

      const publishMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/publish$/);
      if (req.method === 'POST' && publishMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const app = await getOwnedApp(store, session, publishMatch[1]);
        if (!app) {
          json(config, req, res, 404, { ok: false, error: 'APP_NOT_FOUND' });
          return;
        }
        const published = {
          ...app,
          status: 'published',
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          publicUrl: app.previewUrl || `/api/apps/${app.slug}/preview`,
        };
        await store.updateForgeApp(published);
        json(config, req, res, 200, { ok: true, app: publicForgeApp(published) });
        return;
      }

      const assetMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/assets\/([^/]+)$/);
      if (req.method === 'GET' && assetMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const app = await getOwnedApp(store, session, assetMatch[1]);
        const assetName = assetMatch[2];
        const content = app?.assets?.[assetName];
        if (!app || content === undefined) {
          json(config, req, res, 404, { ok: false, error: 'ASSET_NOT_FOUND' });
          return;
        }
        const type = mimeTypes.get(extname(assetName).toLowerCase()) || 'text/plain; charset=utf-8';
        res.writeHead(200, responseHeaders(config, req, { 'content-type': type }));
        res.end(content);
        return;
      }

      const previewMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/preview$/);
      if (req.method === 'GET' && previewMatch) {
        const session = requireSession(config, req, res);
        if (!session) return;
        const app = await getOwnedApp(store, session, previewMatch[1]);
        if (!app) {
          json(config, req, res, 404, { ok: false, error: 'APP_NOT_FOUND' });
          return;
        }
        html(res, 200, app.assets?.['index.html'] || hostedForgeHtml(app));
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        json(config, req, res, 404, { ok: false, error: 'NOT_FOUND' });
        return;
      }

      if (await serveStatic(config, req, res, url)) return;

      json(config, req, res, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (err) {
      const status = Number(err?.status || 500);
      json(config, req, res, status, err?.payload || {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { config, server, store };
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const { config, server } = createKelyraApiServer();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Kelyra API listening on :${config.port}`);
    console.log(`Environment: ${config.environment}`);
    console.log(`Runner mode: ${config.runnerMode}`);
    console.log(`Store: ${config.databaseUrl ? 'postgres' : 'file'}`);
  });
}
