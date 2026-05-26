import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import {
  getProjectSkillsDir,
  parseSkillContent,
  validateSkill,
  type SkillCheckIssue,
} from './skills.js';

type PackageJson = {
  name?: string;
  version?: string;
  description?: string;
  type?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export interface RepoLearningProfile {
  rootName: string;
  packageName?: string;
  packageVersion?: string;
  packageDescription?: string;
  projectTypes: string[];
  readFirst: string[];
  sourceDirs: string[];
  docs: string[];
  tests: string[];
  configFiles: string[];
  ciFiles: string[];
  commandSurfaces: string[];
  securitySurfaces: string[];
  publicSurfaces: string[];
  suggestedChecks: string[];
  packageScripts: string[];
  warnings: string[];
}

export interface LearnRepoSkillOptions {
  cwd?: string;
  name?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface LearnRepoSkillResult {
  skillName: string;
  filePath: string;
  content: string;
  profile: RepoLearningProfile;
  existed: boolean;
  written: boolean;
  issues: SkillCheckIssue[];
}

const DEFAULT_SKILL_NAME = 'repo';
const MAX_DISCOVERED_FILES = 450;
const MAX_LIST_ITEMS = 12;

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.vite',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'out',
  'target',
]);

const ROOT_READ_FIRST = [
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
];

const CONFIG_FILES = [
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'eslint.config.js',
  '.eslintrc',
  '.prettierrc',
  'biome.json',
  'Dockerfile',
  'docker-compose.yml',
  '.npmrc',
  '.env.example',
];

export function learnRepoSkill(options: LearnRepoSkillOptions = {}): LearnRepoSkillResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const skillName = options.name?.trim() || DEFAULT_SKILL_NAME;
  assertPortableSkillName(skillName);

  const profile = analyzeRepo(cwd);
  const content = renderLearnedSkill(skillName, profile);
  const filePath = path.join(getProjectSkillsDir(cwd), skillName, 'SKILL.md');
  const existed = existsSync(filePath);
  const skill = parseSkillContent(content, { id: skillName, filePath, scope: 'project' });
  const issues = validateSkill(skill);

  if (existed && !options.force && !options.dryRun) {
    throw new Error(`Skill already exists: ${filePath}. Use --force to overwrite or --dry-run to preview.`);
  }

  if (!options.dryRun) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }

  return {
    skillName,
    filePath,
    content,
    profile,
    existed,
    written: !options.dryRun,
    issues,
  };
}

export function analyzeRepo(cwd = process.cwd()): RepoLearningProfile {
  const root = path.resolve(cwd);
  const files = discoverFiles(root);
  const fileSet = new Set(files);
  const pkg = readPackageJson(root);
  const scripts = pkg?.scripts ?? {};
  const deps: Record<string, string> = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };

  const sourceDirs = existingDirs(root, [
    'src',
    'app',
    'lib',
    'packages',
    'bin',
    'cli',
    'cmd',
    'internal',
  ]);
  const docs = files.filter((file) => file === 'README.md' || file === 'CHANGELOG.md' || file.startsWith('docs/'));
  const tests = files.filter((file) => (
    file.startsWith('test/') ||
    file.startsWith('tests/') ||
    file.includes('.test.') ||
    file.includes('.spec.')
  ));
  const ciFiles = files.filter((file) => file.startsWith('.github/workflows/'));
  const configFiles = CONFIG_FILES.filter((file) => fileSet.has(file));
  const packageScripts = Object.keys(scripts).sort();
  const projectTypes = inferProjectTypes(pkg, deps, fileSet);
  const publicSurfaces = inferPublicSurfaces(pkg, fileSet);
  const commandSurfaces = inferCommandSurfaces(pkg, files, fileSet);
  const securitySurfaces = inferSecuritySurfaces(files, fileSet);
  const readFirst = inferReadFirst(root, fileSet, sourceDirs);
  const suggestedChecks = inferSuggestedChecks(scripts);
  const warnings: string[] = [];

  if (readFirst.length < 3) {
    warnings.push('Limited repo documentation/configuration detected. Review the generated skill before relying on it.');
  }
  if (commandSurfaces.length > 0) {
    warnings.push('Command-affecting files were detected. Changes there should receive explicit human review.');
  }
  if (securitySurfaces.length > 0) {
    warnings.push('Security-sensitive files were detected. Avoid storing secrets in skills, receipts, tests, or docs.');
  }

  return {
    rootName: path.basename(root),
    packageName: pkg?.name,
    packageVersion: pkg?.version,
    packageDescription: pkg?.description,
    projectTypes,
    readFirst,
    sourceDirs,
    docs: limitList(docs),
    tests: limitList(tests),
    configFiles: limitList(configFiles),
    ciFiles: limitList(ciFiles),
    commandSurfaces: limitList(commandSurfaces),
    securitySurfaces: limitList(securitySurfaces),
    publicSurfaces: limitList(publicSurfaces),
    suggestedChecks,
    packageScripts,
    warnings,
  };
}

