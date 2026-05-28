---
name: token-launch
version: 0.1.0
description: Product and safety rules for token-gated launches, quotas, holder tiers, and public access.
priority: 70
budget-multiplier: 1.0
allow-fallback: true
---

# token-launch Skill

## Purpose
Use this skill when work touches token-gated access, holder tiers, quotas, launch copy, wallet login, public preview behavior, or token-related docs.

## Read First
- tier configuration
- wallet auth code
- quota code
- public docs and landing copy
- console auth and disabled-state UI

## Rules
- Keep the CLI open and usable unless the task explicitly changes access policy.
- Make token-gated features explicit only where gating applies.
- Do not imply investment advice, guaranteed value, returns, or financial outcomes.
- Wallet login must request the minimum permission needed and explain signatures clearly.
- Quotas should be deterministic, documented, and testable.
- Preview/public modes must not expose controls that look active when the backend blocks them.

## Verification
- Check anonymous, preview, wallet, and access-code paths separately when relevant.
- Validate tier names, minimums, and quotas against backend configuration.
- Confirm public copy does not promise unavailable token-holder functionality.
- Run auth/quota tests when token gate behavior changes.
