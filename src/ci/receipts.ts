import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile, CIFinding } from './types.js';
import { verifyReceiptIntegrity, verifyReceiptSignature, type SWDReceipt } from '../receipts.js';
import type { KelyraPolicy } from '../policy.js';

export interface ReceiptReview {
  checked: boolean;
  changedReceiptCount: number;
  validReceiptCount: number;
  coveredChangedFileCount: number;
  uncoveredChangedFiles: string[];
  findings: CIFinding[];
}

function normalized(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isReceiptPath(filePath: string): boolean {
  return /^\.kelyra\/receipts\/.*\.json$/i.test(normalized(filePath));
}

function isReceiptFileChanged(file: ChangedFile): boolean {
  return isReceiptPath(file.path);
}

function parseReceipt(cwd: string, filePath: string): SWDReceipt | null {
  try {
    return JSON.parse(readFileSync(join(cwd, filePath), 'utf-8')) as SWDReceipt;
  } catch {
    return null;
  }
}

export function reviewChangedReceipts(cwd: string, changedFiles: ChangedFile[]): ReceiptReview {
  return reviewChangedReceiptsWithPolicy(cwd, changedFiles);
}

export function reviewChangedReceiptsWithPolicy(
  cwd: string,
  changedFiles: ChangedFile[],
  policy?: KelyraPolicy,
): ReceiptReview {
  const receiptFiles = changedFiles.filter(isReceiptFileChanged);
  const findings: CIFinding[] = [];
  const coveredFiles = new Set<string>();
  let validReceiptCount = 0;

  for (const file of receiptFiles) {
    if (file.status === 'deleted') {
      findings.push({
        id: 'kelyra-receipt-deleted',
        severity: 'warn',
        title: 'Kelyra receipt deleted',
        file: file.path,
        evidence: [`${file.path} was deleted`],
        why: 'Receipts are local audit records for SWD-verified file actions. Deleting a committed receipt removes audit context.',
        recommendation: 'Confirm the receipt was intentionally removed, or keep receipts private and gitignored if they should not be committed.',
      });
      continue;
    }

    if (!existsSync(join(cwd, file.path))) continue;
    const receipt = parseReceipt(cwd, file.path);
    if (!receipt) {
      findings.push({
        id: 'kelyra-receipt-invalid-json',
        severity: 'warn',
        title: 'Kelyra receipt is not valid JSON',
        file: file.path,
        evidence: [`${file.path} could not be parsed`],
        why: 'Invalid receipt files cannot be used to verify SWD-covered changes.',
        recommendation: 'Regenerate the receipt or remove it from the PR if it was not intended to be committed.',
      });
      continue;
    }

    validReceiptCount++;
    for (const receiptFile of receipt.files ?? []) {
      if (receiptFile.path) coveredFiles.add(normalized(receiptFile.path));
    }

    if (!verifyReceiptIntegrity(receipt)) {
      findings.push({
        id: 'kelyra-receipt-integrity-mismatch',
        severity: 'warn',
        title: 'Kelyra receipt integrity mismatch',
        file: file.path,
        evidence: [`${file.path} integrity hash does not match its payload`],
        why: 'A receipt integrity mismatch means the receipt may have been edited after it was created.',
        recommendation: 'Regenerate the receipt from a fresh Kelyra run or review why the committed receipt was edited.',
      });
    }

    const signatureOk = verifyReceiptSignature(receipt);
    const keyId = receipt.integrity?.signature?.keyId;

    if (signatureOk === false) {
      findings.push({
        id: 'kelyra-receipt-signature-invalid',
        severity: 'high',
        title: 'Kelyra receipt signature is invalid',
        file: file.path,
        evidence: [`${file.path} has an invalid Ed25519 signature`],
        why: 'An invalid receipt signature means the receipt cannot be trusted as an attestation from the claimed signer.',
        recommendation: 'Regenerate and re-sign the receipt with a trusted local signing key.',
      });
    }

    if (policy?.requireSignedReceipts && signatureOk !== true) {
      findings.push({
        id: 'kelyra-receipt-signature-required',
        severity: 'high',
        title: 'Signed Kelyra receipt required',
        file: file.path,
        evidence: [`${file.path} is not signed with a valid Ed25519 receipt signature`],
        why: 'Project policy requires committed receipts to carry a valid signature.',
        recommendation: 'Sign the receipt with `kelyra receipts sign <id>` before merge.',
      });
    }

    if (
      signatureOk === true &&
      policy?.trustedReceiptKeyIds &&
      policy.trustedReceiptKeyIds.length > 0 &&
      keyId &&
      !policy.trustedReceiptKeyIds.includes(keyId)
    ) {
      findings.push({
        id: 'kelyra-receipt-untrusted-signer',
        severity: 'high',
        title: 'Kelyra receipt signer is not trusted by policy',
        file: file.path,
        evidence: [`${file.path} signer key id: ${keyId}`],
        why: 'The receipt signature is cryptographically valid, but the signer is not in the project trust policy.',
        recommendation: 'Use a trusted receipt signing key or add the key id to `.kelyra/policy.json` after review.',
      });
    }
  }

  const changedNonReceiptFiles = changedFiles
    .filter((file) => file.status !== 'deleted')
    .map((file) => normalized(file.path))
    .filter((filePath) => !isReceiptPath(filePath));
  const uncoveredChangedFiles = receiptFiles.length === 0
    ? []
    : changedNonReceiptFiles.filter((filePath) => !coveredFiles.has(filePath));

  if (receiptFiles.length > 0 && uncoveredChangedFiles.length > 0) {
    findings.push({
      id: 'kelyra-receipt-coverage-mismatch',
      severity: 'warn',
      title: 'Changed files are not covered by changed Kelyra receipts',
      evidence: uncoveredChangedFiles.slice(0, 12),
      why: 'When receipts are committed with a PR, they should cover the SWD-generated files they are meant to verify.',
      recommendation: 'Regenerate receipts for the final set of Kelyra-generated changes, or keep receipts uncommitted if they are private/local only.',
    });
  }

  if (policy?.requireReceiptForCI && receiptFiles.length === 0 && changedFiles.length > 0) {
    findings.push({
      id: 'kelyra-receipt-required',
      severity: 'high',
      title: 'Kelyra receipt required by policy',
      evidence: changedFiles.map((file) => normalized(file.path)).slice(0, 12),
      why: 'Project policy requires PR changes to include a Kelyra receipt attesting to the AI-assisted file actions.',
      recommendation: 'Run the change through SWD and commit the generated receipt, or disable requireReceiptForCI for this repository.',
    });
  }

  return {
    checked: receiptFiles.length > 0,
    changedReceiptCount: receiptFiles.length,
    validReceiptCount,
    coveredChangedFileCount: changedNonReceiptFiles.length - uncoveredChangedFiles.length,
    uncoveredChangedFiles,
    findings,
  };
}