function renderLearnedSkill(skillName: string, profile: RepoLearningProfile): string {
  const projectLabel = profile.packageName ?? profile.rootName;
  const description = `Repo-learned operating rules for ${projectLabel}.`;
  const profileLines = [
    `Project: ${projectLabel}${profile.packageVersion ? ` v${profile.packageVersion}` : ''}`,
    profile.packageDescription ? `Description: ${profile.packageDescription}` : undefined,
    profile.projectTypes.length > 0 ? `Detected type: ${profile.projectTypes.join(', ')}` : undefined,
    profile.sourceDirs.length > 0 ? `Primary directories: ${profile.sourceDirs.join(', ')}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return `---
name: ${escapeYamlScalar(skillName)}
version: 0.1.0
description: ${escapeYamlScalar(description)}
priority: 80
budget-multiplier: 1.0
allow-fallback: true
---

# ${skillName} Skill

## Purpose
Use this skill when Kelyra is working inside ${projectLabel}. It was generated by \`kelyra learn\` from local repository signals and should be treated as a reviewed starting point, not hidden state.

## Repo Profile
${bulletList(profileLines)}

## Read First
${bulletList(profile.readFirst)}

## Public Surfaces
${bulletListOrFallback(profile.publicSurfaces, 'No explicit public surface was detected. Preserve existing behavior and exports unless the task says otherwise.')}

## Command and Risk Surfaces
${bulletListOrFallback([...profile.commandSurfaces, ...profile.securitySurfaces], 'No command or secret-sensitive surfaces were detected by the local scanner. Still avoid changing install, CI, deploy, or secret-handling behavior unless asked.')}

## Rules
- Preserve public behavior unless the task explicitly asks for a breaking change.
- Follow the existing architecture, naming, and file organization before adding new patterns.
- Keep edits focused on the requested behavior and avoid opportunistic refactors.
- Do not change install, CI, deploy, package script, or secret-handling files unless the task explicitly requires it.
- If touching command-affecting files, explain the risk and the reason for the change.
- Do not place secrets, private keys, tokens, or raw credentials in docs, tests, memory, skills, or receipts.
- Prefer project-local conventions over generic framework advice.

## Verification
${bulletListOrFallback(
    profile.suggestedChecks.map((cmd) => `Ask the human to run \`${cmd}\` when relevant.`),
    'Ask the human for the narrowest relevant project-specific check when tests or builds matter.',
  )}
- Let SWD verify file claims before considering the task complete.
- If a check cannot be run safely, say exactly which command should be run manually and why.

## Learned Signals
${bulletListOrFallback(
    [
      ...profile.docs.map((file) => `Docs: ${file}`),
      ...profile.configFiles.map((file) => `Config: ${file}`),
      ...profile.ciFiles.map((file) => `CI: ${file}`),
      ...profile.tests.slice(0, 6).map((file) => `Test: ${file}`),
    ],
    'No additional repo signals were detected.',
  )}
