# Changelog

All notable changes to Kelyra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-05-28

### Added

- Official bundled skills under `skills/official/` for repository work, security review, frontend polish, protocol audits, CI hardening, docs release work, external-agent proof, token launch workflows, smart contract review, and console product review.
- Official skills are now discovered by `kelyra skills`, validated by `kelyra skills check`, and loadable by name with `-s <skill>`.
- Clean public routes for `/console`, `/protocol`, and `/tiers`, with redirects from the legacy `.html` URLs.

### Changed

- Public launch copy now avoids stale holder-access and watch-only launch wording outside the console preview.
- `kelyra doctor` now detects Kelyra CI verification in any GitHub workflow YAML.
- Contributor docs now describe the current dependency review policy and optional provider keys.
- The repository now ships a tracked Kelyra policy and agent manifest while keeping local proof artifacts ignored.
- New agent manifests scaffold with Kelyra-specific identity and proof/verify capabilities.

### Security

- npm package dry-run includes the bundled official skills while preserving backend, site, docs, and CLI packaging.

## [0.1.0] - 2026-05-27

### Added

- Kelyra CLI package metadata and `kelyra` binary.
- Signed SWD receipts with Ed25519 key generation, signing, verification, and local receipt-chain checks.
- Policy-as-code under `.kelyra/policy.json`.
- Proof bundle export and local proof viewer.
- GitHub Actions verification scaffolding through `kelyra setup-ci`.
- MCP tools for SWD dry-run/apply, receipt inspection/signing, policy checks, trusted keys, proof export, and patch application.
- Model-free external-agent `PATCH` actions with bounded payload size.
- Provider readiness checks for protocol tools versus model-backed `chat`/`run`.
- Hosted API, watch-only public console launch mode, token-tier quota configuration, and Railway deployment files.
- Landing, protocol, tiers, and console pages for the Kelyra launch.

### Changed

- Project-local state now uses `.kelyra/`.
- User-global state now uses `~/.kelyra/`.
- CI finding ids, report modes, memory metadata markers, branch namespace, and test fixtures now use Kelyra naming.
- Public documentation now positions Kelyra as a standalone governance and proof layer for agentic code changes.

### Security

- CI verification remains read-only and does not require a model provider key.
- Sensitive paths remain blocked by default for external-agent SWD applies.
- Signed receipt and trusted signer policy controls can fail CI when configured.
