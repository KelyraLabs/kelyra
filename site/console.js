const navButtons = document.querySelectorAll('[data-section]');
const surfaces = document.querySelectorAll('[data-surface]');
const title = document.querySelector('[data-title]');
const workspaceStatus = document.querySelector('[data-workspace-status] span');
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
const forgeReviseButton = document.querySelector('[data-forge-revise]');
const forgePublishButton = document.querySelector('[data-forge-publish]');
const forgeDeleteButton = document.querySelector('[data-forge-delete]');
const connectButton = document.querySelector('[data-connect]');
const logoutButton = document.querySelector('[data-logout]');
const authPanel = document.querySelector('[data-auth-panel]');
const authForm = document.querySelector('[data-auth-form]');
const authInput = document.querySelector('[data-access-code]');
const authClose = document.querySelector('[data-auth-close]');
const walletAuthButton = document.querySelector('[data-wallet-auth]');
const authCopy = document.querySelector('[data-auth-copy]');
const accessCodeSection = document.querySelector('[data-access-code-section]');
const quotaTier = document.querySelector('[data-quota-tier]');
const quotaMode = document.querySelector('[data-quota-mode]');
const quotaFill = document.querySelector('[data-quota-fill]');
const quotaBuild = document.querySelector('[data-quota-build]');
const quotaProof = document.querySelector('[data-quota-proof]');
const quotaOracle = document.querySelector('[data-quota-oracle]');
const quotaData = document.querySelector('[data-quota-data]');
const quotaReset = document.querySelector('[data-quota-reset]');
const runtimeGrid = document.querySelector('[data-runtime-grid]');
const betaStripText = document.querySelector('.beta-strip span');
const newChatButton = document.querySelector('[data-new-chat]');
const runProofButton = document.querySelector('[data-run-proof]');
const loadPulseButton = document.querySelector('[data-load-pulse]');
const forgeBuildButton = document.querySelector('[data-forge-build]');
const forgeLoadButton = document.querySelector('[data-forge-load]');

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
  selectedForgeApp: null,
  health: null,
  accessCodeEnabled: true,
  tokenGateRequired: false,
  tokenMinimumLabel: '',
  quotaProfile: null,
  consoleMode: 'active',
  watchOnly: false,
};

function isWatchOnly() {
  return state.watchOnly && state.hostedOnline && !state.bridgeOnline;
}

function watchOnlyMessage() {
  return 'Kelyra Console is watch-only for launch. Token-holder access opens after the KELYRA token gate is enabled.';
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 2200);
}

function blockWatchOnly() {
  if (!isWatchOnly()) return false;
  showToast(watchOnlyMessage());
  return true;
}

function applyConsoleModeUi() {
  const watchOnly = isWatchOnly();
  document.body.classList.toggle('is-watch-only', watchOnly);
  if (betaStripText) {
    betaStripText.textContent = watchOnly
      ? 'Kelyra Console · watch-only launch preview'
      : 'Kelyra Console · source-backed runtime';
  }
  if (workspaceStatus) {
    workspaceStatus.textContent = watchOnly ? 'Launch preview locked' : 'SWD boundary ready';
  }
  if (promptInput) {
    promptInput.disabled = watchOnly;
    promptInput.placeholder = watchOnly
      ? 'Watch-only launch preview. Holder console opens later.'
      : 'Analyze a token, scan Base Pulse, or create proof...';
  }
  for (const control of [
    newChatButton,
    runProofButton,
    loadPulseButton,
    forgeBuildButton,
    forgeLoadButton,
    forgeReviseButton,
    forgePublishButton,
    forgeDeleteButton,
    forgePrompt,
    authInput,
    walletAuthButton,
  ]) {
    if (control) control.disabled = watchOnly;
  }
  for (const control of composer?.querySelectorAll('button') || []) control.disabled = watchOnly;
  for (const control of document.querySelectorAll('[data-fill]')) control.disabled = watchOnly;
  composer?.setAttribute('aria-disabled', watchOnly ? 'true' : 'false');
  forgeForm?.setAttribute('aria-disabled', watchOnly ? 'true' : 'false');
  if (connectButton) connectButton.disabled = watchOnly;
  if (watchOnly) {
    if (authPanel) authPanel.hidden = true;
    if (accessCodeSection) accessCodeSection.hidden = true;
    if (logoutButton) logoutButton.hidden = true;
  }
}

