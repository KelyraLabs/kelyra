---
name: repo
version: 0.1.0
description: General repository operating rules for verified Kelyra work.
priority: 80
budget-multiplier: 1.0
allow-fallback: true
---

# repo Skill

## Purpose
Use this skill when Kelyra is working inside an existing repository and must preserve the project's shape, conventions, and public behavior.

## Read First
- README.md
- package.json
- docs/
- src/
- test/
- .github/workflows/

## Rules
- Learn the existing architecture before proposing abstractions.
- Keep edits scoped to the task and avoid unrelated cleanup.
- Preserve public APIs, CLI flags, package scripts, data formats, and documented behavior unless the user explicitly asks for a breaking change.
- Use existing helpers, test style, and naming conventions before adding new patterns.
- Treat generated files, lockfiles, deploy config, and secret-handling paths as high-change-risk surfaces.

## Verification
- Run the narrowest relevant check first.
- For shared contracts, run or add tests around the changed behavior.
- If a check cannot run safely, state the exact command a maintainer should run.
- Let SWD receipts represent the final proof of accepted file changes.
