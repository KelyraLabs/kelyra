# Why Kelyra

Kelyra exists for teams that need AI-assisted changes to leave evidence that can be reviewed after the agent finishes.

## Product Focus

Kelyra is not only a prompt runner. Its core value is the verification layer around agentic file changes:

- bounded file actions
- pre/post filesystem snapshots
- rollback on failed verification
- local receipts
- Ed25519 receipt signatures
- policy-as-code
- proof bundles
- no-model CI verification
- MCP tools for external agent clients

## When It Is Useful

- A team wants PRs to show which files an agent changed.
- CI should fail when policy requires a receipt and the PR has none.
- Signed receipts should identify trusted local signing keys.
- External agents should share a single verification boundary.
- Reviewers need a portable proof bundle instead of terminal logs.

## Core Contract

- `chat` and `run` need at least one configured model provider key.
- `swd apply`, receipts, policy, proof, viewer, and CI verification do not need a model key.
- Kelyra-owned project state lives under `.kelyra/`.
- User-global state lives under `~/.kelyra/`.

## Demonstration Flow

```bash
kelyra setup-ci --policy-template team
kelyra swd apply --file actions.json --json
kelyra receipts keygen
kelyra receipts sign latest
kelyra proof export latest
kelyra verify --ci
```

That is the product difference: any compatible agent can produce file actions, and the repository can verify, sign, export, and enforce the evidence.
