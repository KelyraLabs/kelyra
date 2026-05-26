const fallbackTiers = {
  schema: 'kelyra.tiers.v1',
  quotaWindow: 'UTC day',
  enforced: false,
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
      id: 'public',
      name: 'Public Preview',
      access: 'No account required for read-only demo routes',
      minimum: 'No wallet or asset required',
      dailyQuota: { oracleMessages: 12, dataCalls: 40, buildActions: 0, proofJobs: 0 },
    },
    {
      id: 'launch',
      name: 'Launch',
      access: 'Beta access code or approved wallet',
      minimum: 'Controlled beta access, no asset minimum',
      dailyQuota: { oracleMessages: 60, dataCalls: 300, buildActions: 6, proofJobs: 12 },
    },
    {
      id: 'builder',
      name: 'Builder',
      access: 'Verified wallet or promoted beta seat',
      minimum: 'Configured by the operator when token gating is enabled',
      dailyQuota: { oracleMessages: 200, dataCalls: 1200, buildActions: 30, proofJobs: 80 },
    },
    {
      id: 'team',
      name: 'Team',
      access: 'Team workspace with shared policies and proof history',
      minimum: 'Configured by contract, allowlist, or billing seat',
      dailyQuota: { oracleMessages: 600, dataCalls: 4000, buildActions: 120, proofJobs: 300 },
    },
    {
      id: 'scale',
      name: 'Scale',
      access: 'Dedicated deployment or contracted workspace',
      minimum: 'Custom',
      dailyQuota: { oracleMessages: 2000, dataCalls: 15000, buildActions: 500, proofJobs: 1200 },
    },
  ],
};

const formatValue = (value) => {
  if (value === null || value === undefined) return '0/day';
  if (value === 'unlimited') return 'Unlimited';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString()}/day` : String(value);
};

function quotaLabel(types, id) {
  return types.find((item) => item.id === id)?.label || id;
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
      <dl></dl>
    `;

    const list = card.querySelector('dl');
    for (const key of Object.keys(tier.dailyQuota || {})) {
      const row = document.createElement('div');
      row.innerHTML = `<dt>${quotaLabel(types, key)}</dt><dd>${formatValue(tier.dailyQuota[key])}</dd>`;
      list.append(row);
    }
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
