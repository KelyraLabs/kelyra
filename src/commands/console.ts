import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { c, error as logError } from '../utils.js';

interface ConsoleOptions {
  host?: string;
  port?: string;
}

export async function consoleCommand(options: ConsoleOptions = {}): Promise<void> {
  const serverPath = fileURLToPath(new URL('../../site/server.mjs', import.meta.url));

  if (!existsSync(serverPath)) {
    logError('Kelyra Console assets are missing from this install.');
    process.exitCode = 1;
    return;
  }

  const host = options.host || '127.0.0.1';
  const port = options.port || '4340';
  const url = `http://${host}:${port}/console`;

  console.log(`${c.cyan}${c.bold}Kelyra Console${c.reset}`);
  console.log(`${c.dim}Local proof runtime for SWD receipts and proof bundles.${c.reset}`);
  console.log(`${c.dim}Workspace:${c.reset} ${process.cwd()}`);
  console.log(`${c.dim}URL:${c.reset}       ${c.cyan}${url}${c.reset}`);
  console.log('');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        HOST: host,
        PORT: port,
        KELYRA_CONSOLE_CWD: process.cwd(),
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code && code !== 0) {
        reject(new Error(`Kelyra Console exited with code ${code}.`));
        return;
      }
      resolve();
    });
  });
}
