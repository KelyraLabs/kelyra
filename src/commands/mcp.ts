import { runMCPServer } from '../mcp.js';

export async function mcpCommand(): Promise<void> {
  await runMCPServer();
}
