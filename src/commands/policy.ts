import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { POLICY_PATH, loadPolicy } from '../policy.js';
import { getPolicyTemplate, listPolicyTemplateNames } from '../policy-templates.js';
import { error, heading, info, success, warn } from '../utils.js';

interface PolicyOptions {
  json?: boolean;
  force?: boolean;
  template?: string;
}

export async function policyCommand(action = 'check', options: PolicyOptions = {}): Promise<void> {
  const normalizedAction = action.toLowerCase();

  if (normalizedAction === 'show' || normalizedAction === 'check') {
    const result = loadPolicy();
    if (options.json) {
      console.log(JSON.stringify({
        ok: result.warnings.length === 0,
        found: result.found,
        path: result.path,
        policy: result.policy,
        warnings: result.warnings,
      }, null, 2));
      return;
    }

    console.log(heading('Kelyra Policy'));
    info(result.found ? `Loaded ${POLICY_PATH}` : `No ${POLICY_PATH}; using default policy.`);
    console.log(JSON.stringify(result.policy, null, 2));
    for (const policyWarning of result.warnings) warn(policyWarning);
    if (result.warnings.length === 0) success('Policy check passed.');
    return;
  }

  if (normalizedAction === 'templates') {
    if (options.json) {
      console.log(JSON.stringify({ templates: listPolicyTemplateNames() }, null, 2));
      return;
    }

    console.log(heading('Kelyra Policy Templates'));
    for (const template of listPolicyTemplateNames()) info(template);
    return;
  }

  if (normalizedAction === 'init') {
    if (existsSync(POLICY_PATH) && !options.force) {
      error(`${POLICY_PATH} already exists. Use --force to overwrite it.`);
      process.exitCode = 1;
      return;
    }

    let policy;
    try {
      policy = getPolicyTemplate(options.template);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }

    mkdirSync(dirname(POLICY_PATH), { recursive: true });
    writeFileSync(POLICY_PATH, `${JSON.stringify(policy, null, 2)}\n`, 'utf-8');
    success(`Created ${POLICY_PATH} (${options.template ?? 'default'} template)`);
    return;
  }

  error(`Unknown policy action: ${normalizedAction}`);
  info('Usage: kelyra policy check | kelyra policy show | kelyra policy templates | kelyra policy init --template team');
  process.exitCode = 1;
}
