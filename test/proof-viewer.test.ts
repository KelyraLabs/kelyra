import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProofBundle, exportProofBundle } from '../src/proof.js';
import {
  createReceiptSigningKeyPair,
  createSWDReceipt,
  saveSWDReceipt,
  signReceipt,
} from '../src/receipts.js';
import { createViewerServer } from '../src/commands/viewer.js';
import type { SWDRunResult } from '../src/swd.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function withTempRepo<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const original = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'kelyra-proof-viewer-'));
  process.chdir(dir);
  try {
    git(dir, ['init']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Kelyra Test']);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'config.ts'), 'export const name = "before";\n', 'utf-8');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'initial']);
    return await fn(dir);
  } finally {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  }
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
          operation: 'PATCH',
          intent: 'MUTATE',
          description: 'Patch config',
        },
        status: 'verified',
        detail: `Verified: PATCH ${filePath}`,
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

function createReceiptResult(filePath: string, absPath: string, after: string): SWDRunResult {
  return {
    success: true,
    rolledBack: false,
    rollbackErrors: [],
    errors: [],
    results: [
      {
        action: {
          path: filePath,
          operation: 'CREATE',
          intent: 'MUTATE',
          description: 'Create file',
          content: after,
        },
        status: 'verified',
        detail: `Verified: CREATE ${filePath}`,
        before: {
          path: absPath,
          exists: false,
          size: 0,
          mtime: 0,
          hash: '',
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

function patchUntrackedReceiptResult(filePath: string, absPath: string, before: string, after: string): SWDRunResult {
  return {
    success: true,
    rolledBack: false,
    rollbackErrors: [],
    errors: [],
    results: [
      {
        action: {
          path: filePath,
          operation: 'PATCH',
          intent: 'MUTATE',
          description: 'Patch untracked file',
        },
        status: 'verified',
        detail: `Verified: PATCH ${filePath}`,
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

function listen(server: ReturnType<typeof createViewerServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Viewer server did not expose a TCP address.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createViewerServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}

describe('proof bundles and viewer API', () => {
  it('exports signed proof bundles with git diff metadata', async () => {
    await withTempRepo(async (dir) => {
      const filePath = 'src/config.ts';
      const absPath = join(dir, filePath);
      const before = 'export const name = "before";\n';
      const after = 'export const name = "after";\n';
      writeFileSync(absPath, after, 'utf-8');

      const keyPair = createReceiptSigningKeyPair();
      const receipt = createSWDReceipt({
        request: 'patch config',
        summary: `PATCH: ${filePath}`,
        result: receiptResult(filePath, absPath, before, after),
      });
      saveSWDReceipt(signReceipt(receipt, keyPair.privateKeyPem));

      const proof = createProofBundle('latest');
      assert.equal(proof.verification.filesOk, true);
      assert.equal(proof.verification.integrityOk, true);
      assert.equal(proof.verification.signatureOk, true);
      assert.match(proof.git.diff ?? '', /-export const name = "before"/);
      assert.match(proof.git.diff ?? '', /\+export const name = "after"/);

      const exported = exportProofBundle('latest');
      assert.equal(exported.ok, true);
      assert.equal(JSON.parse(readFileSync(exported.path, 'utf-8')).receipt.id, receipt.id);
    });
  });

  it('includes synthetic git diff metadata for untracked created files', async () => {
    await withTempRepo(async (dir) => {
      const filePath = 'src/created.ts';
      const absPath = join(dir, filePath);
      const after = 'export const created = true;\n';
      writeFileSync(absPath, after, 'utf-8');

      const keyPair = createReceiptSigningKeyPair();
      const receipt = createSWDReceipt({
        request: 'create file',
        summary: `CREATE: ${filePath}`,
        result: createReceiptResult(filePath, absPath, after),
      });
      saveSWDReceipt(signReceipt(receipt, keyPair.privateKeyPem));

      const proof = createProofBundle('latest');
      assert.equal(proof.verification.filesOk, true);
      assert.equal(proof.verification.integrityOk, true);
      assert.equal(proof.verification.signatureOk, true);
      assert.match(proof.git.diff ?? '', /new file mode/);
      assert.match(proof.git.diff ?? '', /\+export const created = true;/);
    });
  });

  it('includes synthetic git diff metadata for patched files that are still untracked', async () => {
    await withTempRepo(async (dir) => {
      const filePath = 'src/untracked.ts';
      const absPath = join(dir, filePath);
      const before = 'export const status = "draft";\n';
      const after = 'export const status = "ready";\n';
      writeFileSync(absPath, after, 'utf-8');

      const keyPair = createReceiptSigningKeyPair();
      const receipt = createSWDReceipt({
        request: 'patch untracked file',
        summary: `PATCH: ${filePath}`,
        result: patchUntrackedReceiptResult(filePath, absPath, before, after),
      });
      saveSWDReceipt(signReceipt(receipt, keyPair.privateKeyPem));

      const proof = createProofBundle('latest');
      assert.equal(proof.verification.filesOk, true);
      assert.match(proof.git.diff ?? '', /new file mode/);
      assert.match(proof.git.diff ?? '', /\+export const status = "ready";/);
    });
  });

  it('serves proof JSON and HTML through the local viewer server', async () => {
    await withTempRepo(async (dir) => {
      const filePath = 'src/config.ts';
      const absPath = join(dir, filePath);
      const before = 'export const name = "before";\n';
      const after = 'export const name = "viewer";\n';
      writeFileSync(absPath, after, 'utf-8');

      const keyPair = createReceiptSigningKeyPair();
      const receipt = createSWDReceipt({
        request: 'viewer config',
        summary: `PATCH: ${filePath}`,
        result: receiptResult(filePath, absPath, before, after),
      });
      saveSWDReceipt(signReceipt(receipt, keyPair.privateKeyPem));

      const server = createViewerServer('latest');
      const port = await listen(server);
      try {
        const proofResponse = await fetch(`http://127.0.0.1:${port}/api/proof`);
        assert.equal(proofResponse.status, 200);
        const proof = await proofResponse.json() as { receipt: { id: string }; verification: { signatureOk: boolean } };
        assert.equal(proof.receipt.id, receipt.id);
        assert.equal(proof.verification.signatureOk, true);

        const htmlResponse = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(htmlResponse.status, 200);
        assert.match(await htmlResponse.text(), /Kelyra Receipt Viewer/);
      } finally {
        await close(server);
      }
    });
  });
});
