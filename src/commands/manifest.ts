import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AGENT_MANIFEST_PATH, loadAgentManifest } from '../agent-manifest.js';
import { error, heading, info, success, warn } from '../utils.js';

interface ManifestOptions {
  json?: boolean;
  force?: boolean;
}

const DEFAULT_AGENT_MANIFEST = {
  id: 'local-agent',
  name: 'Local Agent',
  version: '0.1.0',
  capabilities: ['read', 'patch', 'write', 'test'],
  signerKeyIds: [],
};

export async function manifestCommand(action = 'show', options: ManifestOptions = {}): Promise<void> {
  const normalizedAction = action.toLowerCase();

  if (normalizedAction === 'show' || normalizedAction === 'check') {
    const result = loadAgentManifest();
    if (options.json) {
      console.log(JSON.stringify({
        ok: result.warnings.length === 0,
        found: result.found,
        path: result.path,
        manifest: result.manifest,
        warnings: result.warnings,
      }, null, 2));
      return;
    }

    console.log(heading('Agent Manifest'));
    info(result.found ? `Loaded ${AGENT_MANIFEST_PATH}` : `No ${AGENT_MANIFEST_PATH}.`);
    if (result.manifest) console.log(JSON.stringify(result.manifest, null, 2));
    for (const warningMessage of result.warnings) warn(warningMessage);
    if (result.warnings.length === 0) success('Agent manifest check passed.');
    return;
  }

  if (normalizedAction === 'init') {
    if (existsSync(AGENT_MANIFEST_PATH) && !options.force) {
      error(`${AGENT_MANIFEST_PATH} already exists. Use --force to overwrite it.`);
      process.exitCode = 1;
      return;
    }

    mkdirSync(dirname(AGENT_MANIFEST_PATH), { recursive: true });
    writeFileSync(AGENT_MANIFEST_PATH, `${JSON.stringify(DEFAULT_AGENT_MANIFEST, null, 2)}\n`, 'utf-8');
    success(`Created ${AGENT_MANIFEST_PATH}`);
    return;
  }

  error(`Unknown manifest action: ${normalizedAction}`);
  info('Usage: kelyra manifest show | kelyra manifest check | kelyra manifest init');
  process.exitCode = 1;
}
