# Kelyra Protocol Extensions

Kelyra adds a protocol layer around SWD so AI-assisted code changes can be governed, attested, exported, and reviewed by tools.

## Policy-as-code

Create a project policy:

```bash
kelyra init
# or initialize policy directly
kelyra policy init --template team
kelyra policy check
```

Available templates:

```bash
kelyra policy templates
```

Policy file:

```text
.kelyra/policy.json
```

Important fields:

- `blockedPaths`: glob-like paths that SWD must block
- `confirmPaths`: paths that require human confirmation
- `trustedReceiptKeyIds`: accepted Ed25519 receipt signer ids
- `requireSignedReceipts`: CI fails changed receipts that are unsigned or invalid
- `requireReceiptForCI`: CI fails PR changes without a changed receipt
- `maxWritableActionContentBytes`: max full-file write size
- `maxPatchBytes`: max patch payload size
- `allowedTestCommands`: command allowlist for `--test-cmd`
- `sandboxTestCommands`: run test commands with a reduced environment
- `requireTestsForPaths`: paths that count as command-sensitive and trigger test command review
- `receiptChain`: link new receipts to the previous local receipt hash

## Patch Actions

External agents can emit `PATCH` actions instead of full-file `MODIFY` writes:

```json
{
  "actions": [
    {
      "path": "src/example.ts",
      "operation": "PATCH",
      "intent": "MUTATE",
      "patches": [
        {
          "oldText": "const value = 1;",
          "newText": "const value = 2;"
        }
      ],
      "description": "Update constant"
    }
  ]
}
```

If `oldText` appears more than once, include `occurrence`.

## Receipt Attestations

Generate and use a signing key:

```bash
kelyra receipts keygen
kelyra receipts sign latest
kelyra receipts verify latest
kelyra receipts show latest --markdown
```

Verify the local hash chain:

```bash
kelyra receipts chain
```

## Proof Bundles

Export a portable proof bundle:

```bash
kelyra proof export latest
```

Create a self-contained HTML proof page for review:

```bash
kelyra proof share latest
```

The bundle includes:

- receipt payload
- file/integrity/signature/chain verification status
- project policy
- agent manifest
- git diff metadata when available

Inspect without writing:

```bash
kelyra proof show latest
```

## Operator Diagnostics

Run a full local readiness check:

```bash
kelyra doctor
```

The doctor checks git state, policy, agent manifest, receipt chain, provider keys,
CI workflow, and hosted API health when `KELYRA_API_URL` or `--api-url` is set.

Explain CI before pushing:

```bash
kelyra ci explain
```

`ci explain` uses the same engine as `verify --ci`, but renders why the current
diff passes or fails and what reviewers should fix first.

## Hosted Receipt Publishing

Operators can publish a local receipt to a hosted Kelyra API they control:

```bash
export KELYRA_API_URL="https://kelyra.example"
export KELYRA_API_SECRET="..."
kelyra receipts publish latest
```

The hosted import endpoint requires machine authentication with
`KELYRA_API_SECRET`; unauthenticated receipt uploads are rejected.

## Agent Manifest

Create a local agent identity file:

```bash
kelyra manifest init
kelyra manifest check
```

Manifest file:

```text
.kelyra/agent-manifest.json
```

External SWD applies use the manifest id as the default agent id when no explicit agent id is provided.

## Local Receipt Viewer

Run a local web viewer:

```bash
kelyra viewer --target latest --port 4327
```

Open:

```text
http://127.0.0.1:4327
```

The viewer shows receipt status, signature status, chain status, touched files, git diff, and raw proof JSON.

## MCP Tools

Print client config:

```bash
kelyra mcp config generic --json
kelyra mcp config claude --json
kelyra mcp config cursor --json
```

New MCP tools:

- `receipt_sign`
- `proof_export`
- `policy_check`
- `trusted_keys_list`
- `patch_apply`

Existing tools keep working and now benefit from the same policy and patch support.

## Why Use Kelyra?

See [`WHY_KELYRA.md`](WHY_KELYRA.md). In short: Kelyra is focused on governance and proof for teams that need CI enforcement, signed receipts, proof bundles, and external-agent verification.
