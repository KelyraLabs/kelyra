import { createProofBundle, exportProofBundle } from '../proof.js';
import { error, heading, info, success, warn } from '../utils.js';

interface ProofOptions {
  json?: boolean;
  out?: string;
}

export async function proofCommand(action = 'export', target = 'latest', options: ProofOptions = {}): Promise<void> {
  const normalizedAction = action.toLowerCase();

  try {
    if (normalizedAction === 'show') {
      const bundle = createProofBundle(target);
      if (options.json) {
        console.log(JSON.stringify(bundle, null, 2));
        return;
      }

      console.log(heading(`Proof ${bundle.receipt.id}`));
      info(`Files: ${bundle.verification.filesOk ? 'ok' : 'drift'}`);
      info(`Integrity: ${bundle.verification.integrityOk ? 'ok' : 'failed'}`);
      info(`Signature: ${bundle.verification.signatureOk === null ? 'unsigned' : bundle.verification.signatureOk ? 'ok' : 'failed'}`);
      info(`Chain: ${bundle.verification.chainOk ? 'ok' : 'broken'}`);
      if (!bundle.verification.filesOk || !bundle.verification.integrityOk || bundle.verification.signatureOk === false) {
        warn('Proof contains verification issues.');
      }
      return;
    }

    if (normalizedAction === 'export') {
      const result = exportProofBundle(target, options.out);
      if (options.json) {
        console.log(JSON.stringify({
          ok: result.ok,
          path: result.path,
          receiptId: result.bundle.receipt.id,
          verification: result.bundle.verification,
        }, null, 2));
        return;
      }

      success(`Exported proof bundle: ${result.path}`);
      if (!result.ok) warn('Proof exported with verification issues.');
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exitCode = 1;
    return;
  }

  error(`Unknown proof action: ${normalizedAction}`);
  info('Usage: kelyra proof export latest | kelyra proof show latest');
  process.exitCode = 1;
}
