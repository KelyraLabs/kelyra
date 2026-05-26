import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AGENT_MANIFEST_PATH = '.kelyra/agent-manifest.json';

export interface AgentManifest {
  id: string;
  name?: string;
  version?: string;
  capabilities: string[];
  signerKeyIds: string[];
}

export interface AgentManifestLoadResult {
  path: string;
  found: boolean;
  manifest?: AgentManifest;
  warnings: string[];
}

export function loadAgentManifest(cwd = process.cwd()): AgentManifestLoadResult {
  const manifestPath = join(cwd, AGENT_MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    return { path: manifestPath, found: false, warnings: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings: string[] = [];
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'unknown-agent';
    if (id === 'unknown-agent') warnings.push('Agent manifest id is missing or invalid.');

    const capabilities = Array.isArray(raw.capabilities)
      ? raw.capabilities.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const signerKeyIds = Array.isArray(raw.signerKeyIds)
      ? raw.signerKeyIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    return {
      path: manifestPath,
      found: true,
      manifest: {
        id,
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
        capabilities,
        signerKeyIds,
      },
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: manifestPath,
      found: true,
      warnings: [`Could not parse ${AGENT_MANIFEST_PATH}: ${message}`],
    };
  }
}
