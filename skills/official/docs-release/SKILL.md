---
name: docs-release
version: 0.1.0
description: Release-grade documentation, changelog, install, and launch copy rules.
priority: 65
budget-multiplier: 1.0
allow-fallback: true
---

# docs-release Skill

## Purpose
Use this skill for README, docs, launch notes, changelog, install instructions, domain copy, and public product language.

## Read First
- README.md
- CHANGELOG.md
- docs/
- package.json
- current website copy

## Rules
- Use direct, testable language. Prefer "does X" over "will soon do X".
- Do not overclaim capabilities that require unavailable services, token gates, or provider keys.
- Keep commands copy-pasteable and aligned with the current package name.
- Mention preview or disabled states only where the user actually encounters them.
- Make install, setup, run, and verify paths obvious.
- Keep public copy free of upstream project names unless explicitly documenting compatibility or attribution.

## Verification
- Check commands referenced in docs against package scripts or CLI help.
- Search for stale names, old domains, and `.html` route leaks.
- Verify public-facing links use the intended production domain or clean route.
- Summarize any docs that still depend on future launch decisions.
