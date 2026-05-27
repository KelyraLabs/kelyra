# Kelyra CI Verification

`kelyra verify --ci` brings Kelyra verification into GitHub CI without calling a model.

It is read-only. It does not require an Anthropic key, does not use provider fallback, does not modify files, does not execute SWD actions, and does not write to `MEMORY.md`.

Use it to review PR diffs for high-impact repository changes before merge.

## What it checks

`verify --ci` reviews the current PR/diff for execution-surface and verification risks:

- `package.json` script changes and npm lifecycle hooks
- GitHub Actions workflow changes
- shell, deploy, Docker, and package-manager surfaces
- `.env`, `.npmrc`, private-key-like files, and high-confidence secrets
- changed Kelyra receipts under `.kelyra/receipts/`

If no receipt is present, the command still runs in generic PR-review mode.

If a receipt is changed in the PR, CI also checks receipt integrity and whether changed files are covered by the receipt.

## GitHub Actions setup

Fast scaffold:

```bash
kelyra setup-ci --policy-template team
```

Strict scaffold, where warnings fail and receipts are required by policy:

```bash
kelyra setup-ci --strict
```

For normal users installing Kelyra from npm, use `npx kelyra`:

```yaml
name: Kelyra Verify

on:
  pull_request:
  push:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  kelyra-verify:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run Kelyra CI verification
        run: npx kelyra verify --ci
```

The explicit permissions block keeps the GitHub token read-only:

```yaml
permissions:
  contents: read
```

This is enough for Kelyra CI Verification because the command only reads the repository diff and local files.


## Exit behavior

Default mode is intentionally review-friendly:

- `INFO` and `WARN` findings pass CI.
- `HIGH` findings fail CI.
- Runtime errors, such as running outside a git repository, exit with code `2`.

This means normal high-impact changes, such as editing a workflow file or adding a harmless package script, are reported for review but do not block CI by default.

Use strict mode if you want warnings to fail CI:

```bash
npx kelyra verify --ci --strict
```

Use JSON output for downstream tooling:

```bash
npx kelyra verify --ci --json
```

Explain the same result locally in reviewer-friendly language:

```bash
npx kelyra ci explain
```

`ci explain` uses the same verification engine and exit behavior, but focuses on
why the diff passes or fails and which recommendation to handle first.

Compare against a specific base ref:

```bash
npx kelyra verify --ci --base origin/main
```

## Example: warning that passes CI

```text
WARN package-json-scripts-changed package.json
  package.json scripts changed
  Evidence:
    - scripts.test changed
  Why: Package scripts can execute commands during test, build, install, publish, or CI workflows.
  Recommendation: Review script changes before merge and make sure they match the PR intent.
```

Warnings are review signals. They do not fail CI unless `--strict` is enabled.

## Example: high finding that fails CI

```text
HIGH npm-lifecycle-script-added package.json
  Npm install lifecycle script added
  Evidence:
    - scripts.postinstall added
  Why: Npm install lifecycle scripts can execute during dependency installation and are a common supply-chain review point.
  Recommendation: Avoid install lifecycle scripts unless absolutely necessary. If required, keep them minimal and review every command.
```

High findings fail CI by default.

## How this relates to Kelyra

SWD verifies AI-assisted file changes locally.

`kelyra verify --ci` brings that verification mindset into GitHub CI:

- changed files are reviewed before merge
- execution-surface changes are highlighted
- sensitive paths and high-confidence secrets are checked
- Kelyra receipts are verified when present

Without receipts, it works as a generic PR-review check.

With receipts, it becomes Kelyra-native CI verification for AI-assisted changes.
