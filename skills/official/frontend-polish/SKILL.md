---
name: frontend-polish
version: 0.1.0
description: Product-grade frontend polish, responsive QA, copy fit, and interaction quality.
priority: 75
budget-multiplier: 1.1
allow-fallback: true
---

# frontend-polish Skill

## Purpose
Use this skill for landing pages, consoles, dashboards, tools, forms, and any user-facing UI that must feel production-ready.

## Read First
- existing CSS and design tokens
- primary HTML or component entry points
- browser console errors
- current screenshots or the live page when available

## Rules
- Match the existing visual system before introducing new colors, typography, spacing, or components.
- Avoid decorative clutter, nested cards, placeholder marketing, and labels that describe the UI instead of doing useful work.
- Make controls feel complete: disabled, loading, empty, error, active, hover, and focus states should be intentional.
- Keep text inside its container on mobile and desktop; use layout constraints instead of viewport-scaled fonts.
- Prefer product-specific copy and real workflow language over generic SaaS claims.
- Check that primary CTAs, navigation, and status labels use clean production URLs and names.

## Verification
- Inspect desktop and mobile viewports when the task affects layout.
- Check for horizontal overflow, broken links, console errors, clipped text, and unclear disabled states.
- If a local server is needed, verify the page through HTTP rather than only opening the file.
- Report visual limitations honestly if browser QA cannot be completed.
