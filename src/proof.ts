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

export interface ProofShareResult extends ProofExportResult {
  htmlPath: string;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function proofShareHtml(bundle: ProofBundle): string {
  const proofJson = JSON.stringify(bundle, null, 2);
  const encodedProof = escapeHtml(proofJson);
  const status = bundle.verification.filesOk && bundle.verification.integrityOk && bundle.verification.signatureOk !== false
    ? 'verified'
    : 'review needed';
  const files = bundle.receipt.files
    .map((file) => `<li><strong>${escapeHtml(file.operation)}</strong><span>${escapeHtml(file.path)}</span><em>${escapeHtml(file.status)}</em></li>`)
    .join('\n        ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kelyra Proof ${escapeHtml(bundle.receipt.id)}</title>
    <style>
      :root { color-scheme: dark; --bg: #07080c; --panel: #11141c; --ink: #f7f4f8; --muted: #a7a1b0; --line: rgba(255,255,255,.14); --cyan: #7de9f0; --warn: #f0c66b; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 16% 0%, rgba(125,233,240,.12), transparent 34%), var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
      header, section { border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(180deg, rgba(255,255,255,.045), transparent), rgba(17,20,28,.86); padding: 24px; margin-bottom: 16px; }
      p, span, em { color: var(--muted); }
      h1 { margin: 8px 0 10px; font-size: clamp(34px, 6vw, 72px); line-height: .95; letter-spacing: 0; }
      code, pre, .eyebrow { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
      .eyebrow { color: var(--cyan); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
      .metric { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: rgba(255,255,255,.035); }
      .metric strong { display: block; margin-top: 8px; font-size: 20px; }
      ul { display: grid; gap: 8px; padding: 0; list-style: none; }
      li { display: grid; grid-template-columns: 120px minmax(0, 1fr) 120px; gap: 12px; border-bottom: 1px solid var(--line); padding: 10px 0; }
      li span { overflow-wrap: anywhere; }
      pre { overflow: auto; max-height: 520px; margin: 0; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: #05060a; color: var(--muted); }
      @media (max-width: 820px) { .grid { grid-template-columns: 1fr 1fr; } li { grid-template-columns: 1fr; } main { padding-top: 24px; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="eyebrow">Kelyra portable proof</div>
        <h1>${escapeHtml(bundle.receipt.summary || bundle.receipt.id)}</h1>
        <p><code>${escapeHtml(bundle.receipt.id)}</code> generated ${escapeHtml(bundle.generatedAt)}. This file is self-contained and can be reviewed without connecting to a model provider.</p>
        <div class="grid">
          <div class="metric"><span>Files</span><strong>${bundle.verification.filesOk ? 'ok' : 'drift'}</strong></div>
          <div class="metric"><span>Integrity</span><strong>${bundle.verification.integrityOk ? 'ok' : 'failed'}</strong></div>
          <div class="metric"><span>Signature</span><strong>${bundle.verification.signatureOk === null ? 'unsigned' : bundle.verification.signatureOk ? 'ok' : 'failed'}</strong></div>
          <div class="metric"><span>Status</span><strong>${escapeHtml(status)}</strong></div>
        </div>
      </header>
      <section>
        <div class="eyebrow">Touched files</div>
        <ul>
        ${files || '<li><strong>none</strong><span>No files recorded.</span><em>empty</em></li>'}
        </ul>
      </section>
      <section>
        <div class="eyebrow">Raw proof JSON</div>
        <pre>${encodedProof}</pre>
      </section>
    </main>
  </body>
</html>
`;
}

export function exportProofShare(target = 'latest', outDir?: string): ProofShareResult {
  const result = exportProofBundle(target, outDir);
  const dir = outDir ?? join(process.cwd(), '.kelyra', 'proofs', result.bundle.receipt.id);
  const htmlPath = join(dir, 'index.html');
  writeFileSync(htmlPath, proofShareHtml(result.bundle), 'utf-8');
  return {
    ...result,
    htmlPath,
  };
}
