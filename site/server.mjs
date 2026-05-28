import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyExternalAgentActions,
  createProofBundle,
  listReceipts,
  parseActions,
  sendMessage,
  SWDEngine,
  KELYRA_SYSTEM_PROMPT,
  MODELS,
} from '../dist/index.js';

const siteDir = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = resolve(siteDir, '..');
const workspaceRoot = resolve(process.env.KELYRA_CONSOLE_CWD || process.cwd());
const port = Number(process.env.PORT || 4340);
const host = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const DEXSCREENER_BASE = 'https://api.dexscreener.com';
const DEX_CACHE_TTL_MS = 120_000;
const KELYRA_REFERENCE_TOKEN_ADDRESS = '0x4200000000000000000000000000000000000006';
const dexCache = new Map();

process.chdir(workspaceRoot);

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

const cleanStaticRoutes = new Map([
  ['/console', '/console.html'],
  ['/protocol', '/protocol.html'],
  ['/tiers', '/tiers.html'],
]);

const staticRouteRedirects = new Map([
  ['/index.html', '/'],
  ['/console.html', '/console'],
  ['/protocol.html', '/protocol'],
  ['/tiers.html', '/tiers'],
  ['/console/', '/console'],
  ['/protocol/', '/protocol'],
  ['/tiers/', '/tiers'],
]);

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(`${body}\n`);
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
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-…redacted')
    .replace(/\b((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s"'`]+/gi, '$1…redacted')
    .replace(/[A-Za-z0-9_-]{48,}/g, '…redacted-token…')
    .replace(/@@KELYRA_ADDRESS_(\d+)@@/g, (_, index) => addresses[Number(index)] || '')
    .trim()
    .slice(0, 4000);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  if (kind === 'risk-scanner') return ['oracle.token', 'oracle.wallet', 'pulse.risk'];
  if (kind === 'market-dashboard') return ['pulse.lanes', 'oracle.token', 'market.search'];
  return ['workspace.context', 'proof.create', 'oracle.search'];
}

function forgeAppFiles({ prompt, slug, title, kind, generatedAt }) {
  const capabilities = forgeCapabilities(kind);
  const bridgeCalls = forgeBridgeCalls(kind);
  const appDir = `.kelyra/forge/${slug}`;
  const safeTitle = escapeHtml(title);
  const manifest = {
    schema: 'kelyra.forge.v1',
    slug,
    title,
    kind,
    generatedAt,
    promptHash: sha256(prompt),
    sourceDiscipline: 'Unknown values must stay unknown unless returned by an approved Kelyra bridge call.',
    sandbox: {
      externalScripts: false,
      directBrowserFetch: false,
      unsafeInlineHandlers: false,
      bridgeApi: 'window.kelyraQuery(type, target, params)',
    },
    bridgeCalls,
    capabilities,
    files: ['index.html', 'styles.css', 'script.js'],
  };

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <main class="app-shell">
      <header>
        <span>Kelyra Forge</span>
        <h1>${safeTitle}</h1>
        <p>This tool is generated as a sandbox-safe draft. Live values must come from the approved bridge, never from hard-coded metrics.</p>
      </header>
      <section class="panel">
        <div>
          <span>Source status</span>
          <strong data-status>Bridge not connected in static preview</strong>
        </div>
        <button type="button" data-run>Run bridge query</button>
      </section>
      <section class="grid" data-output>
        <article>
          <span>Kind</span>
          <strong>${kind}</strong>
          <p>Prompt-backed app scaffold with explicit unknowns.</p>
        </article>
        <article>
          <span>Bridge calls</span>
          <strong>${bridgeCalls.length}</strong>
          <p>${bridgeCalls.join(', ')}</p>
        </article>
        <article>
          <span>Capabilities</span>
          <strong>${capabilities.length}</strong>
          <p>${capabilities.join(', ')}</p>
        </article>
      </section>
    </main>
    <script src="/forge-bridge.js"></script>
    <script src="./script.js"></script>
  </body>
</html>`;

  const stylesCss = `:root {
  color-scheme: dark;
  --bg: #08090d;
  --panel: #11151b;
  --line: rgba(255,255,255,.12);
  --text: #f5f2f7;
  --muted: #aaa5b3;
  --accent: #7de9f0;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at 20% 0%, rgba(125,233,240,.12), transparent 34%), var(--bg);
  color: var(--text);
  font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.app-shell {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 48px 0;
}
header span,
.panel span,
.grid span {
  color: var(--accent);
  font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
h1 {
  max-width: 760px;
  margin: 12px 0;
  font-size: clamp(42px, 7vw, 84px);
  line-height: .96;
}
p { color: var(--muted); }
.panel,
.grid article {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(17,21,27,.76);
}
.panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 28px 0 14px;
  padding: 18px;
}
button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(125,233,240,.35);
  border-radius: 8px;
  background: rgba(125,233,240,.08);
  color: var(--accent);
  font-weight: 800;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.grid article { min-height: 170px; padding: 18px; }
.grid strong { display: block; margin: 10px 0; font-size: 26px; }
@media (max-width: 780px) {
  .panel { align-items: flex-start; flex-direction: column; }
  .grid { grid-template-columns: 1fr; }
}`;

  const scriptJs = `const statusNode = document.querySelector('[data-status]');
const outputNode = document.querySelector('[data-output]');

async function runBridgeQuery() {
  if (typeof window.kelyraQuery !== 'function') {
    statusNode.textContent = 'Bridge unavailable in static preview';
    return;
  }

  statusNode.textContent = 'Loading source data...';
  try {
    const result = await window.kelyraQuery('${bridgeCalls[0]}', '${kind}', { sourceDiscipline: true });
    statusNode.textContent = result?.ok ? 'Source data loaded' : 'Bridge returned a source gap';
    const card = document.createElement('article');
    card.innerHTML = '<span>Latest bridge result</span><strong></strong><p></p>';
    card.querySelector('strong').textContent = result?.ok ? 'Resolved' : 'Unknown';
    card.querySelector('p').textContent = result?.summary || result?.error || 'No source-backed summary returned.';
    outputNode.prepend(card);
  } catch (error) {
    statusNode.textContent = 'Bridge error';
    const card = document.createElement('article');
    card.innerHTML = '<span>Error</span><strong>Unknown</strong><p></p>';
    card.querySelector('p').textContent = error instanceof Error ? error.message : String(error);
    outputNode.prepend(card);
  }
}

document.querySelector('[data-run]')?.addEventListener('click', runBridgeQuery);`;

  return [
    { path: `${appDir}/manifest.json`, content: JSON.stringify(manifest, null, 2) },
    { path: `${appDir}/index.html`, content: indexHtml },
    { path: `${appDir}/styles.css`, content: stylesCss },
    { path: `${appDir}/script.js`, content: scriptJs },
  ];
}

function forgePreviewUrl(slug) {
  return `/forge/${encodeURIComponent(slug)}/index.html`;
}

function safeForgeSlug(value) {
  const slug = String(value || '').trim();
  return /^[a-z0-9][a-z0-9-]{1,90}$/.test(slug) ? slug : null;
}

async function forgeAppSummary(slug) {
  const safeSlug = safeForgeSlug(slug);
  if (!safeSlug) return null;
  const appDir = resolve(workspaceRoot, '.kelyra', 'forge', safeSlug);
  if (!appDir.startsWith(resolve(workspaceRoot, '.kelyra', 'forge'))) return null;

  const manifestPath = resolve(appDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  const entries = await readdir(appDir, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const filePath = resolve(appDir, entry.name);
      const fileStat = await stat(filePath);
      return {
        path: `.kelyra/forge/${safeSlug}/${entry.name}`,
        bytes: fileStat.size,
      };
    }));

  return {
    slug: safeSlug,
    title: manifest.title || safeSlug,
    kind: manifest.kind || 'app',
    generatedAt: manifest.generatedAt || null,
    workspacePath: `.kelyra/forge/${safeSlug}`,
    previewUrl: forgePreviewUrl(safeSlug),
    bridgeCalls: Array.isArray(manifest.bridgeCalls) ? manifest.bridgeCalls : [],
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
    files,
  };
}

async function listForgeApps() {
  const forgeRoot = resolve(workspaceRoot, '.kelyra', 'forge');
  try {
    const entries = await readdir(forgeRoot, { withFileTypes: true });
    const apps = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const summary = await forgeAppSummary(entry.name);
        if (summary) apps.push(summary);
      } catch {
        // Ignore incomplete draft directories.
      }
    }
    return apps.sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
  } catch {
    return [];
  }
}

async function buildForgeApp(req, res) {
  const body = await readJsonBody(req);
  const prompt = redactedPrompt(body.prompt);
  if (!prompt) {
    json(res, 400, { ok: false, error: 'Prompt is required.' });
    return;
  }

  const kind = classifyForgeApp(prompt);
  const title = titleFromPrompt(prompt);
  const slug = slugify(`${title}-${prompt}`);
  const generatedAt = new Date().toISOString();
  const files = forgeAppFiles({ prompt, slug, title, kind, generatedAt });
  await mkdir(resolve(workspaceRoot, '.kelyra', 'forge', slug), { recursive: true });
  const rawInput = JSON.stringify({
    request: `Kelyra Forge build: ${prompt.slice(0, 120)}`,
    summary: `Forge generated ${title} as a sandbox-safe app draft`,
    agent: {
      id: 'kelyra-forge',
      model: 'deterministic-safe-scaffold',
    },
    actions: files.map((file) => ({
      path: file.path,
      operation: existsSync(resolve(workspaceRoot, file.path)) ? 'MODIFY' : 'CREATE',
      intent: 'MUTATE',
      description: `Write Forge app file ${file.path}`,
      content: file.content,
      contentHash: sha256(file.content),
    })),
    metadata: {
      surface: 'kelyra-forge',
      kind,
      slug,
    },
  });

  const swd = await applyExternalAgentActions({
    rawInput,
    agentId: 'kelyra-forge',
    modelId: 'deterministic-safe-scaffold',
    request: `Kelyra Forge build: ${prompt.slice(0, 120)}`,
    summary: `Forge generated ${title} as a sandbox-safe app draft`,
  });

  if (!swd.ok || !swd.receipt?.id) {
    json(res, 422, { ok: false, swd });
    return;
  }

  json(res, 200, {
    ok: true,
    app: {
      slug,
      title,
      kind,
      generatedAt,
      workspacePath: `.kelyra/forge/${slug}`,
      previewUrl: forgePreviewUrl(slug),
      receiptId: swd.receipt.id,
      bridgeCalls: forgeBridgeCalls(kind),
      capabilities: forgeCapabilities(kind),
      files: files.map((file) => ({
        path: file.path,
        bytes: Buffer.byteLength(file.content, 'utf8'),
      })),
    },
    swd,
  });
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

async function oraclePayload(targetValue) {
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
  const normalized = pairs.slice(0, 8).map((pair, index) => normalizePair(pair, index === 0 ? 1 : 0, 'oracle'));
  return {
    ok: true,
    target,
    chainId: 'base',
    token: normalizePair(primary).token,
    primary: normalized[0],
    pairs: normalized,
    unknowns: [
      'holder concentration',
      'deployer history',
      'honeypot simulation',
      'LP lock state',
      'verified source code',
    ],
    notes: [
      'This Oracle view is source-backed by DEX Screener market/pair data only.',
      'Unknown fields stay unknown until a wallet, explorer, or simulation source is connected.',
    ],
  };
}

async function oracleAnalysis(req, res) {
  const body = await readJsonBody(req);
  const target = body.target || body.prompt;
  json(res, 200, await oraclePayload(target));
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

async function pulseData(res) {
  json(res, 200, await pulsePayload());
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
    return 'Proof data returned from the local SWD runtime.';
  }

  return 'Kelyra bridge query completed.';
}

async function localDataQuery(input) {
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
    payload = await oraclePayload(isBaseAddress(target) ? target : KELYRA_REFERENCE_TOKEN_ADDRESS);
  } else if (type === 'market.search') {
    payload = await oraclePayload(target || params.query || KELYRA_REFERENCE_TOKEN_ADDRESS);
  } else if (type === 'oracle.search') {
    payload = target ? await oraclePayload(target) : await pulsePayload();
  } else if (type === 'receipts.list') {
    payload = { ok: true, receipts: listReceipts(Number(params.limit || 10)) };
  } else if (type === 'receipts.latest' || type === 'proof.verify') {
    const bundle = createProofBundle('latest');
    payload = { ok: true, proof: proofSummary(bundle) };
  } else if (type === 'workspace.context') {
    payload = {
      ok: true,
      workspace: workspaceRoot,
      providers: providerReport(),
      receipts: listReceipts(5),
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

async function localData(req, res) {
  const body = await readJsonBody(req);
  json(res, 200, await localDataQuery(body));
}

function providerReport() {
  const effort = consoleAgentEffort();
  const providers = {
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      envVar: 'ANTHROPIC_API_KEY',
      configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      valid: !process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY.trim().startsWith('sk-ant-'),
      model: MODELS[effort] || MODELS.high,
    },
    openai: {
      id: 'openai',
      name: 'OpenAI (GPT)',
      envVar: 'OPENAI_API_KEY',
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      valid: true,
      model: 'gpt-4o',
    },
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      envVar: 'DEEPSEEK_API_KEY',
      configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      valid: true,
      model: 'deepseek-chat',
    },
  };
  const agentChatRunAvailable = Object.values(providers).some((provider) => provider.configured && provider.valid);
  const preferredProvider = Object.values(providers).find((provider) => provider.configured && provider.valid) || null;

  return {
    agentChatRunAvailable,
    consoleAgent: {
      effort,
      provider: preferredProvider?.id || null,
      providerName: preferredProvider?.name || null,
      model: preferredProvider?.model || null,
    },
    providers,
  };
}

function consoleAgentEffort(value = process.env.KELYRA_CONSOLE_AGENT_EFFORT) {
  const effort = String(value || '').trim().toLowerCase();
  return ['high', 'medium', 'low'].includes(effort) ? effort : 'high';
}

function consoleAgentMaxTokens(value = process.env.KELYRA_CONSOLE_AGENT_MAX_TOKENS) {
  const parsed = Number(value || 8192);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8192;
  return Math.min(16384, Math.floor(parsed));
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }
  }
  return body.length > 0 ? JSON.parse(body) : {};
}

function proofSummary(bundle) {
  return {
    receiptId: bundle.receipt.id,
    generatedAt: bundle.generatedAt,
    verification: bundle.verification,
    files: bundle.receipt.files.map((file) => ({
      path: file.path,
      operation: file.operation,
      status: file.status,
      detail: file.detail,
      expectedHash: file.expected?.sha256,
      actualHash: file.actual?.sha256,
    })),
    diff: bundle.git.diff || bundle.git.diffError || '',
  };
}

function actionSummary(action) {
  return {
    path: action.path,
    operation: action.operation,
    intent: action.intent,
    description: action.description,
  };
}

async function runAgentPreview(req, res) {
  const body = await readJsonBody(req);
  const prompt = redactedPrompt(body.prompt);

  if (!prompt) {
    json(res, 400, { ok: false, error: 'Prompt is required.' });
    return;
  }

  const providers = providerReport();
  if (!providers.agentChatRunAvailable) {
    json(res, 424, {
      ok: false,
      error: 'Model-backed agent is not configured in this console runtime.',
      providers,
      nextStep: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY in the terminal that starts kelyra console, then restart it.',
    });
    return;
  }

  const systemPrompt = `${KELYRA_SYSTEM_PROMPT}

## KELYRA CONSOLE PREVIEW
- You are running from the Kelyra web console local runtime.
- If the user asks for file changes, emit FILE_ACTION blocks so SWD can preview them.
- Prefer PATCH over full-file MODIFY when changing existing files.
- Do not invent unseen file contents. If you need context first, ask for the exact file or command to inspect.
- This endpoint performs a dry-run only. Do not claim files were changed.`;

  const startedAt = Date.now();
  const effort = consoleAgentEffort(body.effort);
  const maxTokens = consoleAgentMaxTokens(body.maxTokens);
  const response = await sendMessage(
    [{ role: 'user', content: prompt }],
    effort,
    systemPrompt,
    maxTokens,
  );
  const actions = parseActions(response.text);
  const dryRun = actions.length > 0
    ? await new SWDEngine({ dryRun: true, strict: true, enableRollback: false }).run(actions)
    : null;

  json(res, 200, {
    ok: true,
    mode: 'agent-preview',
    elapsedMs: Date.now() - startedAt,
    response: {
      text: response.text,
      provider: response._orchestration?.providerId,
      model: response._orchestration?.modelId,
      effort,
      maxTokens,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
    actions: actions.map(actionSummary),
    dryRun,
  });
}

async function runProof(req, res) {
  const body = await readJsonBody(req);
  const prompt = redactedPrompt(body.prompt);

  if (!prompt) {
    json(res, 400, { ok: false, error: 'Prompt is required.' });
    return;
  }

  await mkdir(join(workspaceRoot, '.kelyra', 'console-runs'), { recursive: true });

  const id = `console-${stamp()}-${sha256(prompt).slice(0, 8)}`;
  const relativePath = `.kelyra/console-runs/${id}.md`;
  const content = [
    '# Kelyra Console Proof Run',
    '',
    `- Timestamp: ${new Date().toISOString()}`,
    '- Source: Kelyra Console local bridge',
    '- Engine: Strict Write Discipline',
    '',
    '## Request',
    '',
    prompt,
    '',
  ].join('\n');

  const rawInput = JSON.stringify({
    request: `Kelyra Console proof run: ${prompt.slice(0, 96)}`,
    summary: `Console verified request saved to ${relativePath}`,
    agent: {
      id: 'kelyra-console',
      model: 'local-proof-bridge',
    },
    actions: [{
      path: relativePath,
      operation: 'CREATE',
      intent: 'MUTATE',
      description: 'Persist a redacted Kelyra Console proof request through SWD',
      content,
      contentHash: sha256(content),
    }],
    metadata: {
      surface: 'kelyra-console',
      bridge: 'site/server.mjs',
    },
  });

  const swd = await applyExternalAgentActions({
    rawInput,
    agentId: 'kelyra-console',
    modelId: 'local-proof-bridge',
    request: `Kelyra Console proof run: ${prompt.slice(0, 96)}`,
    summary: `Console verified request saved to ${relativePath}`,
  });

  if (!swd.ok || !swd.receipt?.id) {
    json(res, 422, { ok: false, swd });
    return;
  }

  const bundle = createProofBundle(swd.receipt.id);
  json(res, 200, {
    ok: true,
    swd,
    proof: proofSummary(bundle),
  });
}

function latestProof(res) {
  const bundle = createProofBundle('latest');
  json(res, 200, { ok: true, proof: proofSummary(bundle), bundle });
}

function health(res) {
  json(res, 200, {
    ok: true,
    service: 'kelyra-local-console-bridge',
    public: false,
    runtime: 'local-proof-runtime',
    workspace: workspaceRoot,
    packageRoot,
    dist: existsSync(join(packageRoot, 'dist', 'index.js')),
    providers: providerReport(),
    receipts: listReceipts(5),
  });
}

function forgeBridgeScript(res) {
  const body = `(() => {
  const pending = new Map();
  const SOURCE = 'kelyra-forge';
  const RESPONSE = 'kelyra-console';
  const TIMEOUT_MS = 15000;

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.source !== RESPONSE || message.type !== 'DATA_RESPONSE') return;
    const entry = pending.get(message.queryId);
    if (!entry) return;
    window.clearTimeout(entry.timeout);
    pending.delete(message.queryId);
    if (message.ok) entry.resolve(message.payload);
    else entry.reject(new Error(message.error || 'KELYRA_DATA_FAILED'));
  });

  async function directQuery(payload) {
    const response = await fetch('/api/local/data', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'KELYRA_DATA_FAILED');
    return result;
  }

  window.kelyraQuery = function(type, target = '', params = {}) {
    const payload = { type, target, params };
    if (window.parent === window) return directQuery(payload);

    return new Promise((resolve, reject) => {
      const queryId = Math.random().toString(36).slice(2);
      const timeout = window.setTimeout(() => {
        pending.delete(queryId);
        reject(new Error('KELYRA_DATA_TIMEOUT'));
      }, TIMEOUT_MS);
      pending.set(queryId, { resolve, reject, timeout });
      window.parent.postMessage({ source: SOURCE, type: 'DATA_REQUEST', queryId, payload }, '*');
    });
  };
})();`;

  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function serveForgeStatic(url, res) {
  if (url.pathname === '/forge-bridge.js') {
    forgeBridgeScript(res);
    return true;
  }

  const match = url.pathname.match(/^\/forge\/([^/]+)\/?(.*)$/);
  if (!match) return false;

  const slug = safeForgeSlug(decodeURIComponent(match[1]));
  if (!slug) {
    json(res, 400, { ok: false, error: 'Invalid Forge app slug.' });
    return true;
  }

  const relativeFile = match[2] ? decodeURIComponent(match[2]) : 'index.html';
  const normalized = normalize(relativeFile).replace(/^(\.\.[/\\])+/, '');
  const appDir = resolve(workspaceRoot, '.kelyra', 'forge', slug);
  const filePath = resolve(appDir, normalized || 'index.html');

  if (!filePath.startsWith(appDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const ext = extname(filePath);
    const headers = {
      'content-type': mimeTypes.get(ext) || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };

    if (ext === '.html') {
      let html = await readFile(filePath, 'utf-8');
      if (!html.includes('/forge-bridge.js')) {
        html = html.replace('</head>', '    <script src="/forge-bridge.js"></script>\n  </head>');
      }
      res.writeHead(200, headers);
      res.end(html);
      return true;
    }

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forge app file not found.');
    return true;
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  const cleanTarget = staticRouteRedirects.get(url.pathname);
  if (cleanTarget) {
    res.writeHead(308, {
      location: `${cleanTarget}${url.search || ''}`,
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }

  const routePath = cleanStaticRoutes.get(url.pathname) || url.pathname;
  const requested = routePath === '/' ? '/index.html' : routePath;
  const normalized = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  const filePath = resolve(siteDir, `.${normalized}`);

  if (!filePath.startsWith(siteDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    res.writeHead(200, {
      'content-type': mimeTypes.get(extname(filePath)) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    const notFound = await readFile(join(siteDir, 'console.html'), 'utf-8');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(notFound);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${host}:${port}`);

    if (req.method === 'GET' && url.pathname === '/api/local/health') {
      health(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/local/receipts') {
      json(res, 200, { ok: true, receipts: listReceipts(20) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/local/forge/apps') {
      json(res, 200, { ok: true, apps: await listForgeApps() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/local/proof/latest') {
      latestProof(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/local/pulse') {
      await pulseData(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/local/oracle/analyze') {
      await oracleAnalysis(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/local/forge/build') {
      await buildForgeApp(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/local/data') {
      await localData(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/local/proof/run') {
      await runProof(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/local/agent/preview') {
      await runAgentPreview(req, res);
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await serveForgeStatic(url, res)) return;
      await serveStatic(req, res);
      return;
    }

    json(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (err) {
    json(res, Number(err?.status || 500), err?.payload || {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(port, host, () => {
  console.log(`Kelyra Console local bridge running at http://${host}:${port}/console`);
  console.log(`Workspace: ${workspaceRoot}`);
});
