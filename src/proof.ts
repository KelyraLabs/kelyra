import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgentManifest } from './agent-manifest.js';
import { loadPolicy } from './policy.js';
import {
  getReceiptsDir,
  readReceipt,
  verifyReceipt,
  verifyReceiptChain,
  verifyReceiptIntegrity,
  verifyReceiptSignature,
  type SWDReceipt,
} from './receipts.js';
import { isGitRepo } from './git.js';

export interface ProofBundle {
  version: 1;
  generatedAt: string;
  receipt: SWDReceipt;
  verification: {
    filesOk: boolean;
    integrityOk: boolean;
    signatureOk: boolean | null;
    chainOk: boolean;
  };
  policy: ReturnType<typeof loadPolicy>;
  agentManifest: ReturnType<typeof loadAgentManifest>;
  git: {
    diff?: string;
    diffError?: string;
  };
}

export interface ProofExportResult {
  ok: boolean;
  path: string;
  bundle: ProofBundle;
}

function runGit(args: string[], okStatuses = [0]): { stdout: string; error?: string } {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error) {
    return { stdout: result.stdout ?? '', error: result.error.message };
  }

  const status = result.status ?? 0;
  if (!okStatuses.includes(status)) {
    return {
      stdout: result.stdout ?? '',
      error: (result.stderr || result.stdout || `git ${args.join(' ')} exited ${status}`).trim(),
    };
  }

  return { stdout: result.stdout ?? '' };
}

function isTrackedOrStaged(filePath: string): boolean {
  const result = spawnSync('git', ['ls-files', '--cached', '--error-unmatch', '--', filePath], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  });

  return !result.error && result.status === 0;
}

function syntheticCreateDiff(filePath: string): { diff?: string; error?: string } {
  const result = runGit(['diff', '--no-index', '--', '/dev/null', filePath], [0, 1]);
  if (result.error && result.stdout.length === 0) return { error: result.error };
  return { diff: result.stdout };
}

function gitDiffForReceipt(receipt: SWDReceipt): { diff?: string; diffError?: string } {
  if (!isGitRepo()) return {};

  const paths = receipt.files
    .map((file) => file.path)
    .filter((filePath) => filePath && !filePath.startsWith('.kelyra/receipts/'));
  if (paths.length === 0) return {};

  const chunks: string[] = [];
  const errors: string[] = [];

  const headDiff = runGit(['diff', 'HEAD', '--', ...paths]);
  if (headDiff.error) {
    const worktreeDiff = runGit(['diff', '--', ...paths]);
    if (worktreeDiff.error) errors.push(headDiff.error, worktreeDiff.error);
    if (worktreeDiff.stdout.trim().length > 0) chunks.push(worktreeDiff.stdout);
  } else if (headDiff.stdout.trim().length > 0) {
    chunks.push(headDiff.stdout);
  }

  for (const file of receipt.files) {
    const operation = file.operation.toUpperCase();
    if (
      !file.path ||
      file.path.startsWith('.kelyra/receipts/') ||
      !['CREATE', 'MODIFY', 'PATCH'].includes(operation) ||
      isTrackedOrStaged(file.path) ||
      !existsSync(file.path)
    ) {
      continue;
    }

    const createdDiff = syntheticCreateDiff(file.path);
    if (createdDiff.diff && createdDiff.diff.trim().length > 0) chunks.push(createdDiff.diff);
    if (createdDiff.error) errors.push(createdDiff.error);
  }

  return {
    ...(chunks.length > 0 ? { diff: chunks.join('\n') } : {}),
    ...(errors.length > 0 ? { diffError: Array.from(new Set(errors)).join('\n') } : {}),
  };
}

export function createProofBundle(target = 'latest'): ProofBundle {
  const receipt = readReceipt(target);
  if (!receipt) {
    throw new Error(`Receipt not found: ${target}`);
  }

  const fileVerification = verifyReceipt(receipt);
  const integrityOk = verifyReceiptIntegrity(receipt);
  const signatureOk = verifyReceiptSignature(receipt);
  const chain = verifyReceiptChain();

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    receipt,
    verification: {
      filesOk: fileVerification.ok,
      integrityOk,
      signatureOk,
      chainOk: chain.ok,
    },
    policy: loadPolicy(),
    agentManifest: loadAgentManifest(),
    git: gitDiffForReceipt(receipt),
  };
}

export function exportProofBundle(target = 'latest', outDir?: string): ProofExportResult {
  const bundle = createProofBundle(target);
  const dir = outDir ?? join(process.cwd(), '.kelyra', 'proofs', bundle.receipt.id);
  mkdirSync(dir, { recursive: true });

  const proofPath = join(dir, 'proof.json');
  writeFileSync(proofPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');

  const receiptDir = getReceiptsDir();
  if (!existsSync(receiptDir)) {
    mkdirSync(receiptDir, { recursive: true });
  }

  return {
    ok: bundle.verification.filesOk && bundle.verification.integrityOk && bundle.verification.signatureOk !== false,
    path: proofPath,
    bundle,
  };
}
