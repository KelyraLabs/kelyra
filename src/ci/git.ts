import { execFileSync } from 'node:child_process';
import type { ChangedFile, DiffInfo } from './types.js';

function git(cwd: string, args: string[], options: { allowFailure?: boolean } = {}): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    if (options.allowFailure) return null;
    throw err;
  }
}

export function assertGitRepository(cwd: string): void {
  const result = git(cwd, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (result?.trim() !== 'true') {
    throw new Error('kelyra verify --ci must be run inside a git repository.');
  }
}

function refExists(cwd: string, ref: string): boolean {
  return git(cwd, ['rev-parse', '--verify', '--quiet', ref], { allowFailure: true }) !== null;
}

function candidateBaseRefs(explicitBase?: string): string[] {
  if (explicitBase) {
    const refs = [explicitBase];
    if (!explicitBase.startsWith('origin/') && !explicitBase.includes('..')) {
      refs.push(`origin/${explicitBase}`);
    }
    return refs;
  }

  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  if (githubBase) {
    return [`origin/${githubBase}`, githubBase];
  }

  return ['HEAD~1'];
}

function resolveBaseRef(cwd: string, explicitBase?: string): string | undefined {
  for (const candidate of candidateBaseRefs(explicitBase)) {
    if (refExists(cwd, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function statusKind(rawStatus: string): ChangedFile['status'] {
  const status = rawStatus[0];
  if (status === 'A') return 'added';
  if (status === 'M') return 'modified';
  if (status === 'D') return 'deleted';
  if (status === 'R') return 'renamed';
  if (status === 'C') return 'copied';
  return 'unknown';
}

function parseNameStatusZ(raw: string): ChangedFile[] {
  const tokens = raw.split('\0').filter(Boolean);
  const files: ChangedFile[] = [];

  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++] ?? '';
    if (!status) continue;

    if (status.startsWith('R') || status.startsWith('C')) {
      const previousPath = tokens[i++];
      const nextPath = tokens[i++];
      if (nextPath) {
        files.push({
          path: nextPath,
          previousPath,
          status: statusKind(status),
        });
      }
      continue;
    }

    const filePath = tokens[i++];
    if (filePath) {
      files.push({ path: filePath, status: statusKind(status) });
    }
  }

  return files;
}

function dedupeChangedFiles(files: ChangedFile[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (!existing || existing.status !== 'added') {
      byPath.set(file.path, file);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function changedFilesForRange(cwd: string, range: string): ChangedFile[] {
  const raw = git(cwd, ['diff', '--name-status', '-z', range, '--']) ?? '';
  return dedupeChangedFiles(parseNameStatusZ(raw));
}

function changedFilesForWorkingTree(cwd: string): ChangedFile[] {
  const unstaged = parseNameStatusZ(git(cwd, ['diff', '--name-status', '-z', 'HEAD', '--'], { allowFailure: true }) ?? '');
  const staged = parseNameStatusZ(git(cwd, ['diff', '--cached', '--name-status', '-z', 'HEAD', '--'], { allowFailure: true }) ?? '');
  const untrackedRaw = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], { allowFailure: true }) ?? '';
  const untracked = untrackedRaw
    .split('\0')
    .filter(Boolean)
    .map((path): ChangedFile => ({ path, status: 'added' }));

  return dedupeChangedFiles([...unstaged, ...staged, ...untracked]);
}

export function getDiffInfo(cwd: string, base?: string): DiffInfo {
  assertGitRepository(cwd);

  const baseRef = resolveBaseRef(cwd, base);
  if (baseRef) {
    const range = `${baseRef}...HEAD`;
    return {
      cwd,
      mode: 'range',
      baseRef,
      range,
      changedFiles: changedFilesForRange(cwd, range),
    };
  }

  return {
    cwd,
    mode: 'working-tree',
    changedFiles: changedFilesForWorkingTree(cwd),
  };
}

export function readFileAtRef(cwd: string, ref: string, filePath: string): string | null {
  return git(cwd, ['show', `${ref}:${filePath}`], { allowFailure: true });
}

export function readPackageJsonBeforeChange(diff: DiffInfo): string | null {
  if (diff.baseRef) return readFileAtRef(diff.cwd, diff.baseRef, 'package.json');
  return readFileAtRef(diff.cwd, 'HEAD', 'package.json');
}
