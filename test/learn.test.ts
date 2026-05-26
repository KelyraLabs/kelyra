import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeRepo, learnRepoSkill } from '../src/learn.js';

let tempDir = '';

describe('Repo learning', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kelyra-learn-'));
    mkdirSync(join(tempDir, 'src', 'commands'), { recursive: true });
    mkdirSync(join(tempDir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(tempDir, 'README.md'), '# Demo\n', 'utf-8');
    writeFileSync(join(tempDir, 'CHANGELOG.md'), '# Changelog\n', 'utf-8');
    writeFileSync(join(tempDir, 'src', 'cli.ts'), 'export {};\n', 'utf-8');
    writeFileSync(join(tempDir, 'src', 'index.ts'), 'export {};\n', 'utf-8');
    writeFileSync(join(tempDir, '.github', 'workflows', 'ci.yml'), 'name: ci\n', 'utf-8');
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'demo-cli',
      version: '0.1.0',
      type: 'module',
      bin: {
        demo: 'dist/cli.js',
      },
      scripts: {
        build: 'tsc',
        test: 'node --test',
      },
      dependencies: {
        commander: '^14.0.0',
      },
      devDependencies: {
        typescript: '^6.0.0',
      },
    }, null, 2), 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('analyzes repo signals without executing project commands', () => {
    const profile = analyzeRepo(tempDir);

    assert.equal(profile.packageName, 'demo-cli');
    assert.ok(profile.projectTypes.includes('CLI'));
    assert.ok(profile.projectTypes.includes('TypeScript'));
    assert.ok(profile.readFirst.includes('README.md'));
    assert.ok(profile.commandSurfaces.includes('package.json scripts'));
    assert.ok(profile.commandSurfaces.includes('.github/workflows/ci.yml'));
    assert.ok(profile.suggestedChecks.includes('npm test'));
  });

  it('creates a validated project-local repo skill', () => {
    const result = learnRepoSkill({ cwd: tempDir });

    assert.equal(result.skillName, 'repo');
    assert.equal(result.written, true);
    assert.equal(result.issues.some((issue) => issue.level === 'error'), false);
    assert.equal(existsSync(join(tempDir, '.kelyra', 'skills', 'repo', 'SKILL.md')), true);
    assert.ok(result.content.includes('src/cli.ts'));
    assert.ok(result.content.includes('package.json scripts'));
    assert.ok(result.content.includes('Ask the human to run `npm test` when relevant.'));
  });

  it('previews generated skills in dry-run mode without writing files', () => {
    const result = learnRepoSkill({ cwd: tempDir, dryRun: true });

    assert.equal(result.written, false);
    assert.equal(existsSync(join(tempDir, '.kelyra')), false);
    assert.ok(result.content.includes('Repo Profile'));
  });

  it('refuses to overwrite an existing skill unless forced', () => {
    learnRepoSkill({ cwd: tempDir });

    assert.throws(
      () => learnRepoSkill({ cwd: tempDir }),
      /Use --force/,
    );

    const forced = learnRepoSkill({ cwd: tempDir, force: true });
    assert.equal(forced.existed, true);
    assert.equal(forced.written, true);
  });
});
