# Security Policy

## Philosophy

Kelyra follows a **zero-trust AI model**.

AI outputs are never trusted by default.
All file operations are verified against the actual filesystem before being accepted.

---

## Safe Execution

* AI-proposed file writes are routed through Strict Write Discipline (SWD) and verified against filesystem state.
* Project-local `.kelyra/policy.json` can add blocked paths, confirmation paths, write-size limits, signed-receipt requirements, and test-command restrictions.
* Normal SWD file operations do not execute shell commands.
* Git sandboxing uses fixed `git` subcommands with argument arrays.
* `--test-cmd` is an explicit user-supplied escape hatch. It runs the provided command through the local shell for test-healing workflows, so only pass commands you trust. Projects can restrict it with `allowedTestCommands` and reduce inherited environment variables with `sandboxTestCommands`.
* There is no hidden shell lockdown mode; omit `--test-cmd` if you want model-driven sessions to avoid arbitrary shell execution.

---

## Environment Variables

* Sensitive values (e.g. API keys) require explicit configuration
* No implicit defaults are used for security-critical settings

---

## Local Data

Kelyra stores local state in predictable locations:

* `MEMORY.md` in the project root stores the human-readable agentic memory log.
* `memory.db`, `memory.db-wal`, and `memory.db-shm` in the project root are derivative SQLite indexes rebuilt from `MEMORY.md`.
* `.kelyra/receipts/` stores local SWD receipts. These may include prompts, file paths, hashes, provider metadata, budget data, test command names, and a short redacted test output tail. This directory is gitignored by default.
* `.kelyra/proofs/` stores exported proof bundles when `kelyra proof export` is used.
* `.kelyra/policy.json` and `.kelyra/agent-manifest.json` store project-local policy and agent identity metadata.
* `~/.kelyra/sessions/latest.json` stores the latest resumable conversation history and budget state.
* `~/.kelyra/metrics.json` stores local token, cost, duration, command, and project metrics for `kelyra stats`.
* `~/.kelyra/cache.db` may store SDK response-cache entries when the cache API is used. Responses containing tool calls or SWD file actions are not cached.
* `~/.kelyra/skills/` stores user-provided skill instructions loaded only when selected.

Treat session files, receipts, memory, and cache files as private project data. Delete the relevant file or directory to clear that local state.

---

## Scope

This tool is designed for **local execution only**.

Users are responsible for:

* reviewing AI-generated actions
* validating changes before applying in production environments

---

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

* Open a private security advisory in the project repository.
* Or open a private security advisory on GitHub

Please avoid public disclosure until the issue has been reviewed.

---

## Supported Versions

Currently supported:

* Latest version on `main`

Older versions may not receive security updates.

---
