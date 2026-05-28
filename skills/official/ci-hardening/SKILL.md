---
name: ci-hardening
version: 0.1.0
description: Hardening rules for CI, release checks, package scripts, and automation safety.
priority: 85
budget-multiplier: 1.0
allow-fallback: true
---

# ci-hardening Skill

## Purpose
Use this skill when changing CI workflows, release automation, package scripts, test commands, deployment checks, or verification gates.

## Read First
- package.json
- lockfiles
- .github/workflows/
- CI docs
- test configuration
- policy and verify commands

## Rules
- Keep CI deterministic, read-only where possible, and explicit about permissions.
- Avoid broad tokens, write permissions, unpinned third-party actions, and shell interpolation of untrusted values.
- Keep install and lifecycle scripts reviewable.
- Prefer small focused jobs over opaque all-in-one scripts.
- CI should fail closed on verification errors and produce clear logs without leaking secrets.

## Verification
- Run the workflow-equivalent local command when possible.
- Validate YAML syntax and command names.
- Check permission blocks and triggers for unnecessary write access.
- Confirm new gates have tests or documented manual validation.
