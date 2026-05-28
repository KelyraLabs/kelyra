import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  createReceiptSigningKeyPair,
  listReceipts,
  readReceipt,
  saveSWDReceipt,
  signReceipt,
  verifyReceipt,
  verifyReceiptChain,
  verifyReceiptIntegrity,
  verifyReceiptSignature,
  type ReceiptSummary,
  type SWDReceipt,
} from '../receipts.js';
import { c, error, heading, hr, info, success, theme, warn } from '../utils.js';

interface ReceiptsOptions {
  limit?: string;
  json?: boolean;
  markdown?: boolean;
  pr?: boolean;
  key?: string;
  force?: boolean;
  apiUrl?: string;
  secret?: string;
  dryRun?: boolean;
}

export async function receiptsCommand(
  action?: string,
  target?: string,
  options: ReceiptsOptions = {},
): Promise<void> {
  const normalizedAction = (action ?? 'list').toLowerCase();

  if (normalizedAction === 'list') {
    printReceiptList(parseLimit(options.limit), options.json);
    return;
  }

  if (normalizedAction === 'latest') {
    printReceipt('latest', options);
    return;
  }

  if (normalizedAction === 'show') {
    printReceipt(target ?? 'latest', options);
    return;
  }

  if (normalizedAction === 'verify') {
    printReceiptVerification(target ?? 'latest', options.json);
    return;
  }

  if (normalizedAction === 'chain') {
    printReceiptChain(parseLimit(options.limit), options.json);
    return;
  }

  if (normalizedAction === 'keygen') {
    createSigningKey(target ?? options.key, Boolean(options.force), options.json);
    return;
  }

  if (normalizedAction === 'sign') {
    signStoredReceipt(target ?? 'latest', options.key, options.json);
    return;
  }

  if (normalizedAction === 'publish') {
    await publishStoredReceipt(target ?? 'latest', options);
    return;
  }

  warn(`Unknown receipts action: ${normalizedAction}`);
  info('Usage: kelyra receipts | kelyra receipts show latest --markdown | kelyra receipts verify latest | kelyra receipts chain | kelyra receipts keygen | kelyra receipts sign latest | kelyra receipts publish latest');
}

function printReceiptList(limit: number, asJson?: boolean): void {
  const receipts = listReceipts(limit);

  if (asJson) {
    console.log(JSON.stringify(receipts, null, 2));
    return;
  }

  console.log(heading('SWD Receipts'));
  if (receipts.length === 0) {
    info('No SWD receipts found yet.');
    return;
  }

  for (const receipt of receipts) {
    const status = formatStatus(receipt);
    const provider = receipt.provider ? `${receipt.provider}/${receipt.model ?? 'unknown'}` : 'unknown';
    console.log(
      `  ${status} ${c.bold}${receipt.id}${c.reset} ${theme.muted}${formatDate(receipt.timestamp)}${c.reset} ` +
      `${theme.info}${receipt.fileCount}${theme.muted} file(s)${c.reset}`,
    );
    console.log(`     ${c.dim}${receipt.summary}${c.reset}`);
    console.log(`     ${c.dim}provider: ${provider} | branch: ${receipt.branch ?? 'none'}${c.reset}`);
    if (receipt.skills && receipt.skills.length > 0) {
      console.log(`     ${c.dim}skills: ${receipt.skills.join(', ')}${c.reset}`);
    }
  }
}

