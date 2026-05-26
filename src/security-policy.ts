import type { FileAction } from './swd.js';
import {
  anyPolicyPatternMatches,
  loadPolicy,
  normalizePolicyPath,
  type KelyraPolicy,
} from './policy.js';

export type ActionRisk = 'safe' | 'confirm' | 'block';

export interface ActionRiskVerdict {
  risk: ActionRisk;
  reason: string;
}

export interface PolicyReview {
  approved: FileAction[];
  blocked: Array<{ action: FileAction; verdict: ActionRiskVerdict }>;
  needsConfirmation: Array<{ action: FileAction; verdict: ActionRiskVerdict }>;
}

const BLOCKED_PATTERNS: RegExp[] = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.git(?:\/|$)/i,
  /^\.ssh(?:\/|$)/i,
  /(?:^|\/)id_rsa$/i,
  /(?:^|\/)id_ed25519$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /(?:^|\/)wallet\.dat$/i,
  /(?:^|\/)seed(?:s|_phrase)?\.txt$/i,
  /(?:^|\/)secrets?(?:\.|\/|$)/i,
];

const CONFIRM_PATTERNS: RegExp[] = [
  /^package\.json$/i,
  /^package-lock\.json$/i,
  /^npm-shrinkwrap\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^yarn\.lock$/i,
  /^bun\.lockb$/i,
  /^scripts\//i,
  /^\.github\/workflows\//i,
  /^Dockerfile$/i,
  /^docker-compose\.ya?ml$/i,
  /\.(?:sh|bash|zsh|fish|ps1|bat|cmd)$/i,
  /(?:^|\/)(?:vite|webpack|rollup|eslint|tsup|jest|vitest|babel|next|nuxt|svelte|astro)\.config\./i,
];

const COMMAND_SURFACE_PATTERNS: RegExp[] = [
  ...CONFIRM_PATTERNS,
  /^Makefile$/i,
  /^justfile$/i,
  /^\.husky\//i,
  /^\.vscode\/tasks\.json$/i,
];

export function normalizeActionPath(filePath: string): string {
  return normalizePolicyPath(filePath);
}

export function classifyActionRisk(action: FileAction, policy: KelyraPolicy = loadPolicy().policy): ActionRiskVerdict {
  const normalizedPath = normalizeActionPath(action.path);

  if (anyPolicyPatternMatches(policy.blockedPaths, normalizedPath)) {
    return {
      risk: 'block',
      reason: `Blocked by project policy: ${action.path}`,
    };
  }

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return {
      risk: 'block',
      reason: `Sensitive file is blocked by default: ${action.path}`,
    };
  }

  if (action.operation === 'DELETE') {
    return {
      risk: 'confirm',
      reason: `Delete operation requires human confirmation: ${action.path}`,
    };
  }

  if (anyPolicyPatternMatches(policy.confirmPaths, normalizedPath)) {
    return {
      risk: 'confirm',
      reason: `Project policy requires confirmation: ${action.path}`,
    };
  }

  if (CONFIRM_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return {
      risk: 'confirm',
      reason: `High-impact file requires human confirmation: ${action.path}`,
    };
  }

  return {
    risk: 'safe',
    reason: `Safe project file: ${action.path}`,
  };
}

export function reviewActions(actions: FileAction[], policy: KelyraPolicy = loadPolicy().policy): PolicyReview {
  const approved: FileAction[] = [];
  const blocked: PolicyReview['blocked'] = [];
  const needsConfirmation: PolicyReview['needsConfirmation'] = [];

  for (const action of actions) {
    const verdict = classifyActionRisk(action, policy);
    if (verdict.risk === 'block') {
      blocked.push({ action, verdict });
    } else if (verdict.risk === 'confirm') {
      needsConfirmation.push({ action, verdict });
    } else {
      approved.push(action);
    }
  }

  return { approved, blocked, needsConfirmation };
}

export function touchesCommandSurface(actions: FileAction[], policy: KelyraPolicy = loadPolicy().policy): boolean {
  return actions.some((action) => {
    const normalizedPath = normalizeActionPath(action.path);
    return (
      COMMAND_SURFACE_PATTERNS.some((pattern) => pattern.test(normalizedPath)) ||
      anyPolicyPatternMatches(policy.requireTestsForPaths, normalizedPath)
    );
  });
}

export function touchedWritablePaths(actions: FileAction[]): string[] {
  return actions
    .filter((action) => action.operation !== 'READ')
    .map((action) => normalizeActionPath(action.path));
}
