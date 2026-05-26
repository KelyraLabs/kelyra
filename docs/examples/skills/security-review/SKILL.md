---
name: security-review
version: 0.1.0
description: Security-focused review rules for command and secret-sensitive changes.
priority: 90
budget-multiplier: 1.0
allow-fallback: true
incompatible-with:
  - fast-mode
---

# security-review Skill

## Purpose
Use this skill when a task touches command execution, package scripts, CI, deploy files, authentication, secrets, receipts, memory, or user-controlled paths.

## Read First

If present, review these before making security-sensitive edits:

- SECURITY.md
- package.json
- .github/workflows/
- src/security-policy.ts
- src/commands/verify.ts
- any file that defines command execution, receipts, secrets, auth, or writable paths

## Rules
- Treat install scripts, lifecycle hooks, shell commands, workflows, Docker files, and deploy files as high-risk surfaces.
- Never expose secret values in logs, receipts, docs, tests, or examples.
- Prefer allowlists and structured parsing over broad string matching for security decisions.
- Do not weaken SWD verification, receipt integrity, dry-run behavior, or command review prompts.
- When a change introduces a new writable path, explain how it is constrained.

## Verification
- Check that sensitive outputs are redacted before storage.
- Check that command-affecting changes still require explicit human confirmation.
- Prefer read-only verification for CI-facing checks.

## Output

When finished, summarize:

- what security-sensitive files changed
- what risks were checked
- what verification was run
- any remaining assumptions or unverified areas
