// ─────────────────────────────────────────────────────────────
//  kelyra :: index.ts
//  Public API / SDK Exports
// ─────────────────────────────────────────────────────────────

// Export the client facade
export { getClient, getOrchestrator, streamMessage, sendMessage, formatTokenUsage, type Message, type KelyraResponse } from './client.js';

// Export the Provider Orchestration Engine
export { ProviderOrchestrator } from './providers/orchestrator.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { calculateCost, getModelPricing, hasKnownPricing } from './providers/pricing.js';
export {
  type BaseProvider,
  type UnifiedChunk,
  type UnifiedResponse,
  type UnifiedToolCall,
  type RequestOptions,
  type StreamOptions,
  type SendOptions,
  type ProviderConfig,
  type ProviderCapability,
  type ProviderStatus,
  type OrchestrationEvent,
} from './providers/types.js';

// Export the Strict Write Discipline Engine (v1 API — Pure Kernel)
export {
  SWDEngine,
  parseActions,
  snapshotFile,
  resolveSafePath,
  summarizeActions,
  type FileAction,
  type ActionIntent,
  type ActionResult,
  type VerificationStatus,
  type SWDRunResult,
  type SWDOptions,
  type TextPatch,
  type FileSnapshot,
  type FileSnapshotSummary,
} from './swd.js';

// Export the SWD CLI Presentation Layer
export { printSWDResults, dryRunSWD, printVerboseParse } from './swd-cli.js';

// Export the Self-Healing Memory
export { readMemory, writeCompressedMemory, initMemory, appendEntry, needsDream, getMemoryContext, type MemoryEntry } from './memory.js';

// Export the Deterministic Cache
export { ResponseCache, generateCacheKey, type CacheKeyInput } from './cache.js';

// Export Skill Pack helpers
export {
  loadSkill,
  listSkills,
  validateSkill,
  validateSkills,
  parseSkillContent,
  checkSkills,
  createSkill,
  buildSkillPrompt,
  ensureSkillsDir,
  getProjectSkillsDir,
  getGlobalSkillsDir,
  getOfficialSkillsDir,
  getSkillsDir,
  type Skill,
  type SkillMeta,
  type SkillScope,
  type SkillValidation,
  type ParseSkillContentOptions,
  type SkillListEntry,
  type SkillCheckIssue,
  type SkillCheckResult,
  type CreateSkillOptions,
} from './skills.js';

// Export Repo Learning helpers
export {
  analyzeRepo,
  learnRepoSkill,
  type RepoLearningProfile,
  type LearnRepoSkillOptions,
  type LearnRepoSkillResult,
} from './learn.js';

// Export SWD Receipts
export {
  createSWDReceipt,
  saveSWDReceipt,
  listReceipts,
  readReceipt,
  verifyReceipt,
  verifyReceiptChain,
  verifyReceiptIntegrity,
  verifyReceiptSignature,
  createReceiptSigningKeyPair,
  signReceipt,
  getReceiptsDir,
  type SWDReceipt,
  type SWDReceiptInput,
  type ReceiptSummary,
  type ReceiptProvider,
  type ReceiptUsage,
  type ReceiptBudget,
  type ReceiptSkill,
  type ReceiptTestStatus,
  type ReceiptTestResult,
  type ReceiptFileResult,
  type ReceiptSnapshot,
  type ReceiptVerification,
  type ReceiptFileVerification,
  type ReceiptSignature,
  type ReceiptSigningKeyPair,
  type ReceiptChainLink,
  type ReceiptChainVerification,
} from './receipts.js';

export {
  POLICY_PATH,
  DEFAULT_POLICY,
  loadPolicy,
  isTestCommandAllowed,
  policyPatternMatches,
  type KelyraPolicy,
  type PolicyLoadResult,
} from './policy.js';

export {
  POLICY_TEMPLATES,
  getPolicyTemplate,
  listPolicyTemplateNames,
  type PolicyTemplateName,
} from './policy-templates.js';

export {
  AGENT_MANIFEST_PATH,
  loadAgentManifest,
  type AgentManifest,
  type AgentManifestLoadResult,
} from './agent-manifest.js';

export {
  createProofBundle,
  exportProofBundle,
  type ProofBundle,
  type ProofExportResult,
} from './proof.js';

// Export the Budget Limiter
export { SessionBudget, type BudgetConfig, type BudgetCheck, type BudgetSnapshot } from './budget.js';

// Export Core Config & Models
export { MODELS, KELYRA_SYSTEM_PROMPT, getEffort, validateApiKey, validateProviderKeys, type EffortLevel } from './config.js';

// Export the Chat UI Interface (for custom frontends)
export { type ChatUI } from './commands/chat.js';

export { parseExternalAgentInput, applyExternalAgentActions, type ExternalAgentInput, type SWDApplyResult } from './commands/swd.js';

// Export the MCP adapter for embedded hosts and tests
export {
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  handleMCPMessage,
  runMCPServer,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
  type JsonRpcErrorResponse,
} from './mcp.js';
