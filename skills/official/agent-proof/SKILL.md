---
name: agent-proof
version: 0.1.0
description: Rules for external-agent SWD handoff, proof receipts, and model-free verification.
priority: 88
budget-multiplier: 1.1
allow-fallback: true
requires-tools:
  - swd
  - receipts
---

# agent-proof Skill

## Purpose
Use this skill when building or reviewing workflows where another agent produces file actions and Kelyra verifies them.

## Read First
- SWD parser and engine code
- external-agent examples
- receipts and proof docs
- MCP tool definitions
- tests for JSON actions and FILE_ACTION blocks

## Rules
- The external agent keeps its own model and key; Kelyra should verify actions, not invent model behavior.
- Treat every claimed file action as untrusted until path validation, policy review, snapshot, apply, and post-write verification pass.
- Dry-run must not write files or receipts.
- JSON output must remain machine-readable on failure.
- Receipts must identify the external agent/model without exposing secrets or local private paths.

## Verification
- Test valid and invalid external-agent input formats.
- Include a blocked sensitive path or risky command-surface case when relevant.
- Verify rollback or failure behavior when hashes or oldText do not match.
- Inspect receipt metadata for source and redaction quality.
