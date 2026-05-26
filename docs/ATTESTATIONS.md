# Receipt Attestations

SWD receipts already include an integrity hash over the receipt payload. That catches accidental edits, but a local attacker who can rewrite the receipt can also recompute that hash. Signed receipts add an Ed25519 signature so a reviewer can verify that a receipt was produced by a known local signing key.

## Create a signing key

```bash
kelyra receipts keygen
```

By default the private key is written outside the repo:

```text
~/.kelyra/receipt-ed25519-private.pem
```

The command prints a public key id. Share the public key or key id with systems that need to recognize your receipt signer. Do not commit the private key.

## Sign a receipt

```bash
kelyra receipts sign latest
```

Use a custom private key path when needed:

```bash
kelyra receipts sign latest --key ~/.kelyra/prod-receipt-key.pem
```

The signature is stored in the receipt under `integrity.signature` and covers the receipt payload integrity hash.

## Verify a signed receipt

```bash
kelyra receipts verify latest
```

Verification checks three layers:

- the receipt payload still matches its internal SHA-256 hash
- the Ed25519 signature matches that hash and public key
- the current workspace files still match the expected file snapshots in the receipt
- the optional local receipt chain still points to the previous receipt hash

JSON output includes `integrityOk` and `signatureOk`:

```bash
kelyra receipts verify latest --json
```

An unsigned receipt returns `signatureOk: null`.

## Verify receipt chain

```bash
kelyra receipts chain
```

When `receiptChain` is enabled in `.kelyra/policy.json`, newly created receipts include the previous receipt id and previous receipt integrity hash. This creates a local append-only audit chain that can be checked later.

## Export a proof bundle

```bash
kelyra proof export latest
```

Proof bundles combine receipt data, signature status, chain status, project policy, agent manifest, and git diff metadata into one portable JSON artifact.
