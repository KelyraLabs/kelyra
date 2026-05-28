import { c } from '../utils.js';

interface ConsoleOptions {}

export async function consoleCommand(options: ConsoleOptions = {}): Promise<void> {
  void options;
  const consoleUrl = 'https://console.kelyralabs.com/';
  const docsUrl = 'https://docs.kelyralabs.com/';
  const apiUrl = process.env.KELYRA_API_URL || 'https://api.kelyralabs.com';

  console.log(`${c.cyan}${c.bold}Kelyra Console${c.reset}`);
  console.log(`${c.dim}The console UI is hosted separately from the CLI package.${c.reset}`);
  console.log(`${c.dim}Console:${c.reset} ${c.cyan}${consoleUrl}${c.reset}`);
  console.log(`${c.dim}Docs:${c.reset}    ${c.cyan}${docsUrl}${c.reset}`);
  console.log(`${c.dim}API:${c.reset}     ${c.cyan}${apiUrl}${c.reset}`);
  console.log('');
}
