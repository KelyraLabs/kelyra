import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { applyExternalAgentActions } from './commands/swd.js';
import { exportProofBundle } from './proof.js';
import { loadPolicy } from './policy.js';
import {
  listReceipts,
  readReceipt,
  saveSWDReceipt,
  signReceipt,
  verifyReceipt,
  verifyReceiptIntegrity,
  verifyReceiptSignature,
} from './receipts.js';
import {
  checkSkills,
  getGlobalSkillsDir,
  getProjectSkillsDir,
  listSkills,
} from './skills.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface MCPTool {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

const textInputSchema: Record<string, Record<string, unknown>> = {
  input: {
    type: 'string',
    description: 'Raw JSON action envelope, JSON action array, or FILE_ACTION text from an external agent.',
  },
  actions: {
    type: 'array',
    description: 'Structured file actions. Used when input is not provided.',
    items: { type: 'object' },
  },
  request: {
    type: 'string',
    description: 'Optional receipt request label.',
  },
  summary: {
    type: 'string',
    description: 'Optional receipt summary override.',
  },
  agentId: {
    type: 'string',
    description: 'External agent identifier recorded in receipts.',
  },
  modelId: {
    type: 'string',
    description: 'External model identifier recorded in receipts.',
  },
  metadata: {
    type: 'object',
    description: 'Optional external-agent metadata included in the input envelope.',
  },
};

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'swd_dry_run',
    title: 'Preview external-agent file actions through SWD',
    description:
      'Validates external-agent file actions through Kelyra Strict Write Discipline without writing files or receipts. Use before swd_apply.',
    inputSchema: {
      type: 'object',
      properties: {
        ...textInputSchema,
        allowRisky: {
          type: 'boolean',
          description: 'Preview high-impact command-surface actions that normally require explicit opt-in. Sensitive files remain blocked.',
        },
      },
    },
    annotations: {
      title: 'SWD dry-run',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swd_apply',
    title: 'Apply external-agent file actions through SWD',
    description:
      'Applies external-agent file actions through Kelyra Strict Write Discipline, verifies filesystem state, rolls back failed verification, and writes receipts by default.',
    inputSchema: {
      type: 'object',
      properties: {
        ...textInputSchema,
        dryRun: {
          type: 'boolean',
          description: 'If true, preview the plan without writing files or receipts.',
        },
        allowRisky: {
          type: 'boolean',
          description: 'Allow high-impact command-surface actions and deletes. Sensitive files remain blocked.',
        },
        saveReceipt: {
          type: 'boolean',
          description: 'Write a local SWD receipt for successful non-dry-run applies. Defaults to true.',
        },
        rollback: {
          type: 'boolean',
          description: 'Roll back writes when SWD verification fails. Defaults to true.',
        },
      },
    },
    annotations: {
      title: 'SWD apply',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'receipts_list',
    title: 'List SWD receipts',
    description: 'List recent local SWD receipts for the current repository.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of receipts to return. Defaults to 10, capped at 100.',
        },
      },
    },
    annotations: {
      title: 'List receipts',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'receipts_show',
    title: 'Show an SWD receipt',
    description: 'Read a local SWD receipt by id, file path, or latest.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Receipt id, receipt JSON path, or latest. Defaults to latest.',
        },
      },
    },
    annotations: {
      title: 'Show receipt',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'receipts_verify',
    title: 'Verify an SWD receipt',
    description: 'Verify current filesystem state and receipt integrity against a local SWD receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Receipt id, receipt JSON path, or latest. Defaults to latest.',
        },
      },
    },
    annotations: {
      title: 'Verify receipt',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'receipt_sign',
    title: 'Sign an SWD receipt',
    description: 'Sign a local SWD receipt with an Ed25519 private key and save the signed receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Receipt id, receipt JSON path, or latest. Defaults to latest.',
        },
        keyPath: {
          type: 'string',
          description: 'Private Ed25519 key path. Defaults to ~/.kelyra/receipt-ed25519-private.pem.',
        },
      },
    },
    annotations: {
      title: 'Sign receipt',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'proof_export',
    title: 'Export an SWD proof bundle',
    description: 'Export receipt, policy, agent manifest, signature status, chain status, and git diff metadata as a proof bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Receipt id or latest. Defaults to latest.',
        },
        outDir: {
          type: 'string',
          description: 'Output directory for proof.json.',
        },
      },
    },
    annotations: {
      title: 'Export proof',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'policy_check',
    title: 'Check project policy',
    description: 'Load and validate .kelyra/policy.json for the current repository.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'Check policy',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'trusted_keys_list',
    title: 'List trusted receipt signer keys',
    description: 'Return trusted receipt key ids configured in project policy.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'List trusted keys',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'patch_apply',
    title: 'Apply text patches through SWD',
    description: 'Shortcut for applying PATCH actions with oldText/newText replacements through SWD.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'PATCH actions with path and patch/patches oldText/newText entries.',
          items: { type: 'object' },
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview patches without writing files or receipts.',
        },
        allowRisky: {
          type: 'boolean',
          description: 'Allow high-impact command-surface actions. Sensitive files remain blocked.',
        },
      },
      required: ['actions'],
    },
    annotations: {
      title: 'Apply patches',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'skills_list',
    title: 'List Kelyra skills',
    description: 'List project-local and user-global Kelyra SKILL.md packs visible to this repository.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'List skills',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'skills_check',
    title: 'Validate Kelyra skills',
    description: 'Validate all discovered skills or one named skill/path without writing files.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional skill name or path to validate. If omitted, all discovered skills are checked.',
        },
      },
    },
    annotations: {
      title: 'Check skills',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  swd_dry_run: async (args) => {
    const rawInput = externalAgentInputFromArgs(args);
    const output = await applyExternalAgentActions({
      rawInput,
      dryRun: true,
      saveReceipt: false,
      allowRisky: optionalBoolean(args.allowRisky, 'allowRisky') ?? false,
      request: optionalString(args.request, 'request'),
      summary: optionalString(args.summary, 'summary'),
      agentId: optionalString(args.agentId, 'agentId'),
      modelId: optionalString(args.modelId, 'modelId'),
    });
    return toolResult(output, !output.ok);
  },

  swd_apply: async (args) => {
    const rawInput = externalAgentInputFromArgs(args);
    const dryRun = optionalBoolean(args.dryRun, 'dryRun') ?? false;
    const output = await applyExternalAgentActions({
      rawInput,
      dryRun,
      saveReceipt: dryRun ? false : optionalBoolean(args.saveReceipt, 'saveReceipt') ?? true,
      allowRisky: optionalBoolean(args.allowRisky, 'allowRisky') ?? false,
      enableRollback: optionalBoolean(args.rollback, 'rollback') ?? true,
      request: optionalString(args.request, 'request'),
      summary: optionalString(args.summary, 'summary'),
      agentId: optionalString(args.agentId, 'agentId'),
      modelId: optionalString(args.modelId, 'modelId'),
    });
    return toolResult(output, !output.ok);
  },

  receipts_list: (args) => {
    const limit = boundedLimit(args.limit);
    return toolResult({
      ok: true,
      receipts: listReceipts(limit),
    });
  },

  receipts_show: (args) => {
    const target = optionalString(args.target, 'target') ?? 'latest';
    const receipt = readReceipt(target);
    if (!receipt) {
      return toolError(`Receipt not found: ${target}`, { target });
    }
    return toolResult({ ok: true, receipt });
  },

  receipts_verify: (args) => {
    const target = optionalString(args.target, 'target') ?? 'latest';
    const receipt = readReceipt(target);
    if (!receipt) {
      return toolError(`Receipt not found: ${target}`, { target });
    }
    const verification = verifyReceipt(receipt);
    const integrityOk = verifyReceiptIntegrity(receipt);
    const signatureOk = verifyReceiptSignature(receipt);
    return toolResult({
      ok: verification.ok && integrityOk && signatureOk !== false,
      receiptId: receipt.id,
      verification,
      integrityOk,
      signatureOk,
    }, !(verification.ok && integrityOk && signatureOk !== false));
  },

  receipt_sign: (args) => {
    const target = optionalString(args.target, 'target') ?? 'latest';
    const receipt = readReceipt(target);
    if (!receipt) return toolError(`Receipt not found: ${target}`, { target });
    const keyPath = resolveKeyPath(optionalString(args.keyPath, 'keyPath'));
    const signed = signReceipt(receipt, readFileSync(keyPath, 'utf-8'));
    const savedPath = saveSWDReceipt(signed);
    return toolResult({
      ok: verifyReceiptSignature(signed) === true,
      receiptId: signed.id,
      receiptPath: savedPath,
      keyId: signed.integrity?.signature?.keyId,
    });
  },

  proof_export: (args) => {
    const target = optionalString(args.target, 'target') ?? 'latest';
    const outDir = optionalString(args.outDir, 'outDir');
    const result = exportProofBundle(target, outDir);
    return toolResult({
      ok: result.ok,
      path: result.path,
      receiptId: result.bundle.receipt.id,
      verification: result.bundle.verification,
    }, !result.ok);
  },

  policy_check: () => {
    const result = loadPolicy();
    return toolResult({
      ok: result.warnings.length === 0,
      found: result.found,
      path: result.path,
      policy: result.policy,
      warnings: result.warnings,
    }, result.warnings.length > 0);
  },

  trusted_keys_list: () => {
    const result = loadPolicy();
    return toolResult({
      ok: result.warnings.length === 0,
      trustedReceiptKeyIds: result.policy.trustedReceiptKeyIds,
      warnings: result.warnings,
    }, result.warnings.length > 0);
  },

  patch_apply: async (args) => {
    if (!Array.isArray(args.actions)) {
      return toolError('actions must be an array.');
    }
    const actions = args.actions.map((action) => ({
      ...(isRecord(action) ? action : {}),
      operation: 'PATCH',
    }));
    const output = await applyExternalAgentActions({
      rawInput: JSON.stringify({ actions }),
      dryRun: optionalBoolean(args.dryRun, 'dryRun') ?? false,
      allowRisky: optionalBoolean(args.allowRisky, 'allowRisky') ?? false,
      request: optionalString(args.request, 'request'),
      summary: optionalString(args.summary, 'summary'),
      agentId: optionalString(args.agentId, 'agentId'),
      modelId: optionalString(args.modelId, 'modelId'),
    });
    return toolResult(output, !output.ok);
  },

  skills_list: () => toolResult({
    ok: true,
    projectDir: getProjectSkillsDir(),
    globalDir: getGlobalSkillsDir(),
    skills: listSkills(),
  }),

  skills_check: (args) => {
    const name = optionalString(args.name, 'name');
    const result = checkSkills(name);
    return toolResult({ ok: result.ok, result }, !result.ok);
  },
};

