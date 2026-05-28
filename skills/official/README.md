# Kelyra Official Skills

Official Kelyra skills are bundled `SKILL.md` rule packs. They are loaded by name with `-s <skill>` when no project-local or user-global skill with the same id exists.

Resolution order:

1. `.kelyra/skills/<name>/SKILL.md`
2. `~/.kelyra/skills/<name>/SKILL.md`
3. `skills/official/<name>/SKILL.md`

Available skills:

- `repo`
- `security-review`
- `frontend-polish`
- `protocol-audit`
- `ci-hardening`
- `docs-release`
- `agent-proof`
- `token-launch`
- `smart-contract-review`
- `console-product-review`

Use:

```bash
kelyra skills
kelyra skills show frontend-polish
kelyra run --file TASK.md -s repo -s security-review
```
