# Kelyra Protocol Extensions

Kelyra adds a protocol layer around SWD so AI-assisted code changes can be governed, attested, exported, and reviewed by tools.

## Policy-as-code

Create a project policy:

```bash
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

New MCP tools:

- `receipt_sign`
- `proof_export`
- `policy_check`
- `trusted_keys_list`
- `patch_apply`

Existing tools keep working and now benefit from the same policy and patch support.

## Why Use Kelyra?

See [`WHY_KELYRA.md`](WHY_KELYRA.md). In short: Kelyra is focused on governance and proof for teams that need CI enforcement, signed receipts, proof bundles, and external-agent verification.
