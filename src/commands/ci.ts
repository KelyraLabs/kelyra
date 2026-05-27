import { runCIVerification } from '../ci/verify.js';
import { printCIVerifyReport } from '../ci/report.js';
import { c, error, heading, hr, info, success, warn, theme } from '../utils.js';
import type { CIVerifyReport } from '../ci/types.js';

interface CIOptions {
  base?: string;
  strict?: boolean;
  json?: boolean;
}

function explainMode(report: CIVerifyReport): string {
  if (report.mode === 'kelyra-receipts') {
    return `Kelyra checked ${report.receipt.changedReceiptCount} changed receipt(s), ` +
      `${report.receipt.validReceiptCount} valid, covering ${report.receipt.coveredChangedFileCount} changed file(s).`;
  }
  return 'Kelyra found no changed receipts in this diff, so it used generic PR risk review.';
}

function printCIExplanation(report: CIVerifyReport): void {
  console.log(heading('Kelyra CI Explain'));
  console.log(`  ${c.dim}Diff:${c.reset}     ${report.diff.range ?? report.diff.mode}`);
  console.log(`  ${c.dim}Changed:${c.reset}  ${report.diff.changedFileCount} file(s)`);
  console.log(`  ${c.dim}Mode:${c.reset}     ${report.mode}`);
  console.log(`  ${c.dim}Risk:${c.reset}     ${report.summary.risk.toUpperCase()}`);
  console.log(`  ${c.dim}Result:${c.reset}   ${report.summary.exitCode === 0 ? `${theme.success}pass${c.reset}` : `${theme.error}fail${c.reset}`}`);
  console.log();
  info(explainMode(report));
  console.log(hr());

  if (report.findings.length === 0) {
    success('No high-impact findings. This diff is clean under the current policy.');
  } else {
    console.log(`${c.bold}Why this result happened:${c.reset}\n`);
    for (const finding of report.findings.slice(0, 8)) {
      const label = finding.severity === 'high'
        ? `${theme.error}HIGH${c.reset}`
        : finding.severity === 'warn'
          ? `${theme.warning}WARN${c.reset}`
          : `${theme.info}INFO${c.reset}`;
      console.log(`  ${label} ${c.bold}${finding.title}${c.reset}`);
      if (finding.file) console.log(`       ${c.dim}${finding.file}${c.reset}`);
      console.log(`       Why: ${finding.why}`);
      console.log(`       Fix: ${finding.recommendation}`);
      console.log();
    }
    if (report.findings.length > 8) {
      info(`Showing 8 of ${report.findings.length} finding(s). Run kelyra verify --ci for the full report.`);
    }
  }

  console.log(hr());
  if (report.summary.exitCode === 0) {
    success('CI would pass with the current options.');
  } else if (report.summary.high > 0) {
    error('CI would fail because high-severity findings are present.');
  } else {
    warn('CI would fail because --strict treats warnings as failures.');
  }
}

export async function ciCommand(action = 'explain', options: CIOptions = {}): Promise<void> {
  const normalizedAction = action.toLowerCase();

  try {
    const report = runCIVerification({
      base: options.base,
      strict: options.strict === true,
    });

    if (normalizedAction === 'verify') {
      printCIVerifyReport(report, options.json === true);
      process.exitCode = report.summary.exitCode;
      return;
    }

    if (normalizedAction === 'explain') {
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printCIExplanation(report);
      }
      process.exitCode = report.summary.exitCode;
      return;
    }

    error(`Unknown ci action: ${normalizedAction}`);
    info('Usage: kelyra ci explain | kelyra ci verify');
    process.exitCode = 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.log(JSON.stringify({ tool: 'kelyra-ci', error: message, exitCode: 2 }, null, 2));
    } else {
      error(message);
    }
    process.exitCode = 2;
  }
}
