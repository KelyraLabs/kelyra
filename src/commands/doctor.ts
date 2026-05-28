import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectProviders } from '../config.js';
import { getCurrentBranch, hasUncommittedChanges, isGitRepo } from '../git.js';
import { loadAgentManifest } from '../agent-manifest.js';
import { loadPolicy } from '../policy.js';
import { listReceipts, verifyReceiptChain } from '../receipts.js';
import { c, heading, hr, info, success, warn, error, theme } from '../utils.js';

interface DoctorOptions {
  json?: boolean;
  apiUrl?: string;
}

type DoctorStatus = 'pass' | 'warn' | 'fail';

interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
}

interface DoctorReport {
  ok: boolean;
  status: DoctorStatus;
  cwd: string;
  checks: DoctorCheck[];
}

function statusRank(status: DoctorStatus): number {
  if (status === 'fail') return 3;
  if (status === 'warn') return 2;
  return 1;
}

function worstStatus(checks: DoctorCheck[]): DoctorStatus {
  return checks.reduce<DoctorStatus>((worst, check) => (
    statusRank(check.status) > statusRank(worst) ? check.status : worst
  ), 'pass');
}

function gitRemote(): string {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function providerSummary(): string {
  const providers = detectProviders();
  const configured = Object.entries(providers)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  return configured.length > 0 ? configured.join(', ') : 'no model provider keys configured';
}

async function hostedHealth(apiUrl: string | undefined): Promise<DoctorCheck> {
  const base = (apiUrl || process.env.KELYRA_API_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    return {
      id: 'hosted-api',
      label: 'Hosted API',
      status: 'warn',
      detail: 'not checked; set KELYRA_API_URL or pass --api-url',
    };
  }

  try {
    const response = await fetch(`${base}/api/health`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        id: 'hosted-api',
        label: 'Hosted API',
        status: 'fail',
        detail: `${base}/api/health returned HTTP ${response.status}`,
      };
    }
    const payload = await response.json() as { runnerMode?: string; store?: string; features?: Record<string, unknown> };
    return {
      id: 'hosted-api',
      label: 'Hosted API',
      status: 'pass',
      detail: `${payload.runnerMode || 'unknown runner'} · ${payload.store || 'unknown store'} · worker ${payload.features?.hostedWorker ? 'on' : 'off'}`,
    };
  } catch (err) {
    return {
      id: 'hosted-api',
      label: 'Hosted API',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function kelyraCIWorkflowDetail(): string | null {
  const workflowsDir = join(process.cwd(), '.github', 'workflows');
  const directWorkflow = join(workflowsDir, 'kelyra-verify.yml');
  if (existsSync(directWorkflow)) return '.github/workflows/kelyra-verify.yml found';

  if (!existsSync(workflowsDir)) return null;

  try {
    for (const entry of readdirSync(workflowsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ya?ml)$/i.test(entry.name)) continue;
      const workflowPath = join(workflowsDir, entry.name);
      const content = readFileSync(workflowPath, 'utf-8');
      if (/(?:\bnpx\s+kelyra|\bdist\/cli\.js|\bnode\s+dist\/cli\.js).*?\bverify\s+--ci/s.test(content)) {
        return `.github/workflows/${entry.name} runs Kelyra CI verification`;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function renderCheck(check: DoctorCheck): void {
  const marker = check.status === 'pass'
    ? `${theme.success}PASS${c.reset}`
    : check.status === 'warn'
      ? `${theme.warning}WARN${c.reset}`
      : `${theme.error}FAIL${c.reset}`;
  console.log(`  ${marker} ${c.bold}${check.label}${c.reset}`);
  console.log(`       ${c.dim}${check.detail}${c.reset}`);
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const policy = loadPolicy();
  const manifest = loadAgentManifest();
  const receipts = listReceipts(20);
  const chain = verifyReceiptChain(20);
  const git = isGitRepo();
  const dirty = git ? hasUncommittedChanges() : true;
  const remote = git ? gitRemote() : '';
  const ciWorkflow = kelyraCIWorkflowDetail();

  const checks: DoctorCheck[] = [
    {
      id: 'git',
      label: 'Git workspace',
      status: git ? 'pass' : 'warn',
      detail: git
        ? `${getCurrentBranch()}${dirty ? ' · dirty worktree' : ' · clean'}${remote ? ` · ${remote}` : ''}`
        : 'not inside a git repository',
    },
    {
      id: 'policy',
      label: 'Project policy',
      status: policy.warnings.length > 0 ? 'warn' : policy.found ? 'pass' : 'warn',
      detail: policy.found
        ? `${policy.path}${policy.warnings.length ? ` · ${policy.warnings.join('; ')}` : ''}`
        : 'missing .kelyra/policy.json; run kelyra policy init --template team',
    },
    {
      id: 'manifest',
      label: 'Agent manifest',
      status: manifest.warnings.length > 0 ? 'warn' : manifest.found ? 'pass' : 'warn',
      detail: manifest.found
        ? `${manifest.manifest?.id || 'unknown-agent'}${manifest.warnings.length ? ` · ${manifest.warnings.join('; ')}` : ''}`
        : 'missing .kelyra/agent-manifest.json; run kelyra manifest init',
    },
    {
      id: 'receipts',
      label: 'Local receipts',
      status: receipts.length > 0 ? chain.ok ? 'pass' : 'warn' : 'warn',
      detail: receipts.length > 0
        ? `${receipts.length} recent receipt(s); chain ${chain.ok ? 'ok' : 'needs review'}`
        : 'no local SWD receipts yet',
    },
    {
      id: 'providers',
      label: 'Model providers',
      status: Object.values(detectProviders()).some(Boolean) ? 'pass' : 'warn',
      detail: `${providerSummary()}; proof tools work without model keys`,
    },
    {
      id: 'ci',
      label: 'CI workflow',
      status: ciWorkflow ? 'pass' : 'warn',
      detail: ciWorkflow || 'missing; run kelyra setup-ci --policy-template team',
    },
    await hostedHealth(options.apiUrl),
  ];

  const status = worstStatus(checks);
  const report: DoctorReport = {
    ok: status !== 'fail',
    status,
    cwd: process.cwd(),
    checks,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  console.log(heading('Kelyra Doctor'));
  for (const check of checks) renderCheck(check);
  console.log(hr());

  if (status === 'pass') {
    success('Kelyra workspace is ready.');
  } else if (status === 'warn') {
    warn('Kelyra workspace is usable, but some setup is incomplete.');
  } else {
    error('Kelyra workspace has blocking issues.');
    process.exitCode = 1;
  }

  info('Fast path: kelyra providers check · kelyra policy check · kelyra verify --ci');
}
