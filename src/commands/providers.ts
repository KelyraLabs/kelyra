import { TelemetryStore, ProviderState } from '../providers/telemetry.js';
import { detectProviders } from '../config.js';
import { c, hr, BANNER } from '../utils.js';

interface ProvidersOptions {
  watch?: boolean;
  verbose?: boolean;
  json?: boolean;
}

type ProviderConfigId = 'anthropic' | 'openai' | 'deepseek';

interface ProviderConfigStatus {
  id: ProviderConfigId;
  name: string;
  envVar: string;
  configured: boolean;
  valid: boolean;
  status: 'configured' | 'missing' | 'invalid';
  detail: string;
}

interface ProviderConfigReport {
  protocolToolsAvailable: true;
  agentChatRunAvailable: boolean;
  providers: Record<ProviderConfigId, ProviderConfigStatus>;
}

function buildProviderConfigReport(): ProviderConfigReport {
  const detected = detectProviders();
  const anthropic = detected.anthropic;
  const openai = detected.openai;
  const deepseek = detected.deepseek;

  const statuses: ProviderConfigStatus[] = [
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      envVar: 'ANTHROPIC_API_KEY',
      configured: !!anthropic,
      valid: !anthropic || anthropic.startsWith('sk-ant-'),
      status: !anthropic ? 'missing' : anthropic.startsWith('sk-ant-') ? 'configured' : 'invalid',
      detail: !anthropic
        ? 'missing'
        : anthropic.startsWith('sk-ant-')
          ? 'configured'
          : 'invalid prefix; expected sk-ant-...',
    },
    {
      id: 'openai',
      name: 'OpenAI (GPT)',
      envVar: 'OPENAI_API_KEY',
      configured: !!openai,
      valid: true,
      status: openai ? 'configured' : 'missing',
      detail: openai ? 'configured' : 'missing',
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      envVar: 'DEEPSEEK_API_KEY',
      configured: !!deepseek,
      valid: true,
      status: deepseek ? 'configured' : 'missing',
      detail: deepseek ? 'configured' : 'missing',
    },
  ];

  const providers = Object.fromEntries(statuses.map((status) => [status.id, status])) as Record<
    ProviderConfigId,
    ProviderConfigStatus
  >;

  return {
    protocolToolsAvailable: true,
    agentChatRunAvailable: statuses.some((status) => status.configured && status.valid),
    providers,
  };
}

function renderProviderConfigCheck(options: ProvidersOptions): void {
  const report = buildProviderConfigReport();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(BANNER);
  console.log(`  ${c.cyan}${c.bold}Kelyra Provider Check${c.reset}`);
  console.log(hr());
  console.log(`  ${c.green}✔${c.reset} ${c.bold}Proof tools${c.reset} ${c.dim}available without model keys${c.reset}`);
  console.log(`     ${c.dim}swd apply, receipts, proof, policy, viewer, verify --ci${c.reset}`);

  const agentIcon = report.agentChatRunAvailable ? `${c.green}✔${c.reset}` : `${c.yellow}⚠${c.reset}`;
  const agentStatus = report.agentChatRunAvailable
    ? `${c.green}available${c.reset}`
    : `${c.yellow}unavailable${c.reset} ${c.dim}(set at least one provider key)${c.reset}`;
  console.log(`  ${agentIcon} ${c.bold}Model-backed chat/run${c.reset} ${agentStatus}`);
  console.log(hr());

  for (const status of Object.values(report.providers)) {
    const icon = status.status === 'configured'
      ? `${c.green}✔${c.reset}`
      : status.status === 'invalid'
        ? `${c.red}✗${c.reset}`
        : `${c.yellow}○${c.reset}`;
    const detail = status.status === 'configured'
      ? `${c.green}${status.detail}${c.reset}`
      : status.status === 'invalid'
        ? `${c.red}${status.detail}${c.reset}`
        : `${c.dim}missing → set ${c.yellow}${status.envVar}${c.dim} to enable${c.reset}`;
    console.log(`  ${icon} ${c.bold}${status.name}${c.reset}  ${detail}`);
  }

  console.log('');
}

