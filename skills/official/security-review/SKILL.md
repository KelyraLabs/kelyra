---
name: security-review
version: 0.1.0
description: Security-focused rules for auth, secrets, command execution, CI, and writable paths.
priority: 95
budget-multiplier: 1.0
allow-fallback: true
incompatible-with:
  - fast-mode
---

# security-review Skill

## Purpose
Use this skill when work touches command execution, package scripts, CI, deployments, authentication, wallets, secrets, receipts, memory, or user-controlled file paths.

## Read First
- SECURITY.md
- package.json
- .github/workflows/
- source files that parse paths, commands, requests, secrets, or auth state
- tests around policy, verification, receipts, and command execution

## Rules
- Never expose raw secrets, keys, tokens, cookies, wallet signatures, nonces, or private paths in logs, receipts, docs, examples, or tests.
- Prefer structured parsing and allowlists over broad string matching.
- Keep dry-run, confirmation, rollback, and receipt verification fail-closed.
- Treat install hooks, shell commands, CI workflows, Docker files, deploy files, and wallet/auth flows as high-risk.
- New writable paths must have a clear boundary, validation rule, and test.

## Verification
- Confirm sensitive values are redacted before persistence.
- Confirm command-affecting changes still require explicit approval or policy coverage.
- Prefer read-only checks for CI and deploy-facing changes.
- Summarize risks checked and any assumptions left unverified.
