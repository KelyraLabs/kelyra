import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const POLICY_PATH = '.kelyra/policy.json';

export interface KelyraPolicy {
  version: 1;
  blockedPaths: string[];
  confirmPaths: string[];
  trustedReceiptKeyIds: string[];
  requireSignedReceipts: boolean;
  requireReceiptForCI: boolean;
  maxWritableActionContentBytes?: number;
  maxPatchBytes?: number;
  allowedTestCommands: string[];
  sandboxTestCommands: boolean;
  requireTestsForPaths: string[];
  receiptChain: boolean;
}

export interface PolicyLoadResult {
  path: string;
  found: boolean;
  policy: KelyraPolicy;
  warnings: string[];
}

export const DEFAULT_POLICY: KelyraPolicy = {
  version: 1,
  blockedPaths: [],
  confirmPaths: [],
  trustedReceiptKeyIds: [],
  requireSignedReceipts: false,
  requireReceiptForCI: false,
  allowedTestCommands: [],
  sandboxTestCommands: false,
  requireTestsForPaths: [],
  receiptChain: true,
};

function stringArray(value: unknown, field: string, warnings: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${field} must be an array of strings; ignoring it.`);
    return [];
  }

  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (strings.length !== value.length) {
    warnings.push(`${field} contained non-string entries; ignoring those entries.`);
  }
  return strings.map((item) => item.trim());
}

function booleanValue(value: unknown, fallback: boolean, field: string, warnings: string[]): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    warnings.push(`${field} must be a boolean; using ${fallback}.`);
    return fallback;
  }
  return value;
}

function positiveInteger(value: unknown, field: string, warnings: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    warnings.push(`${field} must be a positive integer; ignoring it.`);
    return undefined;
  }
  return value;
}

export function loadPolicy(cwd = process.cwd()): PolicyLoadResult {
  const policyPath = join(cwd, POLICY_PATH);
  if (!existsSync(policyPath)) {
    return {
      path: policyPath,
      found: false,
      policy: { ...DEFAULT_POLICY },
      warnings: [],
    };
  }

  const warnings: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(policyPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: policyPath,
      found: true,
      policy: { ...DEFAULT_POLICY },
      warnings: [`Could not parse ${POLICY_PATH}: ${message}`],
    };
  }

  const policy: KelyraPolicy = {
    version: 1,
    blockedPaths: stringArray(raw.blockedPaths, 'blockedPaths', warnings),
    confirmPaths: stringArray(raw.confirmPaths, 'confirmPaths', warnings),
    trustedReceiptKeyIds: stringArray(raw.trustedReceiptKeyIds, 'trustedReceiptKeyIds', warnings),
    requireSignedReceipts: booleanValue(raw.requireSignedReceipts, DEFAULT_POLICY.requireSignedReceipts, 'requireSignedReceipts', warnings),
    requireReceiptForCI: booleanValue(raw.requireReceiptForCI, DEFAULT_POLICY.requireReceiptForCI, 'requireReceiptForCI', warnings),
    maxWritableActionContentBytes: positiveInteger(raw.maxWritableActionContentBytes, 'maxWritableActionContentBytes', warnings),
    maxPatchBytes: positiveInteger(raw.maxPatchBytes, 'maxPatchBytes', warnings),
    allowedTestCommands: stringArray(raw.allowedTestCommands, 'allowedTestCommands', warnings),
    sandboxTestCommands: booleanValue(raw.sandboxTestCommands, DEFAULT_POLICY.sandboxTestCommands, 'sandboxTestCommands', warnings),
    requireTestsForPaths: stringArray(raw.requireTestsForPaths, 'requireTestsForPaths', warnings),
    receiptChain: booleanValue(raw.receiptChain, DEFAULT_POLICY.receiptChain, 'receiptChain', warnings),
  };

  if (raw.version !== undefined && raw.version !== 1) {
    warnings.push(`Unsupported policy version ${String(raw.version)}; treating it as version 1 where possible.`);
  }

  return { path: policyPath, found: true, policy, warnings };
}

export function normalizePolicyPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function policyPatternMatches(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePolicyPath(pattern);
  const normalizedPath = normalizePolicyPath(filePath);

  if (normalizedPattern === normalizedPath) return true;
  if (normalizedPattern.endsWith('/')) return normalizedPath.startsWith(normalizedPattern);

  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

export function anyPolicyPatternMatches(patterns: string[], filePath: string): boolean {
  return patterns.some((pattern) => policyPatternMatches(pattern, filePath));
}

export function isTestCommandAllowed(policy: KelyraPolicy, command: string): boolean {
  if (policy.allowedTestCommands.length === 0) return true;
  const trimmed = command.trim();
  return policy.allowedTestCommands.some((allowed) => trimmed === allowed || trimmed.startsWith(`${allowed} `));
}