function printReceipt(target: string, options: Pick<ReceiptsOptions, 'json' | 'markdown' | 'pr'> = {}): void {
  const receipt = readReceipt(target);
  if (!receipt) {
    error(`Receipt not found: ${target}`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  if (options.markdown || options.pr) {
    console.log(formatReceiptMarkdown(receipt));
    return;
  }

  console.log(heading(`SWD Receipt ${receipt.id}`));
  printReceiptHeader(receipt);
  console.log(hr());
  console.log(`${c.bold}Files${c.reset}`);

  for (const file of receipt.files) {
    const icon = file.status === 'verified' || file.status === 'noop'
      ? `${theme.success}OK${c.reset}`
      : `${theme.warning}${file.status.toUpperCase()}${c.reset}`;
    const expectedHash = file.expected?.sha256 ? file.expected.sha256.slice(0, 12) : 'none';
    console.log(`  ${icon} ${c.cyan}${file.operation}${c.reset} ${file.path}`);
    console.log(`     ${c.dim}${file.detail}${c.reset}`);
    console.log(`     ${c.dim}expected: ${file.expectedSource} ${expectedHash}${c.reset}`);
  }
}

function formatReceiptMarkdown(receipt: SWDReceipt): string {
  const provider = receipt.provider
    ? `${receipt.provider.providerId}/${receipt.provider.modelId}`
    : 'unknown';
  const usage = receipt.usage
    ? `${receipt.usage.totalTokens.toLocaleString()} tokens`
    : 'unknown';
  const budget = receipt.budget
    ? `~$${receipt.budget.estimatedCostUSD.toFixed(4)}`
    : 'unknown';
  const status = receipt.swd.success
    ? (receipt.swd.rolledBack ? 'rolled back' : 'verified')
    : 'issues';
  const skills = receipt.skills && receipt.skills.length > 0
    ? receipt.skills.map((skill) => `${skill.id}@${skill.version}`).join(', ')
    : 'none';
  const test = receipt.test
    ? `${receipt.test.command} -> ${receipt.test.status}`
    : 'none';

  const lines = [
    '### Kelyra SWD Receipt',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Receipt | \`${mdEscape(receipt.id)}\` |`,
    `| Status | ${mdEscape(status)} |`,
    `| Time | ${mdEscape(formatDate(receipt.timestamp))} |`,
    `| Summary | ${mdEscape(receipt.summary)} |`,
    `| Provider | \`${mdEscape(provider)}\` |`,
    `| Usage | ${mdEscape(usage)} / ${mdEscape(budget)} |`,
    `| Git | \`${mdEscape(receipt.git?.branch ?? 'none')} @ ${mdEscape(receipt.git?.commit?.slice(0, 12) ?? 'none')}\` |`,
    `| Skills | ${mdEscape(skills)} |`,
    `| Test | ${mdEscape(test)} |`,
  ];

  if (receipt.chain?.previousId) {
    lines.push(`| Chain | previous \`${mdEscape(receipt.chain.previousId)}\` |`);
  }
  if (receipt.integrity?.signature) {
    lines.push(`| Signer | \`${mdEscape(receipt.integrity.signature.keyId)}\` |`);
  }

  lines.push(
    '',
    '#### Files',
    '',
    '| Status | Operation | Path | Detail | Expected |',
    '|---|---|---|---|---|',
  );

  for (const file of receipt.files) {
    const expectedHash = file.expected?.sha256 ? file.expected.sha256.slice(0, 12) : 'none';
    const expected = expectedHash === 'none' ? 'none' : `${file.expectedSource} ${expectedHash}`;
    lines.push(
      `| ${mdEscape(file.status)} | ${mdEscape(file.operation)} | \`${mdEscape(file.path)}\` | ${mdEscape(file.detail)} | ${mdEscape(expected)} |`,
    );
  }

  lines.push(
    '',
    '#### Local Verification',
    '',
    `- Inspect: \`kelyra receipts show ${mdEscape(receipt.id)}\``,
    `- Verify drift: \`kelyra receipts verify ${mdEscape(receipt.id)}\``,
  );

  return `${lines.join('\n')}\n`;
}

function printReceiptVerification(target: string, asJson?: boolean): void {
  const receipt = readReceipt(target);
  if (!receipt) {
    error(`Receipt not found: ${target}`);
    return;
  }

  const verification = verifyReceipt(receipt);
  const integrityOk = verifyReceiptIntegrity(receipt);
  const signatureOk = verifyReceiptSignature(receipt);

  if (asJson) {
    console.log(JSON.stringify({ ...verification, integrityOk, signatureOk }, null, 2));
    return;
  }

  console.log(heading(`Verify Receipt ${receipt.id}`));
  printReceiptHeader(receipt);
  console.log(hr());

  if (integrityOk) {
    success('Receipt integrity hash matches.');
  } else {
    warn('Receipt integrity hash does not match. The receipt file may have been edited.');
  }

  if (signatureOk === true) {
    success(`Receipt signature is valid (${receipt.integrity?.signature?.keyId}).`);
  } else if (signatureOk === false) {
    warn('Receipt signature is invalid.');
  } else {
    info('Receipt is not signed.');
  }

  for (const file of verification.files) {
    if (file.status === 'ok') {
      success(`${file.path} - ${file.detail}`);
    } else if (file.status === 'unknown') {
      warn(`${file.path} - ${file.detail}`);
    } else {
      error(`${file.path} - ${file.detail}`);
    }
  }

  console.log();
  if (verification.ok && integrityOk) {
    success('Receipt verification passed.');
  } else {
    warn('Receipt verification found drift or integrity issues.');
  }
}

function printReceiptChain(limit: number, asJson?: boolean): void {
  const chain = verifyReceiptChain(limit);

  if (asJson) {
    console.log(JSON.stringify(chain, null, 2));
    return;
  }

  console.log(heading('SWD Receipt Chain'));
  if (chain.links.length === 0) {
    info('No SWD receipts found yet.');
    return;
  }

  for (const link of chain.links) {
    const status = link.ok ? `${theme.success}OK${c.reset}` : `${theme.warning}BROKEN${c.reset}`;
    console.log(`  ${status} ${c.bold}${link.id}${c.reset}`);
    if (link.previousId) console.log(`     ${c.dim}previous: ${link.previousId}${c.reset}`);
    console.log(`     ${c.dim}${link.detail}${c.reset}`);
  }

  if (chain.ok) success(`Receipt chain verified (${chain.checked} receipt(s)).`);
  else warn('Receipt chain verification found broken links.');
}

function printReceiptHeader(receipt: SWDReceipt): void {
  const provider = receipt.provider
    ? `${receipt.provider.providerId}/${receipt.provider.modelId}`
    : 'unknown';
  const tokens = receipt.usage
    ? `${receipt.usage.totalTokens.toLocaleString()} tokens`
    : 'unknown';
  const cost = receipt.budget
    ? `~$${receipt.budget.estimatedCostUSD.toFixed(4)} session`
    : 'unknown';

  console.log(`  ${c.dim}Time:${c.reset}     ${formatDate(receipt.timestamp)}`);
  console.log(`  ${c.dim}Status:${c.reset}   ${receipt.swd.success ? theme.success + 'verified' : theme.warning + 'issues'}${c.reset}${receipt.swd.rolledBack ? ` ${theme.warning}(rolled back)${c.reset}` : ''}`);
  console.log(`  ${c.dim}Summary:${c.reset}  ${receipt.summary}`);
  console.log(`  ${c.dim}Provider:${c.reset} ${provider}`);
  console.log(`  ${c.dim}Usage:${c.reset}    ${tokens} | ${cost}`);
  console.log(`  ${c.dim}Git:${c.reset}      ${receipt.git?.branch ?? 'none'} @ ${receipt.git?.commit?.slice(0, 12) ?? 'none'}`);
  if (receipt.skills && receipt.skills.length > 0) {
    const skills = receipt.skills.map((skill) => `${skill.id}@${skill.version} (${skill.source})`).join(', ');
    console.log(`  ${c.dim}Skills:${c.reset}   ${skills}`);
  }
  if (receipt.test) {
    console.log(`  ${c.dim}Test:${c.reset}     ${receipt.test.command} -> ${receipt.test.status}`);
  }
  if (receipt.chain?.previousId) {
    console.log(`  ${c.dim}Chain:${c.reset}    previous ${receipt.chain.previousId}`);
  }
  if (receipt.integrity?.signature) {
    console.log(`  ${c.dim}Signer:${c.reset}   ${receipt.integrity.signature.keyId} (${receipt.integrity.signature.algorithm})`);
  }
}

function createSigningKey(rawPath: string | undefined, force: boolean, asJson?: boolean): void {
  const keyPath = resolveKeyPath(rawPath);
  if (existsSync(keyPath) && !force) {
    error(`Signing key already exists: ${keyPath}`);
    info('Use --force to overwrite it, or pass a different path.');
    return;
  }

  const keyPair = createReceiptSigningKeyPair();
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, keyPair.privateKeyPem, { encoding: 'utf-8', mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod semantics.
  }

  if (asJson) {
    console.log(JSON.stringify({
      keyPath,
      keyId: keyPair.keyId,
      publicKeyPem: keyPair.publicKeyPem,
    }, null, 2));
    return;
  }

  success(`Created Ed25519 receipt signing key: ${keyPath}`);
  info(`Public key id: ${keyPair.keyId}`);
}

function signStoredReceipt(target: string, rawKeyPath: string | undefined, asJson?: boolean): void {
  const receipt = readReceipt(target);
  if (!receipt) {
    error(`Receipt not found: ${target}`);
    return;
  }

  const keyPath = resolveKeyPath(rawKeyPath);
  if (!existsSync(keyPath)) {
    error(`Signing key not found: ${keyPath}`);
    info('Create one with: kelyra receipts keygen');
    return;
  }

  const privateKeyPem = readFileSync(keyPath, 'utf-8');
  const signed = signReceipt(receipt, privateKeyPem);
  const savedPath = saveSWDReceipt(signed);
  const keyId = signed.integrity?.signature?.keyId ?? 'unknown';

  if (asJson) {
    console.log(JSON.stringify({
      id: signed.id,
      receiptPath: savedPath,
      keyId,
      signatureOk: verifyReceiptSignature(signed),
    }, null, 2));
    return;
  }

  success(`Signed receipt ${signed.id}.`);
  info(`Receipt: ${savedPath}`);
  info(`Signer: ${keyId}`);
}

async function publishStoredReceipt(target: string, options: ReceiptsOptions): Promise<void> {
  const receipt = readReceipt(target);
  if (!receipt) {
    error(`Receipt not found: ${target}`);
    process.exitCode = 1;
    return;
  }

  const apiUrl = (options.apiUrl || process.env.KELYRA_API_URL || '').trim().replace(/\/+$/, '');
  const secret = (options.secret || process.env.KELYRA_API_SECRET || '').trim();
  const verification = verifyReceipt(receipt);
  const integrityOk = verifyReceiptIntegrity(receipt);
  const signatureOk = verifyReceiptSignature(receipt);

  if (!apiUrl) {
    error('Missing KELYRA_API_URL or --api-url.');
    process.exitCode = 1;
    return;
  }
  if (!secret) {
    error('Missing KELYRA_API_SECRET or --secret.');
    process.exitCode = 1;
    return;
  }

  const payload = {
    receipt,
    verification: {
      filesOk: verification.ok,
      integrityOk,
      signatureOk,
    },
    source: {
      kind: 'kelyra-cli',
      cwd: process.cwd(),
      publishedAt: new Date().toISOString(),
    },
  };

  if (options.dryRun) {
    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        endpoint: `${apiUrl}/api/receipts/import`,
        receiptId: receipt.id,
        verification: payload.verification,
      }, null, 2));
      return;
    }
    info(`Dry run: would publish ${receipt.id} to ${apiUrl}/api/receipts/import`);
    return;
  }

  try {
    const response = await fetch(`${apiUrl}/api/receipts/import`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new Error(message);
    }

    if (options.json) {
      console.log(JSON.stringify(body, null, 2));
      return;
    }

    success(`Published receipt ${receipt.id}.`);
    info(`Hosted owner: ${body.ownerSub || 'operator'}`);
  } catch (err) {
    error(`Receipt publish failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function resolveKeyPath(rawPath: string | undefined): string {
  const defaultPath = join(homedir(), '.kelyra', 'receipt-ed25519-private.pem');
  if (!rawPath) return defaultPath;
  if (rawPath === '~') return homedir();
  if (rawPath.startsWith('~/')) return join(homedir(), rawPath.slice(2));
  return resolve(rawPath);
}

function formatStatus(receipt: ReceiptSummary): string {
  if (receipt.rolledBack) return `${theme.warning}ROLLBACK${c.reset}`;
  return receipt.success ? `${theme.success}VERIFIED${c.reset}` : `${theme.warning}ISSUES${c.reset}`;
}

function formatDate(timestamp: string): string {
  return timestamp.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function parseLimit(raw?: string): number {
  const parsed = parseInt(raw ?? '10', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 100);
}