`;
}

function readPackageJson(root: string): PackageJson | undefined {
  const filePath = path.join(root, 'package.json');
  if (!existsSync(filePath)) return undefined;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as PackageJson;
  } catch {
    return undefined;
  }
}

function discoverFiles(root: string): string[] {
  const files: string[] = [];

  const walk = (relativeDir: string, depth: number) => {
    if (files.length >= MAX_DISCOVERED_FILES || depth > 4) return;
    const absoluteDir = path.join(root, relativeDir);

    let entries: Dirent[];
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_DISCOVERED_FILES) return;
      const relPath = relativeDir === '.' ? entry.name : path.join(relativeDir, entry.name);
      const portablePath = toPortablePath(relPath);

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, portablePath)) continue;
        walk(relPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || shouldSkipFile(entry.name, portablePath)) continue;
      files.push(portablePath);
    }
  };

  walk('.', 0);
  return files.sort();
}

function shouldSkipDir(name: string, portablePath: string): boolean {
  if (IGNORED_DIRS.has(name)) return true;
  if (portablePath === '.kelyra/receipts') return true;
  if (name.startsWith('.') && name !== '.github' && name !== '.kelyra') return true;
  return false;
}

function shouldSkipFile(name: string, portablePath: string): boolean {
  if (name.endsWith('.map')) return true;
  if (name.endsWith('.log')) return true;
  if (name.endsWith('.lock') || name === 'package-lock.json') return true;
  if (portablePath.startsWith('.kelyra/receipts/')) return true;
  return false;
}

function inferProjectTypes(pkg: PackageJson | undefined, deps: Record<string, string>, files: Set<string>): string[] {
  const types: string[] = [];
  const hasDep = (name: string) => deps[name] !== undefined;

  if (pkg) types.push('Node.js package');
  if (files.has('tsconfig.json') || hasDep('typescript')) types.push('TypeScript');
  if (pkg?.type === 'module') types.push('ESM');
  if (pkg?.bin) types.push('CLI');
  if (hasDep('commander')) types.push('Commander CLI');
  if (hasDep('react')) types.push('React');
  if (hasDep('next') || files.has('next.config.js') || files.has('next.config.mjs')) types.push('Next.js');
  if (hasDep('vite') || files.has('vite.config.ts') || files.has('vite.config.js')) types.push('Vite');
  if (files.has('pyproject.toml')) types.push('Python');
  if (files.has('Cargo.toml')) types.push('Rust');
  if (files.has('go.mod')) types.push('Go');

  return uniq(types);
}

function inferPublicSurfaces(pkg: PackageJson | undefined, files: Set<string>): string[] {
  const surfaces: string[] = [];

  if (pkg?.bin) surfaces.push('package.json bin entries');
  if (pkg?.exports) surfaces.push('package.json exports');
  if (files.has('src/index.ts')) surfaces.push('src/index.ts');
  if (files.has('src/cli.ts')) surfaces.push('src/cli.ts');
  if (files.has('README.md')) surfaces.push('README.md');
  if (files.has('docs/CI.md')) surfaces.push('docs/CI.md');
  if (files.has('CHANGELOG.md')) surfaces.push('CHANGELOG.md');

  return surfaces;
}

function inferCommandSurfaces(pkg: PackageJson | undefined, files: string[], fileSet: Set<string>): string[] {
  const surfaces: string[] = [];

  if (pkg?.scripts && Object.keys(pkg.scripts).length > 0) surfaces.push('package.json scripts');
  if (pkg?.bin) surfaces.push('package.json bin');
  if (pkg?.exports) surfaces.push('package.json exports');
  for (const file of files) {
    if (file.startsWith('.github/workflows/')) surfaces.push(file);
    if (/\.(sh|ps1|bat|cmd)$/i.test(file)) surfaces.push(file);
  }
  for (const file of ['Dockerfile', 'docker-compose.yml', 'Makefile']) {
    if (fileSet.has(file)) surfaces.push(file);
  }

  return uniq(surfaces);
}

function inferSecuritySurfaces(files: string[], fileSet: Set<string>): string[] {
  const surfaces: string[] = [];

  for (const file of ['.env.example', '.npmrc', 'SECURITY.md', '.github/dependabot.yml']) {
    if (fileSet.has(file)) surfaces.push(file);
  }
  for (const file of files) {
    if (/secret|auth|token|credential|security/i.test(file)) surfaces.push(file);
  }

  return uniq(surfaces);
}

function inferReadFirst(root: string, files: Set<string>, sourceDirs: string[]): string[] {
  const readFirst: string[] = [];

  for (const file of ROOT_READ_FIRST) {
    if (files.has(file)) readFirst.push(file);
  }
  for (const file of ['src/cli.ts', 'src/index.ts', 'src/config.ts', 'src/commands/chat.ts']) {
    if (files.has(file)) readFirst.push(file);
  }
  for (const dir of sourceDirs) {
    if (!readFirst.includes(`${dir}/`)) readFirst.push(`${dir}/`);
  }

  return limitList(readFirst.length > 0 ? readFirst : [path.basename(root)]);
}

function inferSuggestedChecks(scripts: Record<string, string>): string[] {
  const checks: string[] = [];

  if (scripts.test) checks.push('npm test');
  if (scripts.build) checks.push('npm run build');
  if (scripts.lint) checks.push('npm run lint');
  if (scripts.typecheck) checks.push('npm run typecheck');

  return checks;
}

function existingDirs(root: string, dirs: string[]): string[] {
  return dirs.filter((dir) => {
    try {
      return statSync(path.join(root, dir)).isDirectory();
    } catch {
      return false;
    }
  });
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function bulletListOrFallback(items: string[], fallback: string): string {
  const filtered = limitList(items.filter(Boolean));
  if (filtered.length === 0) return `- ${fallback}`;
  return bulletList(filtered);
}

function limitList(items: string[]): string[] {
  return uniq(items).slice(0, MAX_LIST_ITEMS);
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function escapeYamlScalar(value: string): string {
  if (/^[a-zA-Z0-9 ._/@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function assertPortableSkillName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error('Skill names must use letters, numbers, dots, dashes, or underscores, and start with a letter or number.');
  }
}