function calculateScore(m: ProviderState): number {
  let latencyWeight = 0.05;
  let successWeight = 100;
  return (m.successRate * successWeight) - (m.avgLatency * latencyWeight);
}

function getConfidence(totalCalls: number): string {
  if (totalCalls < 20) return `${c.red}Low${c.reset}`;
  if (totalCalls <= 100) return `${c.yellow}Medium${c.reset}`;
  return `${c.green}High${c.reset}`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[\d+m/g, '');
}

function padAnsi(str: string, len: number): string {
  const visualLength = stripAnsi(str).length;
  if (visualLength < len) {
    return str + ' '.repeat(len - visualLength);
  }
  return str;
}

function renderLeaderboard(leader: ProviderState): void {
  const leaderScore = calculateScore(leader).toFixed(1);
  const confidence = getConfidence(leader.totalCalls);
  console.log(`  🏆 ${c.bold}Leader:${c.reset} ${c.cyan}${leader.id}${c.reset} (Score: ${leaderScore}) [${confidence} Confidence]`);
  console.log(hr());
}

function renderMetricsTable(metrics: ProviderState[]): void {
  const hProvider = padAnsi(`${c.bold}Provider${c.reset}`, 18);
  const hStatus   = padAnsi(`${c.bold}Status${c.reset}`, 35);
  const hLatency  = padAnsi(`${c.bold}EMA Latency${c.reset}`, 18);
  const hSuccess  = `${c.bold}Success Rate${c.reset}`;
  console.log(`  ${hProvider}| ${hStatus}| ${hLatency}| ${hSuccess}`);
  console.log(`  ` + '-'.repeat(85));

  const now = Date.now();
  for (const m of metrics) {
    let statusStr = `${c.green}🟢 Healthy${c.reset}`;
    if (m.degradedUntil > now) {
      const resetDate = new Date(m.degradedUntil);
      const timeStr = `${resetDate.getHours()}:${resetDate.getMinutes().toString().padStart(2, '0')}`;
      statusStr = `${c.yellow}🟡 Degraded${c.reset} ${c.dim}(until ~${timeStr})${c.reset}`;
    } else if (m.successRate < 0.85) {
      statusStr = `${c.yellow}🟡 Degraded${c.reset} ${c.dim}(Low Success Rate)${c.reset}`;
    }

    const latDiff = m.prevAvgLatency ? (m.avgLatency - m.prevAvgLatency) / m.prevAvgLatency : 0;
    let latArrow = '';
    if (latDiff > 0.05) latArrow = ` ${c.red}↑${c.reset}`;
    else if (latDiff < -0.05) latArrow = ` ${c.green}↓${c.reset}`;
    const latStr = `${m.avgLatency.toFixed(0)}ms${latArrow}`;

    const srDiff = m.successRate - m.prevSuccessRate;
    let srArrow = '';
    if (srDiff > 0.02) srArrow = ` ${c.green}↑${c.reset}`;
    else if (srDiff < -0.02) srArrow = ` ${c.red}↓${c.reset}`;
    const srStr = `${(m.successRate * 100).toFixed(1)}%${srArrow}`;

    console.log(`  ${padAnsi(m.id, 17)} | ${padAnsi(statusStr, 34)} | ${padAnsi(latStr, 17)} | ${srStr}`);
  }
}

function renderRecentDecisions(telemetry: TelemetryStore): void {
  console.log(hr());
  console.log(`  ${c.bold}Recent Routing Decisions${c.reset}`);
  const decisions = telemetry.getRecentDecisions(3);
  if (decisions.length === 0) {
    console.log(`  ${c.dim}No recent routing decisions.${c.reset}`);
  } else {
    for (const d of decisions) {
      const dDate = new Date(d.timestamp);
      const timeStr = `${dDate.getHours().toString().padStart(2, '0')}:${dDate.getMinutes().toString().padStart(2, '0')}:${dDate.getSeconds().toString().padStart(2, '0')}`;
      console.log(`  ${c.dim}[${timeStr}]${c.reset} ${c.cyan}${d.selectedProvider}${c.reset} chosen for "${d.taskType}" task (${d.inputSizeBucket} tokens):`);
      console.log(`         ↳ ${c.dim}${d.reasoning}${c.reset}`);
    }
  }
}

