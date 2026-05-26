# Changelog

All notable changes to Kelyra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.13.0] - 2026-05-25

### Added

- Kelyra CLI package metadata and `kelyra` binary.
- Signed SWD receipts with Ed25519 key generation, signing, verification, and local receipt-chain checks.
- Policy-as-code under `.kelyra/policy.json`.
- Proof bundle export and local proof viewer.
- GitHub Actions verification scaffolding through `kelyra setup-ci`.
- MCP tools for SWD dry-run/apply, receipt inspection/signing, policy checks, trusted keys, proof export, and patch application.
- Model-free external-agent `PATCH` actions with bounded payload size.
- Provider readiness checks for protocol tools versus model-backed `chat`/`run`.

### Changed

- Project-local state now uses `.kelyra/`.
- User-global state now uses `~/.kelyra/`.
- CI finding ids, report modes, memory metadata markers, branch namespace, and test fixtures now use Kelyra naming.
- Public documentation now positions Kelyra as a standalone governance and proof layer for agentic code changes.

### Security

- CI verification remains read-only and does not require a model provider key.
- Sensitive paths remain blocked by default for external-agent SWD applies.
- Signed receipt and trusted signer policy controls can fail CI when configured.
