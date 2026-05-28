import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSWDReceipt, saveSWDReceipt } from '../src/receipts.js';
import type { SWDRunResult } from '../src/swd.js';

describe('CLI Smoke Tests', () => {
  it('builds the project without errors', () => {
    try {
      execSync('npm run build', {
        encoding: 'utf-8',
        stdio: 'inherit',
      });
    } catch (err: any) {
      assert.fail(`npm run build failed: ${err.message}`);
    }
  });

  it('runs --help on the built CLI', () => {
    try {
      const output = execFileSync(process.execPath, ['dist/cli.js', '--help'], {
        encoding: 'utf-8',
      });

      assert.ok(output.includes('Usage: kelyra [options] [command]'));
      assert.ok(output.includes('chat [options]'));
      assert.ok(output.includes('run [options]'));
      assert.ok(output.includes('swd [options]'));
      assert.ok(output.includes('mcp'));
      assert.ok(output.includes('doctor [options]'));
      assert.ok(output.includes('ci [options]'));
      assert.ok(output.includes('policy [options]'));
      assert.ok(output.includes('proof [options]'));
      assert.ok(output.includes('manifest [options]'));
      assert.ok(output.includes('migrate [options]'));
      assert.ok(output.includes('console [options]'));
      assert.ok(output.includes('viewer [options]'));
      assert.ok(output.includes('setup-ci [options]'));
      assert.ok(output.includes('skills [options]'));
      assert.ok(output.includes('learn [options]'));
      assert.ok(output.includes('init [options]'));
    } catch (err: any) {
      assert.fail(
        `node dist/cli.js --help failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    }
  });

  it('runs protocol command help screens on the built CLI', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    for (const command of ['mcp', 'policy', 'proof', 'manifest', 'viewer', 'receipts', 'doctor', 'ci', 'migrate']) {
      const output = execFileSync(process.execPath, [cliPath, command, '--help'], {
        encoding: 'utf-8',
      });
      assert.ok(output.includes(`Usage: kelyra ${command}`));
    }
  });

  it('scaffolds policy and manifest files in a temporary directory', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-protocol-cli-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      execFileSync(process.execPath, [cliPath, 'policy', 'init'], {
        cwd: tempDir,
        encoding: 'utf-8',
      });
      execFileSync(process.execPath, [cliPath, 'manifest', 'init'], {
        cwd: tempDir,
        encoding: 'utf-8',
      });

      const policy = JSON.parse(execFileSync(process.execPath, [cliPath, 'policy', 'check', '--json'], {
        cwd: tempDir,
        encoding: 'utf-8',
      }));
      const manifest = JSON.parse(execFileSync(process.execPath, [cliPath, 'manifest', 'check', '--json'], {
        cwd: tempDir,
        encoding: 'utf-8',
      }));

      assert.equal(policy.ok, true);
      assert.equal(policy.found, true);
      assert.equal(manifest.ok, true);
      assert.equal(manifest.found, true);
      assert.equal(existsSync(join(tempDir, '.kelyra', 'policy.json')), true);
      assert.equal(existsSync(join(tempDir, '.kelyra', 'agent-manifest.json')), true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists policy templates and scaffolds GitHub CI verification', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-setup-ci-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      const templates = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'policy', 'templates', '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.deepEqual(templates.templates, ['default', 'team', 'strict']);

      execFileSync(
        process.execPath,
        [cliPath, 'setup-ci', '--strict'],
        { cwd: tempDir, encoding: 'utf-8' },
      );

      const workflowPath = join(tempDir, '.github', 'workflows', 'kelyra-verify.yml');
      const policyPath = join(tempDir, '.kelyra', 'policy.json');
      assert.equal(existsSync(workflowPath), true);
      assert.equal(existsSync(policyPath), true);

      const workflow = readFileSync(workflowPath, 'utf-8');
      assert.ok(workflow.includes('npx kelyra verify --ci --strict'));
      assert.ok(workflow.includes('permissions:'));
      assert.ok(workflow.includes('contents: read'));

      const policy = JSON.parse(readFileSync(policyPath, 'utf-8'));
      assert.equal(policy.requireReceiptForCI, true);
      assert.equal(policy.requireSignedReceipts, true);
      assert.equal(policy.sandboxTestCommands, true);
    } catch (err: any) {
      assert.fail(
        `setup-ci smoke failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists one-shot prompt source options in run help', () => {
    try {
      const output = execFileSync(process.execPath, ['dist/cli.js', 'run', '--help'], {
        encoding: 'utf-8',
      });

      assert.ok(output.includes('[prompt...]'));
      assert.ok(output.includes('--file <path>'));
      assert.ok(output.includes('--stdin'));
      assert.ok(output.includes('--provider <id>'));
    } catch (err: any) {
      assert.fail(
        `node dist/cli.js run --help failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    }
  });

  it('reports provider key readiness without requiring telemetry data', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-providers-check-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    const noKeyEnv = {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
    };

    try {
      const output = execFileSync(
        process.execPath,
        [cliPath, 'providers', 'check'],
        { cwd: tempDir, env: noKeyEnv, encoding: 'utf-8' },
      );
      assert.ok(output.includes('Kelyra Provider Check'));
      assert.ok(output.includes('Proof tools'));
      assert.ok(output.includes('Model-backed chat/run'));
      assert.ok(output.includes('unavailable'));

      const noKeyJson = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'providers', 'check', '--json'],
        { cwd: tempDir, env: noKeyEnv, encoding: 'utf-8' },
      ));
      assert.equal(noKeyJson.protocolToolsAvailable, true);
      assert.equal(noKeyJson.agentChatRunAvailable, false);
      assert.equal(noKeyJson.providers.anthropic.configured, false);
      assert.equal(noKeyJson.providers.openai.configured, false);
      assert.equal(noKeyJson.providers.deepseek.configured, false);

      const openAIJson = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'providers', 'check', '--json'],
        {
          cwd: tempDir,
          env: { ...noKeyEnv, OPENAI_API_KEY: 'sk-test' },
          encoding: 'utf-8',
        },
      ));
      assert.equal(openAIJson.agentChatRunAvailable, true);
      assert.equal(openAIJson.providers.openai.configured, true);
    } catch (err: any) {
      assert.fail(
        `providers check failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs init --check in a temporary directory without creating project files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-init-check-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      const output = execFileSync(
        process.execPath,
        [cliPath, 'init', '--check'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
        },
      );

      assert.ok(output.includes('PROJECT CHECK'));
      assert.ok(output.includes('No model provider key configured'));
      assert.equal(output.includes('ANTHROPIC_API_KEY') && output.includes('is required'), false);

      assert.equal(
        existsSync(join(tempDir, '.kelyraignore')),
        false,
        'init --check should not create .kelyraignore',
      );

      assert.equal(
        existsSync(join(tempDir, 'MEMORY.md')),
        false,
        'init --check should not create MEMORY.md',
      );

      assert.equal(
        existsSync(join(tempDir, '.kelyra')),
        false,
        'init --check should not create .kelyra',
      );
    } catch (err: any) {
      assert.fail(
        `init --check failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs init in a temporary directory and scaffolds readiness files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-init-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      const output = execFileSync(
        process.execPath,
        [cliPath, 'init'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
        },
      );

      assert.ok(output.includes('PROJECT INITIALIZATION'));
      assert.equal(existsSync(join(tempDir, '.kelyraignore')), true);
      assert.equal(existsSync(join(tempDir, 'MEMORY.md')), true);
      assert.equal(existsSync(join(tempDir, '.kelyra', 'skills')), true);
      assert.equal(existsSync(join(tempDir, '.kelyra', 'policy.json')), true);
      assert.equal(existsSync(join(tempDir, '.kelyra', 'agent-manifest.json')), true);

      const policy = JSON.parse(readFileSync(join(tempDir, '.kelyra', 'policy.json'), 'utf-8'));
      const manifest = JSON.parse(readFileSync(join(tempDir, '.kelyra', 'agent-manifest.json'), 'utf-8'));
      assert.equal(policy.sandboxTestCommands, true);
      assert.equal(manifest.id, 'kelyra-agent');
      assert.ok(manifest.capabilities.includes('proof'));
    } catch (err: any) {
      assert.fail(
        `init failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prints paste-ready MCP client config', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    const output = execFileSync(
      process.execPath,
      [cliPath, 'mcp', 'config', 'cursor', '--json'],
      { encoding: 'utf-8' },
    );
    const config = JSON.parse(output);
    assert.equal(config.mcpServers.kelyra.command, 'kelyra');
    assert.deepEqual(config.mcpServers.kelyra.args, ['mcp']);
  });

  it('runs skills list and check in a temporary directory without creating project files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-skills-cli-'));
    const globalDir = mkdtempSync(join(tmpdir(), 'kelyra-skills-cli-global-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    const env = { ...process.env, KELYRA_SKILLS_DIR: globalDir };

    try {
      const listed = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'skills', '--json'],
        { cwd: tempDir, env, encoding: 'utf-8' },
      ));
      assert.equal(listed.some((entry: any) => entry.scope === 'official' && entry.id === 'frontend-polish'), true);
      assert.equal(listed.some((entry: any) => entry.scope === 'official' && entry.id === 'security-review'), true);

      const checked = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'skills', 'check', '--json'],
        { cwd: tempDir, env, encoding: 'utf-8' },
      ));
      assert.equal(checked.ok, true);
      assert.equal(checked.checked >= 10, true);

      assert.equal(
        existsSync(join(tempDir, '.kelyra')),
        false,
        'skills list/check should not create .kelyra',
      );
    } catch (err: any) {
      assert.fail(
        `skills CLI smoke failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(globalDir, { recursive: true, force: true });
    }
  });

  it('runs verify --dry-run in a temporary directory without creating memory files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-test-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      const output = execFileSync(
        process.execPath,
        [cliPath, 'verify', '--dry-run'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
        },
      );

      assert.ok(output.includes('Memory writes will be previewed'));

      assert.equal(
        existsSync(join(tempDir, 'MEMORY.md')),
        false,
        'verify --dry-run should not create MEMORY.md',
      );

      assert.equal(
        existsSync(join(tempDir, 'memory.db')),
        false,
        'verify --dry-run should not create memory.db',
      );

      assert.equal(
        existsSync(join(tempDir, 'memory.db-shm')),
        false,
        'verify --dry-run should not create memory.db-shm',
      );

      assert.equal(
        existsSync(join(tempDir, 'memory.db-wal')),
        false,
        'verify --dry-run should not create memory.db-wal',
      );
    } catch (err: any) {
      assert.fail(
        `verify --dry-run failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    }
  });

  it('runs dream --dry-run in a temporary directory without creating memory files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-test-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      const output = execFileSync(
        process.execPath,
        [cliPath, 'dream', '--dry-run'],
        {
          cwd: tempDir,
          encoding: 'utf-8',
        },
      );

      assert.ok(output.includes('Memory writes will be previewed'));

      assert.equal(
        existsSync(join(tempDir, 'MEMORY.md')),
        false,
        'dream --dry-run should not create MEMORY.md',
      );

      assert.equal(
        existsSync(join(tempDir, 'memory.db')),
        false,
        'dream --dry-run should not create memory.db',
      );
    } catch (err: any) {
      assert.fail(
        `dream --dry-run failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    }
  });

  it('runs doctor readiness checks in JSON mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-doctor-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');

    try {
      const output = execFileSync(
        process.execPath,
        [cliPath, 'doctor', '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      );
      const report = JSON.parse(output);
      assert.equal(report.ok, true);
      assert.equal(report.status, 'warn');
      assert.ok(report.checks.some((check: any) => check.id === 'hosted-api'));
      assert.ok(report.checks.some((check: any) => check.id === 'providers'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('imports compatible router artifacts into .kelyra', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-migrate-'));
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    const sourceDir = join(tempDir, 'legacy-router');

    try {
      mkdirSync(join(sourceDir, 'receipts'), { recursive: true });
      writeFileSync(join(sourceDir, 'policy.json'), '{"version":1}\n', 'utf-8');
      writeFileSync(join(sourceDir, 'receipts', 'sample.json'), '{"id":"swd-test"}\n', 'utf-8');

      const dryRun = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'migrate', 'import', '--source-dir', sourceDir, '--dry-run', '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(dryRun.ok, true);
      assert.ok(dryRun.actions.every((action: any) => action.status === 'planned'));

      execFileSync(
        process.execPath,
        [cliPath, 'migrate', 'import', '--source-dir', sourceDir],
        { cwd: tempDir, encoding: 'utf-8' },
      );
      assert.equal(existsSync(join(tempDir, '.kelyra', 'policy.json')), true);
      assert.equal(existsSync(join(tempDir, '.kelyra', 'receipts', 'sample.json')), true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs receipts list, show, and verify on the built CLI', () => {
    const repoRoot = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), 'kelyra-receipts-cli-'));
    const cliPath = join(repoRoot, 'dist', 'cli.js');
    const filePath = 'sample.txt';
    const absPath = join(tempDir, filePath);

    try {
      process.chdir(tempDir);
      writeFileSync(absPath, 'after', 'utf-8');

      const runResult: SWDRunResult = {
        success: true,
        rolledBack: false,
        rollbackErrors: [],
        errors: [],
        results: [
          {
            action: {
              path: filePath,
              operation: 'MODIFY',
              intent: 'MUTATE',
              description: 'Update sample file',
            },
            status: 'verified',
            detail: `Verified: MODIFY ${filePath}`,
            before: {
              path: absPath,
              exists: true,
              size: 'before'.length,
              mtime: 1,
              hash: sha256('before'),
            },
            after: {
              path: absPath,
              exists: true,
              size: 'after'.length,
              mtime: 2,
              hash: sha256('after'),
            },
          },
        ],
      };
      const receipt = createSWDReceipt({
        request: 'change sample',
        summary: 'MODIFY: sample.txt',
        result: runResult,
        usage: {
          inputTokens: 100,
          outputTokens: 25,
        },
      });
      saveSWDReceipt(receipt);
      process.chdir(repoRoot);

      const listed = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'receipts', '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(listed.length, 1);
      assert.equal(listed[0].id, receipt.id);

      const shown = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'receipts', 'show', receipt.id, '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(shown.id, receipt.id);
      assert.equal(shown.files[0].path, filePath);
      assert.equal(shown.files[0].after.path, filePath);

      const markdown = execFileSync(
        process.execPath,
        [cliPath, 'receipts', 'show', receipt.id, '--markdown'],
        { cwd: tempDir, encoding: 'utf-8' },
      );
      assert.ok(markdown.includes('### Kelyra SWD Receipt'));
      assert.ok(markdown.includes('| Receipt |'));
      assert.ok(markdown.includes('`sample.txt`'));
      assert.ok(markdown.includes(`kelyra receipts verify ${receipt.id}`));

      const verified = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'receipts', 'verify', receipt.id, '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(verified.ok, true);
      assert.equal(verified.integrityOk, true);
      assert.equal(verified.files[0].status, 'ok');

      const shared = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'proof', 'share', receipt.id, '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(shared.ok, true);
      assert.equal(shared.receiptId, receipt.id);
      assert.equal(existsSync(shared.htmlPath), true);

      const publishedDryRun = JSON.parse(execFileSync(
        process.execPath,
        [
          cliPath,
          'receipts',
          'publish',
          receipt.id,
          '--api-url',
          'http://127.0.0.1:9999',
          '--secret',
          'test-kelyra-api-secret-with-enough-length',
          '--dry-run',
          '--json',
        ],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(publishedDryRun.ok, true);
      assert.equal(publishedDryRun.dryRun, true);
      assert.equal(publishedDryRun.receiptId, receipt.id);

      writeFileSync(absPath, 'changed', 'utf-8');
      const drifted = JSON.parse(execFileSync(
        process.execPath,
        [cliPath, 'receipts', 'verify', receipt.id, '--json'],
        { cwd: tempDir, encoding: 'utf-8' },
      ));
      assert.equal(drifted.ok, false);
      assert.equal(drifted.files[0].status, 'drifted');
    } catch (err: any) {
      assert.fail(
        `receipts CLI smoke failed: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      );
    } finally {
      process.chdir(repoRoot);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