function renderRecentFailures(telemetry: TelemetryStore, verbose?: boolean): void {
  console.log(hr());
  console.log(`  ${c.bold}Recent Failures${c.reset}`);
  const failures = telemetry.getRecentFailures(5);
  if (failures.length === 0) {
    console.log(`  ${c.dim}No recent failures recorded.${c.reset}`);
  } else {
    for (const f of failures) {
      const fDate = new Date(f.timestamp);
      const timeStr = `${fDate.getHours().toString().padStart(2, '0')}:${fDate.getMinutes().toString().padStart(2, '0')}:${fDate.getSeconds().toString().padStart(2, '0')}`;
      console.log(`  ${c.dim}[${timeStr}]${c.reset} ${c.red}${f.provider}${c.reset} | ${f.errorType} | ${f.shortMessage}`);
      if (verbose && f.fullStack) {
        console.log(`         ↳ ${c.dim}${f.fullStack.split('\\n')[0].slice(0, 120)}...${c.reset}`);
      }
    }
  }
}

export async function providersCommand(
  actionOrOptions: string | ProvidersOptions = 'dashboard',
  maybeOptions: ProvidersOptions = {},
): Promise<void> {
  let action = 'dashboard';
  let options = maybeOptions;

  if (typeof actionOrOptions === 'string') {
    action = actionOrOptions;
  } else {
    options = actionOrOptions;
  }

  const normalizedAction = action.toLowerCase();
  if (normalizedAction === 'check' || normalizedAction === 'config' || normalizedAction === 'status') {
    renderProviderConfigCheck(options);
    return;
  }

  let telemetry: TelemetryStore;
  try {
    telemetry = TelemetryStore.getInstance();
  } catch (err) {
    console.log(BANNER);
    console.log(`  ${c.yellow}The 'kelyra providers' dashboard requires Node.js >=22.5.0 for SQLite telemetry.${c.reset}`);
    console.log(`  ${c.dim}Please upgrade Node.js to view detailed provider metrics and routing decisions.${c.reset}`);
    return;
  }

  const render = () => {
    // Clear screen if watch mode
    if (options.watch) {
      console.clear();
    }

    console.log(BANNER);
    console.log(`  ${c.cyan}Provider Health & Orchestration State${c.reset}`);
    console.log(hr());

    const metrics = telemetry.getProviderMetrics();

    if (metrics.length === 0) {
      console.log(`  ${c.dim}No provider telemetry found yet. Run a chat session to collect metrics.${c.reset}`);
      console.log(`  ${c.dim}Run ${c.cyan}kelyra providers check${c.dim} to inspect configured provider keys.${c.reset}`);
      if (!options.watch) return;
    } else {
      metrics.sort((a, b) => calculateScore(b) - calculateScore(a));
      renderLeaderboard(metrics[0]);
      renderMetricsTable(metrics);
    }

    renderRecentDecisions(telemetry);
    renderRecentFailures(telemetry, options.verbose);

    if (options.watch) {
      console.log(hr());
      console.log(`  ${c.dim}Watching for routing changes... (Ctrl+C to exit)${c.reset}`);
    } else {
      console.log('');
    }
  };

  if (!options.watch) {
    render();
    return;
  }

  // Watch Mode Loop
  render();
  let lastUpdated = telemetry.getLastUpdatedTime();

  setInterval(() => {
    const currentUpdated = telemetry.getLastUpdatedTime();
    if (currentUpdated !== lastUpdated) {
      lastUpdated = currentUpdated;
      render();
    }
  }, 2000);

  // Keep process alive for watch mode
  return new Promise(() => {});
}
