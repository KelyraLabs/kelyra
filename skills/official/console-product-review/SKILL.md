---
name: console-product-review
version: 0.1.0
description: Product-review rules for hosted console, command center UX, and proof workflow clarity.
priority: 78
budget-multiplier: 1.1
allow-fallback: true
---

# console-product-review Skill

## Purpose
Use this skill when changing the hosted console, chat surface, Pulse, Forge, history, docs panel, or proof workflow UI.

## Read First
- console HTML, CSS, and JS
- backend health/config responses
- auth and quota UI states
- screenshots or live page when available

## Rules
- The console should explain status through useful labels, not apologetic launch copy.
- Keep preview, disabled, authenticated, and active modes visually distinct.
- Do not show controls that appear executable when the backend will block them.
- Keep CLI and hosted boundaries clear: local proof work should be distinct from hosted preview behavior.
- Use command-center copy: short labels, clear status, useful next action.
- Avoid route leaks such as `.html` in public navigation.

## Verification
- Test the console against the backend mode it will actually use.
- Check browser layout, disabled controls, toast messages, and health-derived copy.
- Verify no upstream names or stale domains appear in public UI.
- Confirm clean routes and no horizontal overflow on desktop and mobile.