function quotaValueLabel(item) {
  if (!item) return '--';
  if (item.limit === null || item.remaining === null) return 'unlimited';
  return `${Math.max(0, Number(item.remaining || 0))}/${Number(item.limit || 0)}`;
}

function resetLabel(iso) {
  if (!iso) return 'Reset pending';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Reset pending';
  return `Resets ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderQuotaProfile(profile) {
  state.quotaProfile = profile || null;
  const usage = profile?.quotas?.usage || {};
  if (quotaTier) quotaTier.textContent = profile?.tier?.name || 'Public';
  if (quotaMode) {
    if (isWatchOnly()) {
      quotaMode.textContent = 'Watch-only launch preview';
    } else {
      const mode = profile?.quotaMode === 'fresh' ? 'Fresh quota' : 'Full quota';
      quotaMode.textContent = profile?.authenticated ? `${mode} · signed in` : `${mode} · public`;
    }
  }
  if (quotaBuild) quotaBuild.textContent = quotaValueLabel(usage.buildActions);
  if (quotaProof) quotaProof.textContent = quotaValueLabel(usage.proofJobs);
  if (quotaOracle) quotaOracle.textContent = quotaValueLabel(usage.oracleMessages);
  if (quotaData) quotaData.textContent = quotaValueLabel(usage.dataCalls);
  if (quotaReset) quotaReset.textContent = resetLabel(profile?.window?.resetAt);

  const rows = Object.values(usage).filter((item) => item && item.limit !== null && item.limit > 0);
  const usedRatio = rows.length
    ? Math.max(...rows.map((item) => Math.min(1, Number(item.used || 0) / Number(item.limit || 1))))
    : 0;
  if (quotaFill) quotaFill.style.width = `${Math.round(usedRatio * 100)}%`;
  renderRuntimeGrid();
}

function renderQuotaOffline(message = 'Quota unavailable') {
  state.quotaProfile = null;
  if (quotaTier) quotaTier.textContent = 'Offline';
  if (quotaMode) quotaMode.textContent = message;
  if (quotaBuild) quotaBuild.textContent = '--';
  if (quotaProof) quotaProof.textContent = '--';
  if (quotaOracle) quotaOracle.textContent = '--';
  if (quotaData) quotaData.textContent = '--';
  if (quotaReset) quotaReset.textContent = 'Reset pending';
  if (quotaFill) quotaFill.style.width = '0%';
  renderRuntimeGrid();
}

function updateAuthPanelUi() {
  if (accessCodeSection) accessCodeSection.hidden = isWatchOnly() || !state.accessCodeEnabled;
  if (authCopy) {
    if (isWatchOnly()) {
      authCopy.textContent = 'The public console is currently watch-only. Wallet unlock will open after token-holder access is enabled.';
    } else if (state.tokenGateRequired) {
      authCopy.textContent = state.tokenMinimumLabel
        ? `Connect a wallet holding at least ${state.tokenMinimumLabel}.`
        : 'Connect a wallet that meets the current token tier.';
    } else if (state.accessCodeEnabled) {
      authCopy.textContent = 'Connect a wallet, or use a beta access code while access is controlled.';
    } else {
      authCopy.textContent = 'Connect a wallet to open the hosted workspace.';
    }
  }
  applyConsoleModeUi();
  renderRuntimeGrid();
}

function updateAuthUi() {
  if (!connectButton) return;
  if (isWatchOnly()) {
    connectButton.textContent = 'Holder access soon';
    connectButton.classList.remove('is-authenticated');
    connectButton.disabled = true;
    if (logoutButton) logoutButton.hidden = true;
    applyConsoleModeUi();
    return;
  }
  connectButton.disabled = false;
  if (state.hostedOnline) {
    const wallet = state.session?.wallet?.address;
    connectButton.textContent = state.authenticated
      ? wallet
        ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
        : 'Beta Access'
      : 'Connect Wallet';
    connectButton.classList.toggle('is-authenticated', state.authenticated);
    if (logoutButton) logoutButton.hidden = !state.authenticated;
    applyConsoleModeUi();
    return;
  }
  connectButton.textContent = 'Connect Wallet';
  connectButton.classList.remove('is-authenticated');
  if (logoutButton) logoutButton.hidden = true;
  applyConsoleModeUi();
}

function renderRuntimeGrid() {
  if (!runtimeGrid) return;
  const runtime = state.bridgeOnline ? 'Local runtime' : state.hostedOnline ? 'Hosted API' : 'Offline';
  const auth = state.hostedOnline
    ? state.authenticated
      ? (state.session?.wallet?.address ? 'Wallet session' : 'Beta session')
      : 'Not signed in'
    : state.bridgeOnline
      ? 'Local only'
      : 'Unavailable';
  const gate = state.tokenGateRequired
    ? (state.tokenMinimumLabel || 'Token gate required')
    : 'Token gate off';
  const quota = state.quotaProfile?.tier?.name
    ? `${state.quotaProfile.tier.name} · ${state.quotaProfile.quotaMode || 'full'}`
    : state.hostedOnline
      ? 'Resolving'
      : 'No hosted quota';
  const cards = [
    ['Mode', isWatchOnly() ? 'Watch-only launch' : 'Active', isWatchOnly() ? 'Hosted actions are locked until holder access opens' : 'Interactive routes are enabled'],
    ['Runtime', runtime, state.health?.runnerMode || state.health?.runtime || 'No runner detected'],
    ['Auth', auth, state.accessCodeEnabled ? 'Access code fallback enabled' : 'Wallet flow only'],
    ['Gate', gate, isWatchOnly() ? 'Token-holder console activates after launch' : state.tokenGateRequired ? 'Wallet balance is enforced' : 'Token gate will be enabled last'],
    ['Quota', quota, state.quotaProfile?.window?.resetAt ? resetLabel(state.quotaProfile.window.resetAt) : 'UTC daily window'],
    ['Store', state.health?.store || (state.bridgeOnline ? 'local files' : 'unknown'), state.health?.environment || state.health?.workspace || 'No environment report'],
    ['Worker', state.health?.features?.hostedWorker ? 'Hosted worker' : state.health?.runnerMode || 'Not connected', state.health?.features?.proofJobs ? 'Proof jobs available' : 'Proof jobs unavailable'],
  ];
  runtimeGrid.replaceChildren();
  for (const [label, value, detail] of cards) {
    const card = document.createElement('article');
    card.innerHTML = '<span></span><strong></strong><p></p>';
    card.querySelector('span').textContent = label;
    card.querySelector('strong').textContent = value;
    card.querySelector('strong').title = value;
    card.querySelector('p').textContent = detail || '';
    runtimeGrid.append(card);
  }
}

function openAuthPanel() {
  if (blockWatchOnly()) return;
  if (!authPanel) return;
  updateAuthPanelUi();
  authPanel.hidden = false;
  if (state.accessCodeEnabled) authInput?.focus();
}

function closeAuthPanel() {
  if (!authPanel) return;
  authPanel.hidden = true;
  if (authInput) authInput.value = '';
}

async function logoutHostedSession() {
  if (!state.hostedOnline) return;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // The local UI still clears session state when the server is unreachable.
  }
  state.authenticated = false;
  state.session = null;
  state.forgeApps = [];
  state.forgeLoaded = false;
  updateAuthUi();
  updateAuthPanelUi();
  await refreshQuotaProfile(true);
  renderHostedHistory([], [], 'Sign in to read hosted receipts and proof jobs.');
  resetForgePreview();
  showToast('Signed out.');
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
    updateAuthPanelUi();
    return payload;
  } catch {
    state.authenticated = false;
    state.session = null;
    updateAuthUi();
    updateAuthPanelUi();
    return null;
  }
}

async function refreshPublicGate() {
  if (!state.hostedOnline) return null;
  try {
    const response = await fetch('/api/tiers', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    if (payload.consoleMode) {
      state.consoleMode = payload.consoleMode;
      state.watchOnly = payload.consoleMode === 'watch-only';
    }
    state.accessCodeEnabled = Boolean(payload.gate?.accessCodeBeta);
    state.tokenGateRequired = Boolean(payload.gate?.tokenGate?.required);
    state.tokenMinimumLabel = payload.gate?.tokenGate?.minimumLabel || '';
    updateAuthPanelUi();
    return payload;
  } catch {
    state.accessCodeEnabled = false;
    updateAuthPanelUi();
    return null;
  }
}

async function refreshQuotaProfile(silent = true) {
  if (!state.hostedOnline) {
    renderQuotaOffline(state.bridgeOnline ? 'Local runtime active' : 'No hosted backend');
    return null;
  }
  try {
    const response = await fetch('/api/quota/profile', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    renderQuotaProfile(payload);
    return payload;
  } catch (err) {
    renderQuotaOffline('Quota profile unavailable');
    if (!silent) showToast('Quota profile unavailable.');
    return null;
  }
}

async function connectWalletAuth() {
  if (blockWatchOnly()) return;
  const provider = window.ethereum;
  if (!provider?.request) {
    openAuthPanel();
    showToast(state.accessCodeEnabled
      ? 'No browser wallet detected. Use the access code fallback.'
      : 'No browser wallet detected.');
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
      tier: verifyPayload.tier,
      quotaMode: verifyPayload.tokenGate?.quotaMode,
    };
    updateAuthUi();
    closeAuthPanel();
    showToast('Wallet connected.');
    await refreshHostedSession();
    await refreshQuotaProfile(true);
    await refreshHostedHistory(true);
    await loadForgeApps(true).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Wallet sign-in failed: ${message}`);
  }
}

