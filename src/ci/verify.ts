import { getDiffInfo } from './git.js';
import { analyzeChangedFiles } from './rules.js';
import { reviewChangedReceiptsWithPolicy } from './receipts.js';
import { sortFindings, summarizeFindings } from './report.js';
import { loadPolicy } from '../policy.js';
import type { CIVerifyOptions, CIVerifyReport } from './types.js';

export function runCIVerification(options: CIVerifyOptions = {}): CIVerifyReport {
  const cwd = options.cwd ?? process.cwd();
  const strict = options.strict === true;
  const diff = getDiffInfo(cwd, options.base);
  const policyResult = loadPolicy(cwd);
  const receiptReview = reviewChangedReceiptsWithPolicy(cwd, diff.changedFiles, policyResult.policy);
  const findings = sortFindings([
    ...receiptReview.findings,
    ...analyzeChangedFiles(diff),
    ...policyResult.warnings.map((warning) => ({
      id: 'kelyra-policy-warning',
      severity: 'warn' as const,
      title: 'Kelyra policy warning',
      file: '.kelyra/policy.json',
      evidence: [warning],
      why: 'Invalid or partially ignored policy configuration can weaken local and CI enforcement.',
      recommendation: 'Fix `.kelyra/policy.json` so all configured controls are applied as intended.',
    })),
  ]);
  const summary = summarizeFindings(findings, strict);

  return {
    tool: 'kelyra-verify-ci',
    version: 1,
    mode: receiptReview.checked ? 'kelyra-receipts' : 'generic',
    cwd,
    diff: {
      mode: diff.mode,
      baseRef: diff.baseRef,
      range: diff.range,
      changedFileCount: diff.changedFiles.length,
    },
    changedFiles: diff.changedFiles,
    receipt: {
      checked: receiptReview.checked,
      changedReceiptCount: receiptReview.changedReceiptCount,
      validReceiptCount: receiptReview.validReceiptCount,
      coveredChangedFileCount: receiptReview.coveredChangedFileCount,
      uncoveredChangedFiles: receiptReview.uncoveredChangedFiles,
    },
    findings,
    summary,
  };
}