export async function handleMCPMessage(message: unknown): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || Array.isArray(message)) {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request.');
  }

  if (message.jsonrpc !== '2.0') {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC version.');
  }

  const requestId = message.id;
  if (requestId !== undefined && !isJsonRpcRequestId(requestId)) {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC id.');
  }

  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: message.method,
    ...(requestId !== undefined ? { id: requestId } : {}),
    ...(message.params !== undefined ? { params: message.params } : {}),
  };
  const method = request.method;
  const id = request.id ?? null;

  if (typeof method !== 'string') {
    return id === null ? null : jsonRpcError(id, -32600, 'Invalid JSON-RPC request.');
  }

  if (request.id === undefined) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize':
        return jsonRpcResult(id, initializeResult(request.params));
      case 'ping':
        return jsonRpcResult(id, {});
      case 'tools/list':
        return jsonRpcResult(id, { tools: MCP_TOOLS });
      case 'tools/call':
        return jsonRpcResult(id, await callTool(request.params));
      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32602, message);
  }
}

export async function runMCPServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  errorOutput: Writable = process.stderr,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity, terminal: false });

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      await writeJsonRpc(output, jsonRpcError(null, -32700, 'Parse error.', {
        detail: err instanceof Error ? err.message : String(err),
      }));
      continue;
    }

    try {
      const response = await handleMCPMessage(parsed);
      if (response) await writeJsonRpc(output, response);
    } catch (err) {
      const detail = err instanceof Error ? err.stack ?? err.message : String(err);
      errorOutput.write(`[kelyra mcp] ${detail}\n`);
      await writeJsonRpc(output, jsonRpcError(null, -32603, 'Internal MCP server error.'));
    }
  }
}

