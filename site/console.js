const navButtons = document.querySelectorAll('[data-section]');
const surfaces = document.querySelectorAll('[data-surface]');
const title = document.querySelector('[data-title]');
const promptInput = document.querySelector('[data-composer] input');
const composer = document.querySelector('[data-composer]');
const transcript = document.querySelector('[data-transcript]');
const toast = document.querySelector('[data-toast]');
const bridgeStatus = document.querySelector('[data-bridge-status]');
const bridgeDetail = document.querySelector('[data-bridge-detail]');
const proofState = document.querySelector('[data-proof-state]');
const proofDetail = document.querySelector('[data-proof-detail]');
const proofPath = document.querySelector('[data-proof-path]');
const modelState = document.querySelector('[data-model-state]');
const modelDetail = document.querySelector('[data-model-detail]');
const historyBridge = document.querySelector('[data-history-bridge]');
const receiptCount = document.querySelector('[data-receipt-count]');
const latestReceipt = document.querySelector('[data-latest-receipt]');
const historyEmpty = document.querySelector('[data-history-empty]');
const receiptList = document.querySelector('[data-receipt-list]');
const pulseSummary = document.querySelector('[data-pulse-summary]');
const pulseSource = document.querySelector('[data-pulse-source]');
const pulseLaneNodes = document.querySelectorAll('[data-pulse-lane]');
const forgeForm = document.querySelector('[data-forge-form]');
const forgePrompt = document.querySelector('[data-forge-prompt]');
const forgeOutput = document.querySelector('[data-forge-output]');
const forgePreview = document.querySelector('[data-forge-preview]');
const forgePreviewTitle = document.querySelector('[data-forge-preview-title]');
const forgePreviewBody = document.querySelector('.forge-preview-body');
const forgePreviewOpen = document.querySelector('[data-forge-open]');
const forgeAppList = document.querySelector('[data-forge-apps]');
const connectButton = document.querySelector('[data-connect]');
const authPanel = document.querySelector('[data-auth-panel]');
const authForm = document.querySelector('[data-auth-form]');
const authInput = document.querySelector('[data-access-code]');
const authClose = document.querySelector('[data-auth-close]');
const walletAuthButton = document.querySelector('[data-wallet-auth]');

const titles = {
  chat: 'Oracle',
  radar: 'Pulse',
  studio: 'App Forge',
  history: 'History',
  docs: 'Docs',
};

const state = {
  bridgeOnline: false,
  hostedOnline: false,
  authenticated: false,
  session: null,
  agentAvailable: false,
  pulseLoaded: false,
  forgeLoaded: false,
  forgeApps: [],
  selectedForgeSlug: '',
  health: null,
};

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 2200);
}

function updateAuthUi() {
  if (!connectButton) return;
  if (state.hostedOnline) {
    const wallet = state.session?.wallet?.address;
    connectButton.textContent = state.authenticated
      ? wallet
        ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
        : 'Beta Access'
      : 'Connect Wallet';
    connectButton.classList.toggle('is-authenticated', state.authenticated);
    return;
  }
  connectButton.textContent = 'Connect Wallet';
  connectButton.classList.remove('is-authenticated');
}

function openAuthPanel() {
  if (!authPanel) return;
  authPanel.hidden = false;
  authInput?.focus();
}

function closeAuthPanel() {
  if (!authPanel) return;
  authPanel.hidden = true;
  if (authInput) authInput.value = '';
}

