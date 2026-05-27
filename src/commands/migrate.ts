import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { c, error, heading, info, success, warn, theme } from '../utils.js';

interface MigrateOptions {
  sourceDir?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

interface MigrationAction {
  from: string;
  to: string;
  status: 'copied' | 'skipped' | 'planned';
  reason?: string;
}

interface MigrationReport {
  ok: boolean;
  sourceDir: string;
  actions: MigrationAction[];
}

const KNOWN_ARTIFACTS = [
  'policy.json',
  'agent-manifest.json',
  'receipts',
  'proofs',
  'skills',
];

function walkFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) files.push(...walkFiles(fullPath));
    else if (stat.isFile()) files.push(fullPath);
  }
  return files;
}

function artifactFiles(sourceDir: string): Array<{ from: string; to: string }> {
  const files: Array<{ from: string; to: string }> = [];
  for (const artifact of KNOWN_ARTIFACTS) {
    const source = join(sourceDir, artifact);
    if (!existsSync(source)) continue;
    const stat = statSync(source);
    if (stat.isDirectory()) {
      for (const file of walkFiles(source)) {
        files.push({
          from: file,
          to: join(process.cwd(), '.kelyra', artifact, relative(source, file)),
        });
      }
    } else if (stat.isFile()) {
      files.push({
        from: source,
        to: join(process.cwd(), '.kelyra', basename(source)),
      });
    }
  }
  return files;
}

function copyArtifact(from: string, to: string, options: MigrateOptions): MigrationAction {
  if (existsSync(to) && !options.force) {
    return { from, to, status: 'skipped', reason: 'target exists; pass --force to overwrite' };
  }

  if (options.dryRun) {
    return { from, to, status: 'planned' };
  }

  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return { from, to, status: 'copied' };
}

function renderMigration(report: MigrationReport): void {
  console.log(heading('Kelyra Migration'));
  info(`Source: ${report.sourceDir}`);
  console.log();

  if (report.actions.length === 0) {
    warn('No compatible artifacts were found.');
    return;
  }

  for (const action of report.actions) {
    const marker = action.status === 'copied'
      ? `${theme.success}COPIED${c.reset}`
      : action.status === 'planned'
        ? `${theme.info}PLAN${c.reset}`
        : `${theme.warning}SKIP${c.reset}`;
    console.log(`  ${marker} ${c.dim}${relative(process.cwd(), action.from)}${c.reset}`);
    console.log(`       -> ${c.cyan}${relative(process.cwd(), action.to)}${c.reset}`);
    if (action.reason) console.log(`       ${c.dim}${action.reason}${c.reset}`);
  }

  const copied = report.actions.filter((action) => action.status === 'copied').length;
  const planned = report.actions.filter((action) => action.status === 'planned').length;
  if (copied > 0) success(`Imported ${copied} artifact file(s).`);
  if (planned > 0) info(`Planned ${planned} artifact file(s).`);
}

export async function migrateCommand(action = 'import', options: MigrateOptions = {}): Promise<void> {
  const normalizedAction = action.toLowerCase();
  if (normalizedAction !== 'import') {
    error(`Unknown migrate action: ${normalizedAction}`);
    info('Usage: kelyra migrate import --source-dir <path>');
    process.exitCode = 1;
    return;
  }

  if (!options.sourceDir) {
    error('Missing --source-dir <path>.');
    info('Point it at a compatible router artifact directory, then rerun with --dry-run first.');
    process.exitCode = 1;
    return;
  }

  const sourceDir = resolve(options.sourceDir);
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    error(`Source directory not found: ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  const actions = artifactFiles(sourceDir).map((item) => copyArtifact(item.from, item.to, options));
  const report: MigrationReport = {
    ok: actions.some((item) => item.status === 'copied' || item.status === 'planned'),
    sourceDir,
    actions,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  renderMigration(report);
  if (!report.ok) process.exitCode = 1;
}
