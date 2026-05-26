// ─────────────────────────────────────────────────────────────
//  kelyra :: client.ts
//  Provider facade over the Provider Orchestrator
//
//  Chat, one-shot runs, and SDK callers use this facade for retry,
//  fallback, and provider scoring.
// ─────────────────────────────────────────────────────────────

import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { ProviderOrchestrator } from './providers/orchestrator.js';
import type { UnifiedResponse } from './providers/types.js';
import {
  KELYRA_SYSTEM_PROMPT,
  MODELS,
  PROVIDER_DEFAULT_MODELS,
  validateApiKey,
  validateProviderKeys,
  MAX_OUTPUT_TOKENS_STREAM,
  MAX_OUTPUT_TOKENS_SEND,
  type EffortLevel,
} from './config.js';
import { c, theme } from './utils.js';

// ── Re-export Message ────────────────────────────────────────
export type { Message } from './providers/types.js';

// ── Legacy Response Type (backward-compatible) ───────────────
export interface KelyraResponse {
  thinking: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider metadata */
  _orchestration?: {
    providerId: string;
    modelId: string;
    fallbackTriggered: boolean;
    incomplete: boolean;
    latencyMs: number;
  };
}

// ── Singleton Orchestrator ───────────────────────────────────
let _orchestrator: ProviderOrchestrator | null = null;

export function getOrchestrator(): ProviderOrchestrator {
  if (!_orchestrator) {
    const providers = validateProviderKeys();
    _orchestrator = new ProviderOrchestrator();

    // Preferred default: Anthropic/Claude when configured.
    if (providers.anthropic) {
      _orchestrator.registerProvider(
        new AnthropicProvider(providers.anthropic),
        { priority: 0 },
      );
    }

    // BYOK: OpenAI can now be the only configured provider.
    if (providers.openai) {
      _orchestrator.registerProvider(
        new OpenAIProvider({
          id: 'openai',
          apiKey: providers.openai,
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: PROVIDER_DEFAULT_MODELS.openai,
        }),
        { priority: providers.anthropic ? 1 : 0 },
      );
    }

    // BYOK: DeepSeek can now be the only configured provider.
    if (providers.deepseek) {
      _orchestrator.registerProvider(
        new OpenAIProvider({
          id: 'deepseek',
          apiKey: providers.deepseek,
          baseUrl: 'https://api.deepseek.com/v1',
          defaultModel: PROVIDER_DEFAULT_MODELS.deepseek,
          supportsThinking: true,
        }),
        { priority: providers.anthropic || providers.openai ? 2 : 0 },
      );
    }
  }
  return _orchestrator;
}

// ── Legacy getClient() (for direct SDK access if needed) ─────
import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = validateApiKey();
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ── Convert UnifiedResponse → KelyraResponse ─────────────────
function toKelyraResponse(unified: UnifiedResponse): KelyraResponse {
  return {
    thinking: unified.thinking,
    text: unified.text,
    inputTokens: unified.usage.inputTokens,
    outputTokens: unified.usage.outputTokens,
    _orchestration: {
      providerId: unified.metadata.providerId,
      modelId: unified.metadata.modelId,
      fallbackTriggered: unified.metadata.fallbackTriggered,
      incomplete: unified.metadata.incomplete,
      latencyMs: unified.usage.latencyMs,
    },
  };
}

export async function streamMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
  effort: EffortLevel = 'high',
  onThinkingDelta?: (text: string) => void,
  onTextDelta?: (text: string) => void,
  maxTokensOverride?: number,
): Promise<KelyraResponse> {
  const orchestrator = getOrchestrator();

  const unified = await orchestrator.streamMessage(messages, {
    systemPrompt: KELYRA_SYSTEM_PROMPT,
    maxTokens: maxTokensOverride ?? MAX_OUTPUT_TOKENS_STREAM,
    effort,
    onThinkingDelta,
    onTextDelta,
  });

  return toKelyraResponse(unified);
}

export async function sendMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
  effort: EffortLevel = 'low',
  systemOverride?: string,
  maxTokensOverride?: number,
): Promise<KelyraResponse> {
  const orchestrator = getOrchestrator();

  const unified = await orchestrator.sendMessage(messages, {
    systemPrompt: systemOverride ?? KELYRA_SYSTEM_PROMPT,
    maxTokens: maxTokensOverride ?? MAX_OUTPUT_TOKENS_SEND,
    effort,
  });

  return toKelyraResponse(unified);
}

// ── Token cost display ───────────────────────────────────────
export function formatTokenUsage(resp: KelyraResponse): string {
  const total = resp.inputTokens + resp.outputTokens;
  const providerInfo = resp._orchestration
    ? ` ${theme.muted}via ${theme.info}${resp._orchestration.providerId}${theme.muted}/${resp._orchestration.modelId}${c.reset}`
    : '';
  const fallbackInfo = resp._orchestration?.fallbackTriggered
    ? ` ${theme.warning}(fallback)${c.reset}`
    : '';

  return (
    `${theme.muted}Tokens: ${theme.info}${resp.inputTokens.toLocaleString()}${theme.muted} in · ` +
    `${theme.info}${resp.outputTokens.toLocaleString()}${theme.muted} out · ` +
    `${theme.warning}${total.toLocaleString()}${theme.muted} total${c.reset}` +
    providerInfo + fallbackInfo
  );
}
