import type { KelyraPolicy } from './policy.js';

export type PolicyTemplateName = 'default' | 'team' | 'strict';

export const POLICY_TEMPLATES: Record<PolicyTemplateName, KelyraPolicy> = {
  default: {
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
  },
  team: {
    version: 1,
    blockedPaths: [
      '.env*',
      '.npmrc',
      '.ssh/',
      '**/*private*key*',
      '**/*.pem',
    ],
    confirmPaths: [
      'package.json',
      'package-lock.json',
      '.github/workflows/',
      'Dockerfile',
      'docker-compose*.yml',
      'scripts/',
    ],
    trustedReceiptKeyIds: [],
    requireSignedReceipts: false,
    requireReceiptForCI: false,
    maxWritableActionContentBytes: 250_000,
    maxPatchBytes: 50_000,
    allowedTestCommands: [
      'npm test',
      'npm run test',
      'npm run build',
      'npm run lint',
    ],
    sandboxTestCommands: true,
    requireTestsForPaths: [
      'src/',
      'test/',
      'package.json',
      '.github/workflows/',
    ],
    receiptChain: true,
  },
  strict: {
    version: 1,
    blockedPaths: [
      '.env*',
      '.npmrc',
      '.ssh/',
      '**/*private*key*',
      '**/*.pem',
      '**/secrets/**',
    ],
    confirmPaths: [
      'package.json',
      'package-lock.json',
      '.github/workflows/',
      'Dockerfile',
      'docker-compose*.yml',
      'scripts/',
      'bin/',
    ],
    trustedReceiptKeyIds: [],
    requireSignedReceipts: true,
    requireReceiptForCI: true,
    maxWritableActionContentBytes: 150_000,
    maxPatchBytes: 25_000,
    allowedTestCommands: [
      'npm test',
      'npm run test',
      'npm run build',
      'npm run lint',
    ],
    sandboxTestCommands: true,
    requireTestsForPaths: [
      'src/',
      'test/',
      'package.json',
      'package-lock.json',
      '.github/workflows/',
      'scripts/',
    ],
    receiptChain: true,
  },
};

export function listPolicyTemplateNames(): PolicyTemplateName[] {
  return Object.keys(POLICY_TEMPLATES) as PolicyTemplateName[];
}

export function normalizePolicyTemplateName(name: string | undefined): PolicyTemplateName {
  const normalized = (name ?? 'default').trim().toLowerCase();
  if (normalized === 'default' || normalized === 'team' || normalized === 'strict') {
    return normalized;
  }

  throw new Error(
    `Unknown policy template "${name}". Valid templates: ${listPolicyTemplateNames().join(', ')}.`,
  );
}

export function getPolicyTemplate(name: string | undefined): KelyraPolicy {
  const templateName = normalizePolicyTemplateName(name);
  return structuredClone(POLICY_TEMPLATES[templateName]);
}