async function refreshHostedSession() {
  if (!state.hostedOnline) return null;
  try {
    const response = await fetch('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    state.authenticated = Boolean(payload.authenticated);
    state.session = payload.session || null;
    updateAuthUi();
    return payload;
  } catch {
    state.authenticated = false;
    state.session = null;
    updateAuthUi();
    return null;
  }
}

async function connectWalletAuth() {
  const provider = window.ethereum;
  if (!provider?.request) {
    openAuthPanel();
    showToast('No browser wallet detected. Use the access code fallback.');
    return;
  }

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const address = accounts?.[0];
    if (!address) throw new Error('No wallet account selected.');

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }],
      });
    } catch {
      showToast('Sign-in continues, but switch to Base for token-gated access.');
    }

    const nonceResponse = await fetch('/api/auth/wallet/nonce', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    const noncePayload = await nonceResponse.json().catch(() => ({}));
    if (!nonceResponse.ok || !noncePayload.ok) throw new Error(noncePayload.error || `HTTP_${nonceResponse.status}`);

    const signature = await provider.request({
      method: 'personal_sign',
      params: [noncePayload.message, address],
    });
    const verifyResponse = await fetch('/api/auth/wallet/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        message: noncePayload.message,
        signature,
      }),
    });
    const verifyPayload = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || !verifyPayload.ok) {
      if (verifyPayload.error === 'TOKEN_HOLDER_REQUIRED') throw new Error('Token holder access required.');
      throw new Error(verifyPayload.error || `HTTP_${verifyResponse.status}`);
    }

    state.authenticated = true;
    state.session = {
      authMode: 'wallet',
      wallet: verifyPayload.wallet,
      tokenGate: verifyPayload.tokenGate,
    };
    updateAuthUi();
    closeAuthPanel();
    showToast('Wallet connected.');
    await loadForgeApps(true).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Wallet sign-in failed: ${message}`);
  }
}

function requireHostedAuth(action) {
  if (!state.hostedOnline || state.authenticated) return true;
  showToast(action || 'Sign in to use the hosted workspace.');
  openAuthPanel();
  return false;
}

async function fetchModeJson({ localPath, hostedPath, options = {}, authRequired = false }) {
  const attempts = state.bridgeOnline
    ? [localPath]
    : state.hostedOnline
      ? [hostedPath]
      : [localPath, hostedPath];

  let lastError;
  for (const path of attempts.filter(Boolean)) {
    if (path === hostedPath && authRequired && !requireHostedAuth()) {
      throw new Error('AUTH_REQUIRED');
    }
    try {
      const response = await fetch(path, {
        ...options,
        cache: options.method ? undefined : 'no-store',
        credentials: 'same-origin',
        headers: {
          ...(options.method ? { 'Content-Type': 'application/json' } : { 'Cache-Control': 'no-cache' }),
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 && path === hostedPath) {
        state.authenticated = false;
        updateAuthUi();
        if (authRequired) openAuthPanel();
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      return payload;
    } catch (err) {
      lastError = err;
      if (path === hostedPath || state.bridgeOnline || state.hostedOnline) break;
    }
  }

  throw lastError || new Error('Request unavailable');
}

function addMessage(kind, label, text, meta) {
  if (!transcript) return null;
  const message = document.createElement('article');
  message.className = `message ${kind}-message`;
  message.innerHTML = '<span></span><p></p>';
  message.querySelector('span').textContent = label;
  message.querySelector('p').textContent = text;
  if (meta) {
    const small = document.createElement('small');
    small.textContent = meta;
    message.append(small);
  }
  transcript.append(message);
  transcript.scrollTop = transcript.scrollHeight;
  return message;
}

function shortReceiptId(id) {
  const value = String(id || 'none');
  if (value === 'none' || value.length <= 20) return value;
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

function formatReceiptDate(timestamp) {
  if (!timestamp) return 'unknown time';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(value, compact = true) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'unknown';
  return new Intl.NumberFormat([], {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: Number(value) < 1 ? 6 : 2,
  }).format(Number(value));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'unknown';
  return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
}

function formatAge(hours) {
  if (hours === null || hours === undefined || Number.isNaN(Number(hours))) return 'unknown age';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function tokenLabel(item) {
  return item?.token?.symbol || item?.token?.name || 'unknown';
}

function renderReceipts(receipts, message) {
  if (!receiptList) return;
  receiptList.replaceChildren();

  if (!receipts?.length) {
    const note = document.createElement('p');
    note.className = 'receipt-note';
    note.dataset.historyEmpty = '';
    note.textContent = message || 'No receipts yet. Run a local proof to create the first entry.';
    receiptList.append(note);
    return;
  }

  for (const receipt of receipts.slice(0, 8)) {
    const row = document.createElement('article');
    row.className = 'receipt-row';

    const marker = document.createElement('span');
    marker.className = receipt.success ? 'receipt-marker ok' : 'receipt-marker warn';
    marker.textContent = receipt.success ? 'ok' : 'check';

    const main = document.createElement('div');
    const id = document.createElement('strong');
    id.textContent = shortReceiptId(receipt.id);
    id.title = receipt.id || '';
    const summary = document.createElement('p');
    summary.textContent = receipt.summary || 'Verified proof run';
    main.append(id, summary);

    const meta = document.createElement('div');
    meta.className = 'receipt-meta';
    const fileCount = document.createElement('span');
    fileCount.textContent = `${receipt.fileCount ?? 0} file${receipt.fileCount === 1 ? '' : 's'}`;
    const provider = document.createElement('span');
    provider.textContent = receipt.provider || 'provider n/a';
    const time = document.createElement('span');
    time.textContent = formatReceiptDate(receipt.timestamp);
    meta.append(fileCount, provider, time);

    row.append(marker, main, meta);
    receiptList.append(row);
  }
}

function renderPulseLane(name, items) {
  const node = [...pulseLaneNodes].find((lane) => lane.getAttribute('data-pulse-lane') === name);
  if (!node) return;
  node.replaceChildren();

  if (!items?.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No clean source-backed candidates in this lane.';
    node.append(empty);
    return;
  }

  for (const item of items.slice(0, 4)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pulse-token';
    card.dataset.target = item.token?.address || tokenLabel(item);
    card.innerHTML = '<strong></strong><span></span><small></small>';
    card.querySelector('strong').textContent = tokenLabel(item);
    card.querySelector('span').textContent = `${formatCurrency(item.liquidityUsd)} liq · ${formatCurrency(item.volume24h)} vol`;
    const flags = item.riskFlags?.length
      ? item.riskFlags.slice(0, 2).join(', ')
      : `${formatPercent(item.priceChange24h)} · ${formatAge(item.ageHours)}`;
    card.querySelector('small').textContent = flags;
    card.addEventListener('click', () => {
      if (!promptInput) return;
      promptInput.value = `Analyze ${item.token?.address || tokenLabel(item)}`;
      promptInput.focus();
    });
    node.append(card);
  }
}

function renderPulse(payload) {
  state.pulseLoaded = true;
  if (pulseSummary) {
    const time = payload.fetchedAt
      ? new Date(payload.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'now';
    pulseSummary.textContent = `${payload.candidateCount || 0} Base candidates from ${payload.source}; last updated ${time}.`;
  }
  if (pulseSource) pulseSource.textContent = payload.source || 'source unavailable';
  renderPulseLane('momentum', payload.lanes?.momentum || []);
  renderPulseLane('fresh', payload.lanes?.fresh || []);
  renderPulseLane('risk', payload.lanes?.risk || []);
  renderPulseLane('undervalued', payload.lanes?.undervalued || []);
}

function summarizePulseForChat(payload) {
  const lanes = payload.lanes || {};
  const momentum = (lanes.momentum || []).slice(0, 3).map(tokenLabel).join(', ') || 'none';
  const fresh = (lanes.fresh || []).slice(0, 3).map(tokenLabel).join(', ') || 'none';
  const risk = (lanes.risk || [])
    .slice(0, 3)
    .map((item) => `${tokenLabel(item)} (${item.riskFlags?.[0] || 'risk flag'})`)
    .join(', ') || 'none';
  const undervalued = (lanes.undervalued || []).slice(0, 3).map(tokenLabel).join(', ') || 'none';
  return `Pulse loaded from ${payload.source}. Momentum: ${momentum}. Fresh pools: ${fresh}. Risk radar: ${risk}. Undervalued watch: ${undervalued}. This is a screening feed, not a recommendation.`;
}

function renderForgeApp(app) {
  if (!forgeOutput) return;
  forgeOutput.replaceChildren();

  const eyebrow = document.createElement('span');
  eyebrow.textContent = 'Forge result';
  const titleNode = document.createElement('strong');
  titleNode.textContent = app.title || app.slug || 'Kelyra app';
  titleNode.title = titleNode.textContent;
  const summary = document.createElement('p');
  const proofRef = app.receiptId
    ? `receipt ${shortReceiptId(app.receiptId)}`
    : app.proofJobId
      ? `queued proof job ${shortReceiptId(app.proofJobId)}`
      : app.status || 'draft';
  const location = app.workspacePath ? `saved to ${app.workspacePath}` : 'created in hosted workspace';
  summary.textContent = `${app.kind || 'app'} ${location} with ${proofRef}.`;

  const calls = document.createElement('p');
  calls.textContent = `Bridge contract: ${(app.bridgeCalls || []).join(', ') || 'none'}.`;

  const files = document.createElement('div');
  files.className = 'forge-file-list';
  for (const file of (app.files || []).slice(0, 6)) {
    const row = document.createElement('div');
    const path = document.createElement('code');
    path.textContent = file.path;
    const size = document.createElement('span');
    size.textContent = `${file.bytes}b`;
    row.append(path, size);
    files.append(row);
  }

  forgeOutput.append(eyebrow, titleNode, summary, calls, files);
  if (app.previewUrl) selectForgeApp(app);
}

function renderForgeApps(apps) {
  if (!forgeAppList) return;
  forgeAppList.replaceChildren();

  if (!apps?.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = state.hostedOnline && !state.bridgeOnline
      ? 'No hosted Forge drafts yet. Sign in and build one above to start a preview workspace.'
      : 'No local Forge drafts yet. Build one above to start a preview workspace.';
    forgeAppList.append(empty);
    return;
  }

  for (const app of apps.slice(0, 8)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `forge-app-card${state.selectedForgeSlug === app.slug ? ' active' : ''}`;
    card.innerHTML = '<span></span><strong></strong><p></p>';
    card.querySelector('span').textContent = app.kind || 'forge app';
    card.querySelector('strong').textContent = app.title || app.slug;
    card.querySelector('strong').title = app.title || app.slug;
    card.querySelector('p').textContent = `${(app.files || []).length} files · ${(app.bridgeCalls || []).join(', ') || 'no bridge calls'}`;
    card.addEventListener('click', () => selectForgeApp(app));
    forgeAppList.append(card);
  }
}

function selectForgeApp(app) {
  if (!app?.previewUrl || !forgePreview) return;
  state.selectedForgeSlug = app.slug || '';
  if (forgePreviewTitle) forgePreviewTitle.textContent = app.title || app.slug || 'Forge draft';
  if (forgePreviewOpen) {
    forgePreviewOpen.href = app.previewUrl;
    forgePreviewOpen.setAttribute('aria-disabled', 'false');
  }
  forgePreview.src = app.previewUrl;
  forgePreviewBody?.classList.add('has-preview');
  renderForgeApps(state.forgeApps);
}

async function loadForgeApps(silent = false) {
  if (state.hostedOnline && !state.bridgeOnline && !state.authenticated) {
    state.forgeLoaded = true;
    state.forgeApps = [];
    renderForgeApps([]);
    if (!silent) openAuthPanel();
    return;
  }

  try {
    const payload = await fetchModeJson({
      localPath: '/api/local/forge/apps',
      hostedPath: '/api/apps',
      authRequired: state.hostedOnline && !state.bridgeOnline,
    });
    state.forgeApps = Array.isArray(payload.apps) ? payload.apps : [];
    state.forgeLoaded = true;
    renderForgeApps(state.forgeApps);
    if (!state.selectedForgeSlug && state.forgeApps[0]) selectForgeApp(state.forgeApps[0]);
    if (!silent) showToast('Forge drafts refreshed.');
  } catch (err) {
    if (forgeAppList) {
      forgeAppList.innerHTML = state.hostedOnline && !state.bridgeOnline
        ? '<p class="empty-state">Sign in to load hosted Forge drafts.</p>'
        : '<p class="empty-state">Could not load local Forge drafts.</p>';
    }
    if (!silent) showToast('Forge drafts unavailable.');
  }
}

async function queryKelyraBridge(payload) {
  return fetchModeJson({
    localPath: '/api/local/data',
    hostedPath: '/api/data',
    authRequired: state.hostedOnline && !state.bridgeOnline,
    options: {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  });
}

window.addEventListener('message', async (event) => {
  const message = event.data || {};
  if (message.source !== 'kelyra-forge' || message.type !== 'DATA_REQUEST') return;
  if (forgePreview?.contentWindow && event.source !== forgePreview.contentWindow) return;

  try {
    const payload = await queryKelyraBridge(message.payload || {});
    event.source?.postMessage({
      source: 'kelyra-console',
      type: 'DATA_RESPONSE',
      queryId: message.queryId,
      ok: true,
      payload,
    }, '*');
  } catch (err) {
    event.source?.postMessage({
      source: 'kelyra-console',
      type: 'DATA_RESPONSE',
      queryId: message.queryId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, '*');
  }
});

function configuredProviderNames(report) {
  return Object.values(report?.providers || {})
    .filter((provider) => provider.configured && provider.valid)
    .map((provider) => provider.name || provider.id);
}

function setModelUnavailable(detail = 'Set OPENAI_API_KEY or ANTHROPIC_API_KEY, then restart kelyra console.') {
  state.agentAvailable = false;
  if (modelState) modelState.textContent = 'Not connected';
  if (modelDetail) modelDetail.textContent = detail;
}

function updateModelStatus(report) {
  const names = configuredProviderNames(report);
  if (!report?.agentChatRunAvailable || names.length === 0) {
    setModelUnavailable();
    return;
  }

  state.agentAvailable = true;
  if (modelState) modelState.textContent = names[0];
  if (modelDetail) modelDetail.textContent = names.length > 1
    ? `${names.length} providers available for agent preview.`
    : 'Model-backed agent preview is available.';
}

function setBridgeOffline(message = 'Run kelyra console') {
  state.bridgeOnline = false;
  state.hostedOnline = false;
  state.authenticated = false;
  state.session = null;
  state.agentAvailable = false;
  updateAuthUi();
  if (bridgeStatus) bridgeStatus.textContent = 'Offline';
  if (bridgeDetail) bridgeDetail.textContent = message === 'Run kelyra console' ? 'No execution runtime' : message;
  if (proofState) proofState.textContent = 'Runtime offline';
  if (proofDetail) proofDetail.textContent = 'Public mode stays read-only until an authenticated runtime is connected.';
  setModelUnavailable('No local runtime is connected.');
  if (historyBridge) historyBridge.textContent = 'offline';
  if (receiptCount) receiptCount.textContent = '0';
  if (latestReceipt) latestReceipt.textContent = 'none';
  if (historyEmpty) historyEmpty.textContent = 'Run kelyra console from a project to read receipts here.';
  renderReceipts([], 'Run kelyra console from a project to read receipts here.');
}

function setHostedOnline(health) {
  state.bridgeOnline = false;
  state.hostedOnline = true;
  state.agentAvailable = false;
  updateAuthUi();
  if (bridgeStatus) bridgeStatus.textContent = 'Hosted API';
  if (bridgeDetail) bridgeDetail.textContent = health.environment === 'production' ? 'Production backend' : 'Hosted backend online';
  if (proofState) proofState.textContent = 'Auth required';
  if (proofDetail) proofDetail.textContent = 'Hosted proof jobs require a signed-in session and an isolated runner.';
  setModelUnavailable('Hosted model access requires sign-in.');
  if (historyBridge) historyBridge.textContent = 'hosted';
  if (receiptCount) receiptCount.textContent = '0';
  if (latestReceipt) latestReceipt.textContent = 'auth required';
  if (historyEmpty) historyEmpty.textContent = 'Sign in to read hosted receipts and proof jobs.';
  renderReceipts([], 'Sign in to read hosted receipts and proof jobs.');
}

function setBridgeOnline(health) {
  state.bridgeOnline = true;
  state.hostedOnline = false;
  state.authenticated = false;
  state.session = null;
  state.health = health;
  updateAuthUi();
  updateModelStatus(health.providers);
  const receipts = Array.isArray(health.receipts) ? health.receipts : [];
  const latest = receipts[0]?.id || 'none';
  if (bridgeStatus) bridgeStatus.textContent = 'Online';
  if (bridgeDetail) {
    bridgeDetail.textContent = 'Local proof enabled';
    bridgeDetail.removeAttribute('title');
  }
  if (proofState) proofState.textContent = 'Ready';
  if (proofDetail) proofDetail.textContent = 'This browser can create a local SWD receipt through the proof runtime.';
  if (historyBridge) historyBridge.textContent = 'online';
  if (receiptCount) receiptCount.textContent = String(receipts.length);
  if (latestReceipt) {
    latestReceipt.textContent = shortReceiptId(latest);
    latestReceipt.title = latest;
  }
  if (historyEmpty) {
    historyEmpty.textContent = receipts.length
      ? `Latest local receipt: ${latest}`
      : 'Runtime online. Run a proof to create the first local receipt.';
  }
  renderReceipts(receipts);
}

async function refreshBridge() {
  try {
    const response = await fetch('/api/local/health', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const health = await response.json();
    if (!health?.ok || health.service !== 'kelyra-local-console-bridge') {
      throw new Error('Bridge unavailable');
    }
    setBridgeOnline(health);
  } catch {
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const health = await response.json();
      if (!health?.ok || health.service !== 'kelyra-api') throw new Error('Hosted API unavailable');
      setHostedOnline(health);
      await refreshHostedSession();
    } catch {
      setBridgeOffline();
    }
  }
}

function summarizeProof(payload) {
  const proof = payload?.proof;
  const receiptId = proof?.receiptId || payload?.swd?.receipt?.id || 'receipt-created';
  const fileCount = Array.isArray(proof?.files) ? proof.files.length : 0;
  const verification = proof?.verification?.ok === false ? 'issues' : 'verified';
  return {
    receiptId,
    message: `SWD ${verification}. Receipt ${receiptId} covers ${fileCount} file action${fileCount === 1 ? '' : 's'}.`,
  };
}

function needsAgent(prompt) {
  return /\b(edit|patch|change|modify|fix|implement|create|build|review|inspect|debug|refactor|write|update|delete|modifica|cambia|sistema|aggiusta|crea|costruisci|controlla|revisiona|puoi|can you)\b/i.test(prompt);
}

function isProofRequest(prompt) {
  return /\b(proof|receipt|verify|verified|swd|prove|sign|audit trail|prova|verifica|ricevuta|firma)\b/i.test(prompt);
}

function isPulsePrompt(prompt) {
  return /\b(trending|trend|pulse|fresh|undervalued|market discovery|base tokens|token su base|token base|mercato|segnali)\b/i.test(prompt);
}

function isOraclePrompt(prompt) {
  return /0x[a-fA-F0-9]{40}/.test(prompt) || /\b(analyze|analyse|audit|token|wallet|deployer|liquidity|market cap|price|holders|analizza|auditare|contratto|prezzo|liquidit)\b/i.test(prompt);
}

function cleanAgentText(text) {
  const cleaned = String(text || '')
    .replace(/\[FILE_ACTION:[\s\S]*?\[\/FILE_ACTION\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) return 'Agent produced SWD actions for preview.';
  return cleaned.length > 900 ? `${cleaned.slice(0, 900).trim()}...` : cleaned;
}

function formatActions(actions) {
  if (!actions?.length) return 'No SWD file actions returned.';
  return actions
    .slice(0, 5)
    .map((action) => `${action.operation} ${action.path}`)
    .join(' · ');
}

async function runAgentPreview(prompt) {
  if (!state.bridgeOnline) {
    addMessage('agent', 'Kelyra', 'Agent preview needs a connected local runtime. Start kelyra console from the project first.');
    return;
  }

  if (!state.agentAvailable) {
    addMessage(
      'agent',
      'Kelyra',
      'The local proof runtime is online, but no model provider key is configured in this process. I can create SWD receipts, but I should not pretend to edit or reason as an agent until OPENAI_API_KEY, ANTHROPIC_API_KEY, or DEEPSEEK_API_KEY is available and the console is restarted.',
      'No receipt created for this prompt.',
    );
    if (proofState) proofState.textContent = 'Model key needed';
    if (proofDetail) proofDetail.textContent = 'Set a provider key and restart kelyra console.';
    return;
  }

  if (proofState) proofState.textContent = 'Planning';
  if (proofDetail) proofDetail.textContent = 'Running model-backed preview...';
  const pending = addMessage('agent', 'Kelyra', 'Running a model-backed preview. No files will be applied from the browser yet...');

  try {
    const response = await fetch('/api/local/agent/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.nextStep || payload.error || `HTTP_${response.status}`);
    }

    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    const actionText = formatActions(actions);
    const agentText = cleanAgentText(payload.response?.text);
    pending?.querySelector('p')?.replaceChildren(
      document.createTextNode(actions.length > 0
        ? `${agentText}\n\nPreviewed ${actions.length} SWD action${actions.length === 1 ? '' : 's'}: ${actionText}`
        : agentText),
    );
    if (proofState) proofState.textContent = actions.length > 0 ? 'Previewed' : 'Answered';
    if (proofDetail) proofDetail.textContent = payload.response?.provider
      ? `${payload.response.provider}/${payload.response.model || 'model'}`
      : 'Agent preview completed';
    if (proofPath) proofPath.textContent = actions.length > 0 ? 'Prompt -> Model -> SWD dry-run' : 'Prompt -> Model -> Answer';
    showToast(actions.length > 0 ? 'Agent preview created.' : 'Agent answered without file actions.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(`Agent preview unavailable: ${message}`));
    if (proofState) proofState.textContent = 'Unavailable';
    if (proofDetail) proofDetail.textContent = message;
  }
}

async function loadPulse(silent = false) {
  if (pulseSummary) pulseSummary.textContent = 'Loading Base signal lanes from source data...';
  try {
    const payload = await fetchModeJson({
      localPath: '/api/local/pulse',
      hostedPath: '/api/pulse',
    });
    renderPulse(payload);
    if (!silent) showToast('Pulse refreshed.');
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (pulseSummary) pulseSummary.textContent = `Pulse unavailable: ${message}`;
    if (!silent) showToast('Pulse source unavailable.');
    throw err;
  }
}

async function runPulseChat() {
  const pending = addMessage('agent', 'Kelyra', 'Loading Pulse lanes from source-backed Base DEX data...');
  try {
    const payload = await loadPulse(true);
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(summarizePulseForChat(payload)));
    if (proofState) proofState.textContent = 'Pulse loaded';
    if (proofDetail) proofDetail.textContent = 'Source-backed screening, no receipt required.';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(`Pulse unavailable: ${message}`));
  }
}

function oracleSummary(payload) {
  const primary = payload.primary;
  const token = primary?.token || payload.token || {};
  const flags = primary?.riskFlags?.length ? primary.riskFlags.join(', ') : 'no risk-shape flags from this source';
  const unknowns = payload.unknowns?.join(', ') || 'none';
  return [
    `${token.symbol || token.name || 'Token'} on Base: ${formatCurrency(primary?.priceUsd, false)} price, ${formatCurrency(primary?.liquidityUsd)} liquidity, ${formatCurrency(primary?.volume24h)} 24h volume.`,
    `24h change: ${formatPercent(primary?.priceChange24h)}. Buy pressure: ${primary?.buyPressure === null || primary?.buyPressure === undefined ? 'unknown' : `${Math.round(primary.buyPressure * 100)}%`}. Age: ${formatAge(primary?.ageHours)}.`,
    `Risk shape: ${flags}.`,
    `Unknown until more sources are connected: ${unknowns}.`,
  ].join('\n');
}

async function runOracle(prompt) {
  const pending = addMessage('agent', 'Kelyra', 'Resolving Base token data from public sources...');
  try {
    const payload = await fetchModeJson({
      localPath: '/api/local/oracle/analyze',
      hostedPath: '/api/oracle/analyze',
      options: {
        method: 'POST',
        body: JSON.stringify({ target: prompt }),
      },
    });
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(oracleSummary(payload)));
    if (proofState) proofState.textContent = 'Source-backed';
    if (proofDetail) proofDetail.textContent = payload.primary?.sourceHealth?.source || 'Oracle source loaded';
    if (proofPath) proofPath.textContent = 'Prompt -> Source data -> Oracle report';
    showToast('Oracle report loaded.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(`Oracle could not resolve this target: ${message}`));
    if (proofState) proofState.textContent = 'Source gap';
    if (proofDetail) proofDetail.textContent = message;
  }
}

async function runForgeBuild(prompt) {
  if (!state.bridgeOnline && !state.hostedOnline) {
    if (forgeOutput) {
      forgeOutput.innerHTML = '<span>Forge result</span><strong>Runtime required</strong><p>Start kelyra console or open the hosted backend before building app drafts.</p>';
    }
    showToast('Runtime required.');
    return;
  }

  if (state.hostedOnline && !state.bridgeOnline && !requireHostedAuth('Sign in to build hosted Forge drafts.')) {
    return;
  }

  if (forgeOutput) {
    forgeOutput.innerHTML = '<span>Forge result</span><strong>Building draft...</strong><p>Generating sandbox-safe app files and proof metadata.</p>';
  }

  try {
    const payload = await fetchModeJson({
      localPath: '/api/local/forge/build',
      hostedPath: '/api/apps/build',
      authRequired: state.hostedOnline && !state.bridgeOnline,
      options: {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      },
    });
    state.forgeApps = [payload.app, ...state.forgeApps.filter((app) => app.slug !== payload.app?.slug)];
    renderForgeApp(payload.app);
    renderForgeApps(state.forgeApps);
    if (proofState) proofState.textContent = payload.app?.receiptId ? 'Forge proofed' : 'Forge queued';
    if (proofDetail) proofDetail.textContent = payload.app?.receiptId || payload.job?.id || 'Forge draft written';
    if (proofPath) proofPath.textContent = payload.app?.receiptId ? 'Prompt -> Forge -> SWD receipt' : 'Prompt -> Forge -> Hosted job';
    await refreshBridge();
    await loadForgeApps(true);
    showToast('Forge draft created.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (forgeOutput) {
      forgeOutput.innerHTML = '<span>Forge result</span><strong>Build failed</strong><p></p>';
      forgeOutput.querySelector('p').textContent = message;
    }
    showToast('Forge build failed.');
  }
}

async function runLocalProof(prompt) {
  if (!state.bridgeOnline) {
    if (state.hostedOnline) {
      if (!requireHostedAuth('Sign in to queue hosted proof jobs.')) return;
      if (proofState) proofState.textContent = 'Queueing';
      if (proofDetail) proofDetail.textContent = 'Creating hosted proof job...';
      const pending = addMessage('agent', 'Kelyra', 'Queueing a hosted proof job. It will not touch a local filesystem.');
      try {
        const payload = await fetchModeJson({
          hostedPath: '/api/proof/jobs',
          authRequired: true,
          options: {
            method: 'POST',
            body: JSON.stringify({ prompt, workspaceRef: 'hosted-console' }),
          },
        });
        pending?.querySelector('p')?.replaceChildren(document.createTextNode(`Hosted proof job queued: ${payload.job.id}. Runner mode: ${payload.job.runnerMode}.`));
        if (proofState) proofState.textContent = 'Queued';
        if (proofDetail) proofDetail.textContent = payload.job.id;
        if (proofPath) proofPath.textContent = 'Prompt -> Hosted API -> Proof job';
        showToast('Hosted proof job queued.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pending?.querySelector('p')?.replaceChildren(document.createTextNode(`Hosted proof job failed: ${message}`));
        if (proofState) proofState.textContent = 'Failed';
        if (proofDetail) proofDetail.textContent = message;
      }
      return;
    }

    addMessage('agent', 'Kelyra', 'Local proof is not connected. Start it with kelyra console from the project you want to verify.');
    return;
  }

  if (proofState) proofState.textContent = 'Running';
  if (proofDetail) proofDetail.textContent = 'Creating a local SWD run and receipt...';
  const pending = addMessage('agent', 'Kelyra', 'Running the request through the local SWD runtime...');

  try {
    const response = await fetch('/api/local/proof/run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || payload.swd?.error || `HTTP_${response.status}`);
    }

    const summary = summarizeProof(payload);
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(summary.message));
    showToast('Local proof receipt created.');
    await refreshBridge();
    if (proofState) proofState.textContent = 'Verified';
    if (proofDetail) proofDetail.textContent = summary.receiptId;
    if (proofPath) proofPath.textContent = 'Prompt -> SWD -> Proof';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pending?.querySelector('p')?.replaceChildren(document.createTextNode(`Proof run failed: ${message}`));
    if (proofState) proofState.textContent = 'Failed';
    if (proofDetail) proofDetail.textContent = message;
  }
}

for (const button of navButtons) {
  button.addEventListener('click', () => {
    const section = button.getAttribute('data-section');
    for (const item of navButtons) item.classList.toggle('active', item === button);
    for (const surface of surfaces) {
      surface.classList.toggle('active', surface.getAttribute('data-surface') === section);
    }
    if (title && section) title.textContent = titles[section] || 'Kelyra Console';
    if (section === 'radar' && !state.pulseLoaded) {
      loadPulse(true).catch(() => {});
    }
    if (section === 'studio' && !state.forgeLoaded) {
      loadForgeApps(true).catch(() => {});
    }
  });
}

for (const example of document.querySelectorAll('[data-fill]')) {
  example.addEventListener('click', () => {
    if (!promptInput) return;
    promptInput.value = example.getAttribute('data-fill') || '';
    promptInput.focus();
  });
}

composer?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput?.value.trim();
  if (!prompt) {
    showToast('Write a task first.');
    return;
  }

  addMessage('user', 'You', prompt);
  promptInput.value = '';
  if (isPulsePrompt(prompt)) {
    await runPulseChat(prompt);
  } else if (isOraclePrompt(prompt) && !isProofRequest(prompt)) {
    await runOracle(prompt);
  } else if (needsAgent(prompt) && !isProofRequest(prompt)) {
    await runAgentPreview(prompt);
  } else {
    await runLocalProof(prompt);
  }
});

document.querySelector('[data-run-proof]')?.addEventListener('click', async () => {
  const prompt = promptInput?.value.trim() || 'Create a local proof note for this console smoke test.';
  addMessage('user', 'You', prompt);
  if (promptInput) promptInput.value = '';
  await runLocalProof(prompt);
});

document.querySelector('[data-load-pulse]')?.addEventListener('click', () => {
  loadPulse(false).catch(() => {});
});

document.querySelector('[data-forge-load]')?.addEventListener('click', () => {
  loadForgeApps(false).catch(() => {});
});

document.querySelector('[data-forge-refresh]')?.addEventListener('click', () => {
  if (!forgePreview?.src) {
    showToast('Select a Forge draft first.');
    return;
  }
  forgePreview.src = forgePreview.src;
  showToast('Forge preview reloaded.');
});

forgeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = forgePrompt?.value.trim();
  if (!prompt) {
    showToast('Write an app brief first.');
    return;
  }
  await runForgeBuild(prompt);
});

document.querySelector('[data-new-chat]')?.addEventListener('click', () => {
  if (!transcript) return;
  transcript.innerHTML = `
    <article class="message agent-message">
      <span>Kelyra</span>
      <p>Ask for a Base token report, Pulse scan, proof receipt, or model-backed change preview. Source gaps stay marked unknown.</p>
    </article>
  `;
  showToast('New preview session started.');
});

connectButton?.addEventListener('click', () => {
  if (state.hostedOnline) {
    if (state.authenticated) {
      showToast('Hosted beta session is active.');
      return;
    }
    connectWalletAuth();
    return;
  }
  showToast('Hosted beta access is available when the console is served by the Kelyra API.');
});

walletAuthButton?.addEventListener('click', connectWalletAuth);

authClose?.addEventListener('click', closeAuthPanel);

authPanel?.addEventListener('click', (event) => {
  if (event.target === authPanel) closeAuthPanel();
});

authForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const accessCode = authInput?.value.trim();
  if (!accessCode) {
    showToast('Enter the beta access code.');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    state.authenticated = true;
    state.session = { authMode: 'access-code' };
    updateAuthUi();
    closeAuthPanel();
    showToast('Hosted workspace unlocked.');
    await loadForgeApps(true).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(message === 'ACCESS_DENIED' ? 'Access code rejected.' : `Sign in failed: ${message}`);
  }
});

refreshBridge();
