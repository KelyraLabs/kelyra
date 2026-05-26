import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runCIVerification } from '../src/ci/verify.js';
import {
  createReceiptSigningKeyPair,
  createSWDReceipt,
  saveSWDReceipt,
  signReceipt,
} from '../src/receipts.js';
import type { SWDRunResult } from '../src/swd.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kelyra-ci-verify-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Kelyra Test']);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    scripts: {
      test: 'node test.js',
    },
  }, null, 2));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const ok = true;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function writePolicy(dir: string, policy: Record<string, unknown>): void {
  mkdirSync(join(dir, '.kelyra'), { recursive: true });
  writeFileSync(join(dir, '.kelyra', 'policy.json'), JSON.stringify({
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
    ...policy,
  }, null, 2));
}

function receiptResult(filePath: string, absPath: string, before: string, after: string): SWDRunResult {
  return {
    success: true,
    rolledBack: false,
    rollbackErrors: [],
    errors: [],
    results: [
      {
        action: {
          path: filePath,
          operation: 'MODIFY',
          intent: 'MUTATE',
          description: 'Update test fixture',
        },
        status: 'verified',
        detail: `Verified: MODIFY ${filePath}`,
        before: {
          path: absPath,
          exists: true,
          size: before.length,
          mtime: 1,
          hash: sha256(before),
        },
        after: {
          path: absPath,
          exists: true,
          size: after.length,
          mtime: 2,
          hash: sha256(after),
        },
      },
    ],
  };
}

describe('kelyra verify --ci', () => {
  it('runs generic PR review without requiring Kelyra receipts', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'src', 'index.ts'), 'export const ok = false;\n');
      const report = runCIVerification({ cwd: dir });

      assert.equal(report.mode, 'generic');
      assert.equal(report.summary.exitCode, 0);
      assert.equal(report.findings.length, 0);
      assert.equal(report.changedFiles.some((file) => file.path === 'src/index.ts'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on newly added npm install lifecycle scripts', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        scripts: {
          test: 'node test.js',
          postinstall: 'node scripts/setup.js',
        },
      }, null, 2));

      const report = runCIVerification({ cwd: dir });
      assert.equal(report.summary.exitCode, 1);
      assert.equal(report.summary.high, 1);
      assert.ok(report.findings.some((finding) => finding.id === 'npm-lifecycle-script-added'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails in strict mode when only warnings are present', () => {
    const dir = makeRepo();
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');

      const relaxed = runCIVerification({ cwd: dir });
      assert.equal(relaxed.summary.warn, 1);
      assert.equal(relaxed.summary.exitCode, 0);

      const strict = runCIVerification({ cwd: dir, strict: true });
      assert.equal(strict.summary.warn, 1);
      assert.equal(strict.summary.exitCode, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses Kelyra receipt verification when a receipt is changed in the diff', () => {
    const repoRoot = process.cwd();
    const dir = makeRepo();
    try {
      const filePath = 'src/index.ts';
      const absPath = join(dir, filePath);
      const after = 'export const ok = "receipt-covered";\n';
      writeFileSync(absPath, after);

      process.chdir(dir);
      const runResult: SWDRunResult = {
        ...receiptResult(filePath, absPath, 'export const ok = true;\n', after),
      };
      const receipt = createSWDReceipt({
        request: 'update fixture',
        summary: `MODIFY: ${filePath}`,
        result: runResult,
      });
      saveSWDReceipt(receipt);
      process.chdir(repoRoot);

      const report = runCIVerification({ cwd: dir });
      assert.equal(report.mode, 'kelyra-receipts');
      assert.equal(report.receipt.changedReceiptCount, 1);
      assert.equal(report.receipt.validReceiptCount, 1);
      assert.equal(report.receipt.uncoveredChangedFiles.length, 0);
      assert.equal(report.summary.exitCode, 0);
    } finally {
      process.chdir(repoRoot);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when policy requires a receipt and none changed', () => {
    const dir = makeRepo();
    try {
      writePolicy(dir, { requireReceiptForCI: true });
      writeFileSync(join(dir, 'src', 'index.ts'), 'export const ok = "no-receipt";\n');

      const report = runCIVerification({ cwd: dir });
      assert.equal(report.summary.exitCode, 1);
      assert.ok(report.findings.some((finding) => finding.id === 'kelyra-receipt-required'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails unsigned receipts when policy requires signatures', () => {
    const repoRoot = process.cwd();
    const dir = makeRepo();
    try {
      const filePath = 'src/index.ts';
      const absPath = join(dir, filePath);
      const before = 'export const ok = true;\n';
      const after = 'export const ok = "unsigned";\n';
      writePolicy(dir, { requireSignedReceipts: true });
      writeFileSync(absPath, after);

      process.chdir(dir);
      const receipt = createSWDReceipt({
        request: 'unsigned update',
        summary: `MODIFY: ${filePath}`,
        result: receiptResult(filePath, absPath, before, after),
      });
      saveSWDReceipt(receipt);
      process.chdir(repoRoot);

      const report = runCIVerification({ cwd: dir });
      assert.equal(report.summary.exitCode, 1);
      assert.ok(report.findings.some((finding) => finding.id === 'kelyra-receipt-signature-required'));
    } finally {
      process.chdir(repoRoot);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails valid signatures from untrusted signer keys', () => {
    const repoRoot = process.cwd();
    const dir = makeRepo();
    try {
      const filePath = 'src/index.ts';
      const absPath = join(dir, filePath);
      const before = 'export const ok = true;\n';
      const after = 'export const ok = "untrusted";\n';
      const keyPair = createReceiptSigningKeyPair();
      writePolicy(dir, {
        requireSignedReceipts: true,
        trustedReceiptKeyIds: ['different-key-id'],
      });
      writeFileSync(absPath, after);

      process.chdir(dir);
      const receipt = createSWDReceipt({
        request: 'untrusted update',
        summary: `MODIFY: ${filePath}`,
        result: receiptResult(filePath, absPath, before, after),
      });
      saveSWDReceipt(signReceipt(receipt, keyPair.privateKeyPem));
      process.chdir(repoRoot);

      const report = runCIVerification({ cwd: dir });
      assert.equal(report.summary.exitCode, 1);
      assert.ok(report.findings.some((finding) => finding.id === 'kelyra-receipt-untrusted-signer'));
    } finally {
      process.chdir(repoRoot);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts valid signed receipts from trusted signer keys', () => {
    const repoRoot = process.cwd();
    const dir = makeRepo();
    try {
      const filePath = 'src/index.ts';
      const absPath = join(dir, filePath);
      const before = 'export const ok = true;\n';
      const after = 'export const ok = "trusted";\n';
      const keyPair = createReceiptSigningKeyPair();
      writePolicy(dir, {
        requireSignedReceipts: true,
        trustedReceiptKeyIds: [keyPair.keyId],
      });
      writeFileSync(absPath, after);

      process.chdir(dir);
      const receipt = createSWDReceipt({
        request: 'trusted update',
        summary: `MODIFY: ${filePath}`,
        result: receiptResult(filePath, absPath, before, after),
      });
      saveSWDReceipt(signReceipt(receipt, keyPair.privateKeyPem));
      process.chdir(repoRoot);

      const report = runCIVerification({ cwd: dir });
      assert.equal(report.summary.high, 0);
      assert.equal(report.summary.exitCode, 0);
      assert.equal(report.receipt.validReceiptCount, 1);
    } finally {
      process.chdir(repoRoot);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
