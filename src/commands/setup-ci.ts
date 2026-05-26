import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { POLICY_PATH } from '../policy.js';
import { getPolicyTemplate, normalizePolicyTemplateName } from '../policy-templates.js';
import { c, heading, info, success, warn, error } from '../utils.js';

const WORKFLOW_PATH = '.github/workflows/kelyra-verify.yml';

interface SetupCIOptions {
  force?: boolean;
  strict?: boolean;
  policy?: boolean;
  policyTemplate?: string;
}

function workflowContents(strict: boolean): string {
  const verifyCommand = strict
    ? 'npx kelyra verify --ci --strict'
    : 'npx kelyra verify --ci';

  return `name: Kelyra Verify

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  kelyra-verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run Kelyra CI verification
        run: ${verifyCommand}
`;
}

function writeIfAllowed(path: string, content: string, force: boolean): 'created' | 'exists' {
  if (existsSync(path) && !force) return 'exists';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
  return 'created';
}

export async function setupCICommand(options: SetupCIOptions = {}): Promise<void> {
  const force = options.force === true;
  const strict = options.strict === true;
  const shouldWritePolicy = options.policy !== false;
  const policyTemplateName = options.policyTemplate ?? (strict ? 'strict' : 'team');

  console.log(heading('Kelyra CI Setup'));

  const workflowResult = writeIfAllowed(WORKFLOW_PATH, workflowContents(strict), force);
  if (workflowResult === 'created') {
    success(`Created ${WORKFLOW_PATH}`);
  } else {
    warn(`${WORKFLOW_PATH} already exists. Use --force to overwrite it.`);
  }

  if (shouldWritePolicy) {
    let policy;
    let normalizedTemplate;
    try {
      normalizedTemplate = normalizePolicyTemplateName(policyTemplateName);
      policy = getPolicyTemplate(normalizedTemplate);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }

    const policyResult = writeIfAllowed(POLICY_PATH, `${JSON.stringify(policy, null, 2)}\n`, force);
    if (policyResult === 'created') {
      success(`Created ${POLICY_PATH} (${normalizedTemplate} template)`);
    } else {
      warn(`${POLICY_PATH} already exists. Use --force to overwrite it.`);
    }
  } else {
    info('Skipped policy scaffold because --no-policy was provided.');
  }

  console.log();
  console.log(`${c.dim}Next:${c.reset} run ${c.cyan}kelyra verify --ci${c.reset} locally before opening the PR.`);
}
