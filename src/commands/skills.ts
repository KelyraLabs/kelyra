import * as os from 'node:os';
import * as path from 'node:path';
import {
  checkSkills,
  createSkill,
  getGlobalSkillsDir,
  getProjectSkillsDir,
  listSkills,
  loadSkill,
  type Skill,
  type SkillCheckIssue,
  type SkillListEntry,
} from '../skills.js';
import { c, error, heading, hr, info, success, theme, warn } from '../utils.js';

interface SkillsOptions {
  global?: boolean;
  force?: boolean;
  json?: boolean;
}

export async function skillsCommand(
  action?: string,
  name?: string,
  options: SkillsOptions = {},
): Promise<void> {
  const normalizedAction = (action ?? 'list').toLowerCase();

  if (normalizedAction === 'list') {
    printSkillsList(options.json);
    return;
  }

  if (normalizedAction === 'show') {
    if (!name) {
      error('Usage: kelyra skills show <name>');
      process.exitCode = 1;
      return;
    }
    printSkill(name, options.json);
    return;
  }

  if (normalizedAction === 'new') {
    if (!name) {
      error('Usage: kelyra skills new <name> [--global] [--force]');
      process.exitCode = 1;
      return;
    }
    createNewSkill(name, options);
    return;
  }

  if (normalizedAction === 'check') {
    printSkillCheck(name, options.json);
    return;
  }

  warn(`Unknown skills action: ${normalizedAction}`);
  info('Usage: kelyra skills | kelyra skills show <name> | kelyra skills new <name> | kelyra skills check [name]');
  process.exitCode = 1;
}

function printSkillsList(asJson?: boolean): void {
  const entries = listSkills();

  if (asJson) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(heading('Kelyra Skills'));
  console.log(`${c.dim}Project:${c.reset} ${formatPath(getProjectSkillsDir())}`);
  console.log(`${c.dim}Global:${c.reset}  ${formatPath(getGlobalSkillsDir())}`);
  console.log();

  const project = entries.filter((entry) => entry.scope === 'project');
  const global = entries.filter((entry) => entry.scope === 'global');

  printSkillGroup('Project skills', project);
  printSkillGroup('Global skills', global);

  if (entries.length === 0) {
    info('No skills found yet. Create one with: kelyra skills new repo');
  }
}

function printSkillGroup(title: string, entries: SkillListEntry[]): void {
  console.log(`${c.bold}${title}${c.reset}`);
  if (entries.length === 0) {
    console.log(`  ${c.dim}none${c.reset}`);
    console.log();
    return;
  }

  for (const entry of entries) {
    const shadowed = entry.shadowed ? ` ${theme.warning}(shadowed by project skill)${c.reset}` : '';
    const description = entry.description ? ` - ${entry.description}` : '';
    console.log(
      `  ${theme.info}${entry.id}${c.reset} ${c.dim}v${entry.version}${c.reset}${shadowed}${description}`,
    );
    console.log(`     ${c.dim}${formatPath(entry.path)}${c.reset}`);
  }
  console.log();
}

function printSkill(name: string, asJson?: boolean): void {
  let skill: Skill;
  try {
    skill = loadSkill(name);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }

  console.log(heading(`Skill ${skill.id}`));
  console.log(`${c.dim}Name:${c.reset}        ${skill.meta.name}`);
  console.log(`${c.dim}Version:${c.reset}     ${skill.meta.version}`);
  console.log(`${c.dim}Source:${c.reset}      ${skill.scope}`);
  console.log(`${c.dim}Path:${c.reset}        ${formatPath(skill.filePath)}`);
  console.log(`${c.dim}Priority:${c.reset}    ${skill.meta.priority}`);
  console.log(`${c.dim}Budget:${c.reset}      ${skill.meta.budgetMultiplier}x`);
  console.log(`${c.dim}Fallback:${c.reset}    ${skill.meta.allowFallback ? 'allowed' : 'disabled'}`);
  if (skill.meta.forceProvider) {
    console.log(`${c.dim}Provider:${c.reset}    ${skill.meta.forceProvider}`);
  }
  if (skill.meta.requiresTools.length > 0) {
    console.log(`${c.dim}Tools:${c.reset}       ${skill.meta.requiresTools.join(', ')}`);
  }
  console.log(`${c.dim}Description:${c.reset} ${skill.meta.description || 'none'}`);
  console.log(hr());
  console.log(skill.instructions || `${c.dim}(empty)${c.reset}`);
}

function createNewSkill(name: string, options: SkillsOptions): void {
  try {
    const scope = options.global ? 'global' : 'project';
    const skill = createSkill(name, { scope, force: options.force });

    if (options.json) {
      console.log(JSON.stringify(skill, null, 2));
      return;
    }

    success(`Created ${scope} skill: ${skill.id}`);
    console.log(`  ${c.dim}${formatPath(skill.filePath)}${c.reset}`);
    console.log();
    console.log(`${c.dim}Use it:${c.reset} kelyra run --file TASK.md -s ${skill.id}`);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

function printSkillCheck(name?: string, asJson?: boolean): void {
  const result = checkSkills(name);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  console.log(heading(name ? `Check Skill ${name}` : 'Check Skills'));
  if (result.checked === 0 && result.issues.length === 0) {
    info('No skills found to check.');
    return;
  }

  if (result.issues.length === 0) {
    success(`Checked ${result.checked} skill(s). No issues found.`);
    return;
  }

  for (const issue of result.issues) {
    printIssue(issue);
  }

  console.log();
  if (result.ok) {
    warn(`Checked ${result.checked} skill(s). Warnings found.`);
  } else {
    error(`Checked ${result.checked} skill(s). Errors found.`);
    process.exitCode = 1;
  }
}

function printIssue(issue: SkillCheckIssue): void {
  const label = issue.level === 'error'
    ? `${theme.error}ERROR${c.reset}`
    : `${theme.warning}WARN${c.reset}`;
  console.log(`  ${label} ${c.bold}${issue.scope}${c.reset} ${formatPath(issue.path)}`);
  console.log(`       ${c.dim}${issue.message}${c.reset}`);
}

function formatPath(filePath: string): string {
  const home = os.homedir();
  if (filePath === home || filePath.startsWith(home + path.sep)) {
    return '~' + filePath.slice(home.length);
  }

  const relative = path.relative(process.cwd(), filePath);
  const escapesCwd = relative === '..' || relative.startsWith(`..${path.sep}`);
  if (relative && !escapesCwd && !path.isAbsolute(relative)) {
    return relative || '.';
  }

  return filePath;
}
