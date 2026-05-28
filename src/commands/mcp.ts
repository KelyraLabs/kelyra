import { runMCPServer } from '../mcp.js';
import { c, error, heading, info } from '../utils.js';

interface McpOptions {
  json?: boolean;
  command?: string;
}

type McpClient = 'generic' | 'claude' | 'cursor';

export function buildMCPConfig(command = 'kelyra'): { mcpServers: Record<string, { command: string; args: string[] }> } {
  return {
    mcpServers: {
      kelyra: {
        command,
        args: ['mcp'],
      },
    },
  };
}

export async function mcpCommand(action = 'server', client: McpClient = 'generic', options: McpOptions = {}): Promise<void> {
  const normalizedAction = action.toLowerCase();

  if (normalizedAction === 'server') {
    await runMCPServer();
    return;
  }

  if (normalizedAction === 'config') {
    const config = buildMCPConfig(options.command || 'kelyra');
    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    console.log(heading(`MCP Config: ${client}`));
    info(`Paste this into your MCP-compatible client config. Command: ${options.command || 'kelyra'}`);
    console.log();
    console.log(`${c.dim}${JSON.stringify(config, null, 2)}${c.reset}`);
    return;
  }

  error(`Unknown mcp action: ${normalizedAction}`);
  info('Usage: kelyra mcp | kelyra mcp config [generic|claude|cursor] --json');
  process.exitCode = 1;
}
