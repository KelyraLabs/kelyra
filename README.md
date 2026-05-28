# Kelyra

Governed agent execution for AI-assisted code changes.

Kelyra turns agent file changes into reviewable evidence: policy checks, filesystem verification, signed receipts, proof bundles, and CI gates. It can run with built-in model providers, or it can operate as a model-free verification layer for any external agent that emits structured file actions.

## Why Use It

- Verify claimed file writes against real filesystem snapshots.
- Produce local SWD receipts for successful non-dry-run changes.
- Sign receipts with Ed25519 keys for reviewer trust.
- Enforce project policy for paths, test commands, write sizes, receipt signatures, and CI coverage.
- Export portable proof bundles for audit and review.
- Run read-only CI verification without any model API key.
- Route external agents through the same verification boundary without sharing provider keys.

## Install

```bash
npm install -g kelyra
kelyra chat
```

Or run without a global install:

```bash
npx kelyra@latest chat
```

## Provider Keys

Protocol tools do not need a model key:

```bash
kelyra swd apply --stdin --json
kelyra receipts verify latest
kelyra proof share latest
kelyra verify --ci
```

The built-in `chat` and `run` commands need at least one provider key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export OPENAI_API_KEY="sk-proj-..."
# or
export DEEPSEEK_API_KEY="..."

kelyra providers check
```

## Quick Start

```bash
kelyra init
kelyra doctor
kelyra providers check
kelyra chat
```

Use Kelyra as a model-free verification layer for another agent:

```bash
your-agent --emit-file-actions | kelyra swd apply --stdin --json
```

Scaffold CI and team policy:

```bash
kelyra setup-ci --policy-template team
kelyra ci explain
kelyra verify --ci
```

Generate, sign, and export proof:

```bash
kelyra receipts keygen
kelyra receipts sign latest
kelyra proof export latest
kelyra proof share latest
```

Publish a local receipt to a hosted Kelyra API that you operate:

```bash
export KELYRA_API_URL="https://kelyra.example"
export KELYRA_API_SECRET="..."
kelyra receipts publish latest
```

## Core Commands

| Command | Purpose |
| --- | --- |
| `kelyra init` | Scaffold `.kelyraignore`, `MEMORY.md`, and project skill directories |
| `kelyra doctor` | Check local setup, providers, receipts, CI, policy, and hosted API readiness |
| `kelyra providers check` | Show whether protocol tools and chat/run are ready |
| `kelyra ci explain` | Explain why the current diff would pass or fail Kelyra CI |
| `kelyra chat` | Interactive model session with SWD verification |
| `kelyra run` | One-shot model task with the same verification pipeline |
| `kelyra swd apply` | Model-free external-agent file action verification |
| `kelyra receipts` | List, inspect, verify, sign, publish, and chain SWD receipts |
| `kelyra policy` | Validate and scaffold project policy templates |
| `kelyra proof` | Export, inspect, or create static share pages for portable proof bundles |
| `kelyra manifest` | Manage external-agent identity metadata |
| `kelyra migrate` | Import compatible SWD router artifacts into `.kelyra/` |
| `kelyra setup-ci` | Scaffold GitHub Actions verification |
| `kelyra verify --ci` | Read-only PR/diff verification without a model key |
| `kelyra mcp` | Expose SWD and proof tools over MCP stdio |
| `kelyra skills` | List, inspect, create, and validate project, global, and official skill packs |
| `kelyra learn` | Generate a repo-local skill from deterministic project signals |

## Local Files

Kelyra stores project state under `.kelyra/`:

- `.kelyra/policy.json`
- `.kelyra/receipts/`
- `.kelyra/proofs/`
- `.kelyra/agent-manifest.json`
- `.kelyra/skills/`

User-global state is stored under `~/.kelyra/`.

## Official Skills

Kelyra ships with official `SKILL.md` rule packs under `skills/official/`. They are loaded by name when no project-local or user-global skill with the same id exists.

```bash
kelyra skills
kelyra skills show frontend-polish
kelyra run --file TASK.md -s repo -s security-review
```

Bundled skills include `repo`, `security-review`, `frontend-polish`, `protocol-audit`, `ci-hardening`, `docs-release`, `agent-proof`, `token-launch`, `smart-contract-review`, and `console-product-review`.

## Docs

- [Protocol Extensions](docs/PROTOCOL.md)
- [CI Verification](docs/CI.md)
- [Receipt Attestations](docs/ATTESTATIONS.md)
- [Why Kelyra](docs/WHY_KELYRA.md)
- [Skills](docs/skills.md)

## Development

```bash
npm install
npm run build
npm test
```

Node.js 20+ is required. SQLite-backed telemetry, cache, and memory-index features work best on Node.js 22.5+ and safely degrade on older supported versions.

## License

MIT