function requireHostedAuth(action) {
  if (!state.hostedOnline || state.authenticated) return true;
  if (blockWatchOnly()) return false;
  showToast(action || 'Sign in to use the hosted workspace.');
  openAuthPanel();
  return false;
}

async function fetchModeJson({ localPath, hostedPath, options = {}, authRequired = false }) {
  if (hostedPath && !state.bridgeOnline && state.hostedOnline && blockWatchOnly()) {
    throw new Error('CONSOLE_WATCH_ONLY');
  }
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

function historyTime(item) {
  return item.timestamp || item.completedAt || item.updatedAt || item.createdAt || '';
}

function renderHostedHistory(receipts = [], jobs = [], message) {
  if (!receiptList) return;
  const items = [
    ...receipts.map((receipt) => ({ type: 'receipt', item: receipt, time: historyTime(receipt) })),
    ...jobs.map((job) => ({ type: 'job', item: job, time: historyTime(job) })),
  ].sort((a, b) => Date.parse(b.time || 0) - Date.parse(a.time || 0));

  if (historyBridge) historyBridge.textContent = state.hostedOnline ? 'hosted' : 'offline';
  if (receiptCount) receiptCount.textContent = String(items.length);
  if (latestReceipt) {
    const latest = items[0]?.item?.id || 'none';
    latestReceipt.textContent = shortReceiptId(latest);
    latestReceipt.title = latest;
  }

  receiptList.replaceChildren();
  if (!items.length) {
    const note = document.createElement('p');
    note.className = 'receipt-note';
    note.dataset.historyEmpty = '';
    note.textContent = message || 'No hosted jobs or receipts yet.';
    receiptList.append(note);
    return;
  }

  for (const entry of items.slice(0, 10)) {
    const item = entry.item;
    const isReceipt = entry.type === 'receipt';
    const status = isReceipt ? (item.success ? 'completed' : 'needs review') : (item.status || 'queued');
    const row = document.createElement('article');
    row.className = 'receipt-row';

    const marker = document.createElement('span');
    marker.className = `receipt-marker ${status === 'completed' ? 'ok' : 'warn'}`;
    marker.textContent = isReceipt ? 'receipt' : 'job';

    const main = document.createElement('div');
    const id = document.createElement('strong');
    id.textContent = shortReceiptId(item.id);
    id.title = item.id || '';
    const summary = document.createElement('p');
    summary.textContent = isReceipt
      ? item.summary || 'Hosted proof receipt'
      : item.result?.summary || item.promptPreview || item.reason || 'Hosted proof job';
    main.append(id, summary);

    const meta = document.createElement('div');
    meta.className = 'receipt-meta';
    const type = document.createElement('span');
    type.textContent = isReceipt ? 'receipt' : status;
    const source = document.createElement('span');
    source.textContent = isReceipt ? item.provider || 'hosted-worker' : item.runnerMode || 'queue';
    const time = document.createElement('span');
    time.textContent = formatReceiptDate(entry.time);
    meta.append(type, source, time);

    row.append(marker, main, meta);
    receiptList.append(row);
  }
}

async function refreshHostedHistory(silent = true) {
  if (!state.hostedOnline) return null;
  if (!state.authenticated) {
    renderHostedHistory([], [], isWatchOnly()
      ? 'Hosted receipt history opens with token-holder access. CLI receipts can still be shared separately.'
      : 'Sign in to read hosted receipts and proof jobs.');
    return null;
  }

  try {
    const [receiptsResponse, jobsResponse] = await Promise.all([
      fetch('/api/receipts', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      }),
      fetch('/api/proof/jobs?limit=50', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      }),
    ]);
    const receiptsPayload = await receiptsResponse.json().catch(() => ({}));
    const jobsPayload = await jobsResponse.json().catch(() => ({}));
    if (!receiptsResponse.ok || !receiptsPayload.ok) throw new Error(receiptsPayload.error || `HTTP_${receiptsResponse.status}`);
    if (!jobsResponse.ok || !jobsPayload.ok) throw new Error(jobsPayload.error || `HTTP_${jobsResponse.status}`);
    renderHostedHistory(receiptsPayload.receipts || [], jobsPayload.jobs || []);
    if (!silent) showToast('History refreshed.');
    return { receipts: receiptsPayload.receipts || [], jobs: jobsPayload.jobs || [] };
  } catch (err) {
    renderHostedHistory([], [], 'Hosted history unavailable.');
    if (!silent) showToast('History unavailable.');
    return null;
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

function currentForgeApp() {
  return state.forgeApps.find((app) => app.slug === state.selectedForgeSlug) || state.selectedForgeApp || null;
}

function updateForgeActionUi(app = currentForgeApp()) {
  const lifecycleReady = Boolean(state.hostedOnline && !state.bridgeOnline && state.authenticated && app?.slug && !isWatchOnly());
  if (forgeReviseButton) forgeReviseButton.disabled = !lifecycleReady;
  if (forgePublishButton) {
    forgePublishButton.disabled = !lifecycleReady || app?.status === 'published';
    forgePublishButton.textContent = app?.status === 'published' ? 'Published' : 'Publish';
  }
  if (forgeDeleteButton) forgeDeleteButton.disabled = !lifecycleReady;
}

function forgeProofLabel(app) {
  if (!app) return 'unverified';
  if (app.proofStatus === 'verified' || app.receiptId) return 'verified';
  if (app.proofStatus === 'failed') return 'proof failed';
  if (app.proofJobStatus === 'processing') return 'processing';
  if (app.proofStatus === 'queued' || app.proofJobId) return 'queued';
  return app.proofStatus || 'unverified';
}

function resetForgePreview() {
  state.selectedForgeSlug = '';
  state.selectedForgeApp = null;
  if (forgePreviewTitle) forgePreviewTitle.textContent = 'No draft selected';
  if (forgePreviewOpen) {
    forgePreviewOpen.href = '#';
    forgePreviewOpen.setAttribute('aria-disabled', 'true');
  }
  if (forgePreview) forgePreview.removeAttribute('src');
  forgePreviewBody?.classList.remove('has-preview');
  updateForgeActionUi(null);
  renderForgeApps(state.forgeApps);
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
  const proofLabel = forgeProofLabel(app);
  const proofRef = app.receiptId
    ? `receipt ${shortReceiptId(app.receiptId)}`
    : app.proofJobId
      ? `${proofLabel} proof job ${shortReceiptId(app.proofJobId)}`
      : proofLabel;
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
    empty.textContent = isWatchOnly()
      ? 'Forge is visible as a product preview. Building and hosted draft libraries open with token-holder access.'
      : state.hostedOnline && !state.bridgeOnline
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
    card.querySelector('span').textContent = `${app.status || 'draft'} · ${forgeProofLabel(app)} · ${app.kind || 'forge app'} · v${app.version || 1}`;
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
  state.selectedForgeApp = app;
  if (forgePreviewTitle) forgePreviewTitle.textContent = app.title || app.slug || 'Forge draft';
  if (forgePreviewOpen) {
    forgePreviewOpen.href = app.previewUrl;
    forgePreviewOpen.setAttribute('aria-disabled', 'false');
  }
  forgePreview.src = app.previewUrl;
  forgePreviewBody?.classList.add('has-preview');
  updateForgeActionUi(app);
  renderForgeApps(state.forgeApps);
}

async function loadForgeApps(silent = false) {
  if (blockWatchOnly()) {
    state.forgeLoaded = true;
    state.forgeApps = [];
    resetForgePreview();
    renderForgeApps([]);
    return;
  }
  if (state.hostedOnline && !state.bridgeOnline && !state.authenticated) {
    state.forgeLoaded = true;
    state.forgeApps = [];
    state.selectedForgeSlug = '';
    state.selectedForgeApp = null;
    renderForgeApps([]);
    updateForgeActionUi(null);
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
    const selected = state.forgeApps.find((app) => app.slug === state.selectedForgeSlug);
    if (selected) {
      renderForgeApp(selected);
    } else if (state.forgeApps[0]) {
      renderForgeApp(state.forgeApps[0]);
    } else {
      resetForgePreview();
    }
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
  const result = await fetchModeJson({
    localPath: '/api/local/data',
    hostedPath: '/api/data',
    authRequired: state.hostedOnline && !state.bridgeOnline,
    options: {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  });
  await refreshQuotaProfile(true);
  return result;
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
  state.consoleMode = 'active';
  state.watchOnly = false;
  state.accessCodeEnabled = true;
  state.tokenGateRequired = false;
  updateAuthUi();
  updateAuthPanelUi();
  renderQuotaOffline('No hosted backend');
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
  applyConsoleModeUi();
  renderRuntimeGrid();
}

function setHostedOnline(health) {
  state.bridgeOnline = false;
  state.hostedOnline = true;
  state.agentAvailable = false;
  state.health = health;
  state.consoleMode = health.consoleMode || health.features?.consoleMode || 'active';
  state.watchOnly = state.consoleMode === 'watch-only' || Boolean(health.features?.watchOnly);
  updateAuthUi();
  if (bridgeStatus) bridgeStatus.textContent = 'Hosted API';
  if (bridgeDetail) bridgeDetail.textContent = isWatchOnly()
    ? 'Watch-only launch preview'
    : health.environment === 'production' ? 'Production backend' : 'Hosted backend online';
  if (proofState) proofState.textContent = isWatchOnly() ? 'Preview only' : 'Auth required';
  if (proofDetail) proofDetail.textContent = isWatchOnly()
    ? 'Public hosted actions are locked until token-holder access opens.'
    : 'Hosted proof jobs require a signed-in session and an isolated runner.';
  setModelUnavailable(isWatchOnly() ? 'Hosted model actions are locked during launch preview.' : 'Hosted model access requires sign-in.');
  if (historyBridge) historyBridge.textContent = 'hosted';
  if (receiptCount) receiptCount.textContent = '0';
  if (latestReceipt) latestReceipt.textContent = isWatchOnly() ? 'preview' : 'auth required';
  const hostedMessage = isWatchOnly()
    ? 'Hosted receipt history opens with token-holder access. CLI receipts can still be shared separately.'
    : 'Sign in to read hosted receipts and proof jobs.';
  if (historyEmpty) historyEmpty.textContent = hostedMessage;
  renderReceipts([], hostedMessage);
  applyConsoleModeUi();
  renderRuntimeGrid();
}

function setBridgeOnline(health) {
  state.bridgeOnline = true;
  state.hostedOnline = false;
  state.authenticated = false;
  state.session = null;
  state.health = health;
  state.consoleMode = 'active';
  state.watchOnly = false;
  updateAuthUi();
  updateAuthPanelUi();
  renderQuotaOffline('Local runtime active');
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
  applyConsoleModeUi();
  renderRuntimeGrid();
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
      await refreshPublicGate();
      await refreshHostedSession();
      await refreshQuotaProfile(true);
      await refreshHostedHistory(true);
      renderRuntimeGrid();
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
  if (blockWatchOnly()) {
    if (pulseSummary) pulseSummary.textContent = 'Pulse is paused for the public watch-only launch preview.';
    return null;
  }
  if (pulseSummary) pulseSummary.textContent = 'Loading Base signal lanes from source data...';
  try {
    const payload = await fetchModeJson({
      localPath: '/api/local/pulse',
      hostedPath: '/api/pulse',
    });
    renderPulse(payload);
    await refreshQuotaProfile(true);
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
  if (blockWatchOnly()) {
    addMessage('agent', 'Kelyra', 'Pulse is paused in the public watch-only preview. Token-holder access opens later.');
    return;
  }
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
  const contract = payload.contract?.ok
    ? `Contract source: ${payload.contract.hasBytecode ? 'bytecode found' : 'bytecode unknown'}; ERC-20 ${payload.contract.erc20?.symbol || 'metadata unknown'}${payload.contract.erc20?.totalSupplyFormatted ? ` supply ${payload.contract.erc20.totalSupplyFormatted}` : ''}.`
    : 'Contract source: unavailable from Base RPC.';
  const explorer = payload.explorer?.ok
    ? `Explorer source: ${payload.explorer.verifiedSource ? 'verified source' : 'source not verified'}${payload.explorer.contractName ? ` (${payload.explorer.contractName})` : ''}; deployer ${payload.explorer.deployer || 'unknown'}; holders ${payload.explorer.holderCount ?? 'unknown'}.`
    : 'Explorer source: optional BaseScan/Etherscan API not connected or unavailable.';
  return [
    `${token.symbol || token.name || 'Token'} on Base: ${formatCurrency(primary?.priceUsd, false)} price, ${formatCurrency(primary?.liquidityUsd)} liquidity, ${formatCurrency(primary?.volume24h)} 24h volume.`,
    `24h change: ${formatPercent(primary?.priceChange24h)}. Buy pressure: ${primary?.buyPressure === null || primary?.buyPressure === undefined ? 'unknown' : `${Math.round(primary.buyPressure * 100)}%`}. Age: ${formatAge(primary?.ageHours)}.`,
    `Risk shape: ${flags}.`,
    contract,
    explorer,
    `Unknown until more sources are connected: ${unknowns}.`,
  ].join('\n');
}

async function runOracle(prompt) {
  if (blockWatchOnly()) {
    addMessage('agent', 'Kelyra', 'Oracle actions are paused in the public watch-only preview. Token-holder access opens later.');
    return;
  }
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
    await refreshQuotaProfile(true);
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
  if (blockWatchOnly()) {
    if (forgeOutput) {
      forgeOutput.innerHTML = '<span>Forge result</span><strong>Watch-only preview</strong><p>Hosted app builds open after token-holder access is enabled.</p>';
    }
    return;
  }
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
    await refreshQuotaProfile(true);
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

async function hostedForgeLifecycleRequest(app, action, options = {}) {
  if (blockWatchOnly()) throw new Error('CONSOLE_WATCH_ONLY');
  if (!app?.slug) throw new Error('Select a Forge draft first.');
  if (state.bridgeOnline || !state.hostedOnline) {
    throw new Error('Forge lifecycle actions are available on the hosted API.');
  }
  if (!requireHostedAuth(`Sign in to ${action} hosted Forge drafts.`)) {
    throw new Error('AUTH_REQUIRED');
  }

  const response = await fetch(options.path || `/api/apps/${encodeURIComponent(app.slug)}`, {
    method: options.method || 'PATCH',
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

async function reviseSelectedForgeApp() {
  const app = currentForgeApp();
  const prompt = forgePrompt?.value.trim();
  if (!app?.slug) {
    showToast('Select a Forge draft first.');
    return;
  }
  if (!prompt) {
    forgePrompt?.focus();
    showToast('Write the revision brief in App brief.');
    return;
  }

  try {
    updateForgeActionUi(null);
    if (forgeOutput) {
      forgeOutput.innerHTML = '<span>Forge result</span><strong>Revising draft...</strong><p>Creating a new SWD-backed app revision.</p>';
    }
    const payload = await hostedForgeLifecycleRequest(app, 'revise', {
      method: 'PATCH',
      body: { prompt },
    });
    state.forgeApps = [payload.app, ...state.forgeApps.filter((item) => item.slug !== payload.app?.slug)];
    renderForgeApp(payload.app);
    renderForgeApps(state.forgeApps);
    if (proofState) proofState.textContent = 'Revision queued';
    if (proofDetail) proofDetail.textContent = payload.job?.id || payload.app?.slug || 'Forge revision saved';
    if (proofPath) proofPath.textContent = 'Brief -> Forge revision -> Hosted job';
    await refreshQuotaProfile(true);
    showToast('Forge draft revised.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Forge revise failed: ${message}`);
    updateForgeActionUi(app);
  }
}

async function publishSelectedForgeApp() {
  const app = currentForgeApp();
  if (!app?.slug) {
    showToast('Select a Forge draft first.');
    return;
  }

  try {
    updateForgeActionUi(null);
    const payload = await hostedForgeLifecycleRequest(app, 'publish', {
      method: 'POST',
      path: `/api/apps/${encodeURIComponent(app.slug)}/publish`,
    });
    state.forgeApps = [payload.app, ...state.forgeApps.filter((item) => item.slug !== payload.app?.slug)];
    renderForgeApp(payload.app);
    renderForgeApps(state.forgeApps);
    if (proofState) proofState.textContent = 'Published';
    if (proofDetail) proofDetail.textContent = payload.app?.publicUrl || payload.app?.previewUrl || payload.app?.slug;
    if (proofPath) proofPath.textContent = 'Draft -> Publish state -> Preview URL';
    showToast('Forge draft published.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Publish failed: ${message}`);
    updateForgeActionUi(app);
  }
}

async function deleteSelectedForgeApp() {
  const app = currentForgeApp();
  if (!app?.slug) {
    showToast('Select a Forge draft first.');
    return;
  }
  if (!window.confirm(`Delete "${app.title || app.slug}"?`)) return;

  try {
    updateForgeActionUi(null);
    await hostedForgeLifecycleRequest(app, 'delete', {
      method: 'DELETE',
    });
    state.forgeApps = state.forgeApps.filter((item) => item.slug !== app.slug);
    resetForgePreview();
    renderForgeApps(state.forgeApps);
    if (forgeOutput) {
      forgeOutput.innerHTML = '<span>Forge result</span><strong>Draft deleted</strong><p>The hosted app draft was removed from this session library.</p>';
    }
    showToast('Forge draft deleted.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(`Delete failed: ${message}`);
    updateForgeActionUi(app);
  }
}

async function runLocalProof(prompt) {
  if (!state.bridgeOnline) {
    if (blockWatchOnly()) {
      addMessage('agent', 'Kelyra', 'Proof jobs are paused in the public watch-only preview. The CLI can still create local receipts.');
      return;
    }
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
        await refreshQuotaProfile(true);
        await refreshHostedHistory(true);
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
    if (section === 'radar' && !state.pulseLoaded && !isWatchOnly()) {
      loadPulse(true).catch(() => {});
    }
    if (section === 'studio' && !state.forgeLoaded && !isWatchOnly()) {
      loadForgeApps(true).catch(() => {});
    }
  });
}

for (const example of document.querySelectorAll('[data-fill]')) {
  example.addEventListener('click', () => {
    if (blockWatchOnly()) return;
    if (!promptInput) return;
    promptInput.value = example.getAttribute('data-fill') || '';
    promptInput.focus();
  });
}

composer?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (blockWatchOnly()) return;
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

runProofButton?.addEventListener('click', async () => {
  if (blockWatchOnly()) return;
  const prompt = promptInput?.value.trim() || 'Create a local proof note for this console smoke test.';
  addMessage('user', 'You', prompt);
  if (promptInput) promptInput.value = '';
  await runLocalProof(prompt);
});

loadPulseButton?.addEventListener('click', () => {
  if (blockWatchOnly()) return;
  loadPulse(false).catch(() => {});
});

document.querySelector('[data-history-refresh]')?.addEventListener('click', () => {
  if (state.hostedOnline) {
    refreshHostedHistory(false).catch(() => {});
    return;
  }
  refreshBridge().then(() => showToast('History refreshed.')).catch(() => showToast('History unavailable.'));
});

forgeLoadButton?.addEventListener('click', () => {
  if (blockWatchOnly()) return;
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

forgeReviseButton?.addEventListener('click', () => {
  if (blockWatchOnly()) return;
  reviseSelectedForgeApp().catch(() => {});
});

forgePublishButton?.addEventListener('click', () => {
  if (blockWatchOnly()) return;
  publishSelectedForgeApp().catch(() => {});
});

forgeDeleteButton?.addEventListener('click', () => {
  if (blockWatchOnly()) return;
  deleteSelectedForgeApp().catch(() => {});
});

forgeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (blockWatchOnly()) return;
  const prompt = forgePrompt?.value.trim();
  if (!prompt) {
    showToast('Write an app brief first.');
    return;
  }
  await runForgeBuild(prompt);
});

newChatButton?.addEventListener('click', () => {
  if (blockWatchOnly()) return;
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
  if (blockWatchOnly()) return;
  if (state.hostedOnline) {
    if (state.authenticated) {
      refreshQuotaProfile(false).catch(() => {});
      showToast('Hosted session is active.');
      return;
    }
    connectWalletAuth();
    return;
  }
  showToast('Hosted beta access is available when the console is served by the Kelyra API.');
});

logoutButton?.addEventListener('click', () => {
  logoutHostedSession().catch(() => showToast('Sign out failed.'));
});

walletAuthButton?.addEventListener('click', connectWalletAuth);

authClose?.addEventListener('click', closeAuthPanel);

authPanel?.addEventListener('click', (event) => {
  if (event.target === authPanel) closeAuthPanel();
});

authForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (blockWatchOnly()) return;
  if (!state.accessCodeEnabled) {
    showToast('Access-code login is disabled.');
    return;
  }
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
    await refreshHostedSession();
    await refreshQuotaProfile(true);
    await refreshHostedHistory(true);
    await loadForgeApps(true).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast(message === 'ACCESS_DENIED' ? 'Access code rejected.' : `Sign in failed: ${message}`);
  }
});

refreshBridge();
