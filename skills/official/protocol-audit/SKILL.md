---
name: protocol-audit
version: 0.1.0
description: Audit protocol boundaries, receipts, verification claims, and trust assumptions.
priority: 90
budget-multiplier: 1.2
allow-fallback: true
requires-tools:
  - swd
  - receipts
---

# protocol-audit Skill

## Purpose
Use this skill when a task changes verification behavior, protocol docs, receipt formats, policy gates, MCP tools, hosted workers, or trust claims.

## Read First
- protocol docs
- receipt and proof code
- SWD engine code
- policy and CI verification code
- tests covering drift, rollback, signatures, and hosted boundaries

## Rules
- Separate what is verified today from what is planned or inferred.
- Do not weaken hash checks, rollback behavior, signature verification, receipt integrity, or policy enforcement.
- Treat protocol schema changes as compatibility changes; document migration or version impact.
- Keep hosted/browser claims separate from local CLI proof claims.
- Avoid unverifiable language such as "secure", "guaranteed", or "trustless" unless the implementation proves that exact claim.

## Verification
- Run tests that exercise the changed protocol path.
- Check at least one failure case, not only the successful path.
- Inspect receipt output or proof payloads when claim format changes.
- Summarize remaining trust assumptions and external dependencies.