function initializeResult(params: unknown): Record<string, unknown> {
  const requestedVersion = isRecord(params) && typeof params.protocolVersion === 'string'
    ? params.protocolVersion
    : undefined;
  const protocolVersion = requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion as typeof SUPPORTED_PROTOCOL_VERSIONS[number])
    ? requestedVersion
    : MCP_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: 'kelyra',
      title: 'Kelyra',
      version: packageVersion(),
    },
    instructions:
      'Kelyra exposes model-free Strict Write Discipline tools. Use swd_dry_run before swd_apply when possible; sensitive paths remain blocked by default.',
  };
}

async function callTool(params: unknown): Promise<ToolResult> {
  if (!isRecord(params) || typeof params.name !== 'string') {
    throw new Error('tools/call requires params.name.');
  }

  const handler = TOOL_HANDLERS[params.name];
  if (!handler) {
    throw new Error(`Unknown tool: ${params.name}`);
  }

  const toolArgs = isRecord(params.arguments) ? params.arguments : {};
  try {
    return await handler(toolArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}

function externalAgentInputFromArgs(args: Record<string, unknown>): string {
  const directInput = optionalString(args.input, 'input');
  if (directInput !== undefined) return directInput;

  if (!Array.isArray(args.actions)) {
    throw new Error('Provide either input (string) or actions (array).');
  }

  return JSON.stringify({
    request: optionalString(args.request, 'request'),
    summary: optionalString(args.summary, 'summary'),
    agent: {
      id: optionalString(args.agentId, 'agentId'),
      model: optionalString(args.modelId, 'modelId'),
    },
    metadata: optionalRecord(args.metadata, 'metadata'),
    actions: args.actions,
  });
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function optionalRecord(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function boundedLimit(value: unknown): number {
  if (value === undefined || value === null) return 10;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('limit must be a finite number.');
  }
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function resolveKeyPath(rawPath: string | undefined): string {
  const defaultPath = join(homedir(), '.kelyra', 'receipt-ed25519-private.pem');
  if (!rawPath) return defaultPath;
  if (rawPath === '~') return homedir();
  if (rawPath.startsWith('~/')) return join(homedir(), rawPath.slice(2));
  return resolve(rawPath);
}

function toolResult(value: object, isError = false): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value as Record<string, unknown>,
    isError,
  };
}

function toolError(message: string, data?: Record<string, unknown>): ToolResult {
  return toolResult({ ok: false, error: message, ...(data ? { data } : {}) }, true);
}

function jsonRpcResult(id: JsonRpcId, result: object): JsonRpcSuccessResponse {
  return { jsonrpc: '2.0', id, result: result as Record<string, unknown> };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcRequestId(value: unknown): value is Exclude<JsonRpcId, null> {
  return typeof value === 'string' || typeof value === 'number';
}

function writeJsonRpc(output: Writable, message: JsonRpcResponse): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const payload = `${JSON.stringify(message)}\n`;
    const onError = (err: Error) => {
      output.off('drain', onDrain);
      reject(err);
    };
    const onDrain = () => {
      output.off('error', onError);
      resolvePromise();
    };

    output.once('error', onError);
    if (output.write(payload, 'utf-8')) {
      output.off('error', onError);
      resolvePromise();
    } else {
      output.once('drain', onDrain);
    }
  });
}

function packageVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(dir, '..', 'package.json'), 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
