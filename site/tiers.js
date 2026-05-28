const fallbackTiers = {
  schema: 'kelyra.tiers.v1',
  quotaWindow: 'UTC day',
  enforced: false,
  token: {
    chainId: 8453,
    symbol: 'KELYRA',
    address: null,
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
    { label: 'Route burst safety', value: '80 requests per minute per IP/path' },
    { label: 'Pulse cache', value: '120 seconds' },
    { label: 'Request body cap', value: '64 KB' },
    { label: 'Hosted prompt cap', value: '4,000 characters for Forge build prompts' },
  ],
  tiers: [
    {
      id: 'basic',
      name: 'Basic',
      access: 'Wallet holding at least 5,000,000 KELYRA',
      minimum: '5,000,000 KELYRA minimum',
      tokenMinimum: '5000000',
      dailyQuota: { oracleMessages: 25, dataCalls: 150, buildActions: 3, proofJobs: 6 },
      freshDailyQuota: { oracleMessages: 15, dataCalls: 50, buildActions: 1, proofJobs: 2 },
    },
    {
      id: 'core',
      name: 'Core',
      access: 'Wallet holding at least 50,000,000 KELYRA',
      minimum: '50,000,000 KELYRA minimum',
      tokenMinimum: '50000000',
      dailyQuota: { oracleMessages: 100, dataCalls: 400, buildActions: 10, proofJobs: 25 },
      freshDailyQuota: { oracleMessages: 50, dataCalls: 100, buildActions: 3, proofJobs: 8 },
    },
    {
      id: 'pro',
      name: 'Pro',
      access: 'Wallet holding at least 100,000,000 KELYRA',
      minimum: '100,000,000 KELYRA minimum',
      tokenMinimum: '100000000',
      dailyQuota: { oracleMessages: 200, dataCalls: 800, buildActions: 25, proofJobs: 80 },
      freshDailyQuota: { oracleMessages: 50, dataCalls: 250, buildActions: 5, proofJobs: 20 },
    },
    {
      id: 'ultimate',
      name: 'Ultimate',
      access: 'Wallet holding at least 1,000,000,000 KELYRA',
      minimum: '1,000,000,000 KELYRA minimum',
      tokenMinimum: '1000000000',
      dailyQuota: { oracleMessages: 750, dataCalls: 2500, buildActions: 75, proofJobs: 300 },
      freshDailyQuota: { oracleMessages: 150, dataCalls: 500, buildActions: 10, proofJobs: 50 },
    },
  ],
};

const menuToggle = document.querySelector('[data-menu-toggle]');
const siteHeader = document.querySelector('.site-header');
const siteNav = document.querySelector('[data-site-nav]');

function setMenuOpen(open) {
  siteHeader?.classList.toggle('is-menu-open', open);
  document.body.classList.toggle('menu-open', open);
  menuToggle?.setAttribute('aria-expanded', String(open));
  menuToggle?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

menuToggle?.addEventListener('click', () => {
  setMenuOpen(!siteHeader?.classList.contains('is-menu-open'));
});

siteNav?.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('a')) setMenuOpen(false);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenuOpen(false);
});

const formatValue = (value) => {
  if (value === null || value === undefined) return '0/day';
  if (value === 'unlimited') return 'Unlimited';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString()}/day` : String(value);
};

function quotaLabel(types, id) {
  return types.find((item) => item.id === id)?.label || id;
}

function appendQuotaBlock(card, title, quota, types) {
  const block = document.createElement('section');
  block.className = 'tier-quota-block';
  block.innerHTML = `<h4>${title}</h4><dl></dl>`;
  const list = block.querySelector('dl');
  for (const key of Object.keys(quota || {})) {
    const row = document.createElement('div');
    row.innerHTML = `<dt>${quotaLabel(types, key)}</dt><dd>${formatValue(quota[key])}</dd>`;
    list.append(row);
  }
  card.append(block);
}

function renderTiers(config) {
  const grid = document.querySelector('[data-tier-grid]');
  if (!grid) return;
  const types = Array.isArray(config.quotaTypes) ? config.quotaTypes : fallbackTiers.quotaTypes;
  grid.innerHTML = '';

  for (const tier of config.tiers || []) {
    const card = document.createElement('article');
    card.className = 'tier-card';
    card.innerHTML = `
      <div class="tier-head">
        <span>${tier.id}</span>
        <h3>${tier.name}</h3>
        <p>${tier.access}</p>
        <small>${tier.minimum}</small>
      </div>
    `;

    appendQuotaBlock(card, 'Full daily quota', tier.dailyQuota || {}, types);
    appendQuotaBlock(card, 'Fresh daily quota', tier.freshDailyQuota || tier.dailyQuota || {}, types);
    grid.append(card);
  }
}

function renderSafety(config) {
  const table = document.querySelector('[data-safety-table]');
  if (!table) return;
  table.innerHTML = '';
  for (const item of config.safetyLimits || []) {
    const row = document.createElement('div');
    row.innerHTML = `<span>${item.label}</span><strong>${item.value}</strong>`;
    table.append(row);
  }
}

function renderQuotaTypes(config) {
  const grid = document.querySelector('[data-quota-types]');
  if (!grid) return;
  grid.innerHTML = '';
  for (const type of config.quotaTypes || []) {
    const card = document.createElement('article');
    card.innerHTML = `<h3>${type.label}</h3><p>${type.description}</p>`;
    grid.append(card);
  }
}

async function loadTiers() {
  try {
    const response = await fetch('/api/tiers', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    if (!payload?.ok) throw new Error(payload?.error || 'TIER_CONFIG_UNAVAILABLE');
    return payload;
  } catch {
    return fallbackTiers;
  }
}

loadTiers().then((config) => {
  renderTiers(config);
  renderSafety(config);
  renderQuotaTypes(config);
});
