// ─────────────────────────────────────────────────────────────
//  kelyra :: session.ts
//  Session persistence — save/resume conversation state
//  Single JSON file, atomic writes, versioned format
// ─────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Message } from './providers/types.js';

const SESSION_VERSION = 1;
const SESSIONS_DIR = join(homedir(), '.kelyra', 'sessions');
const SESSION_FILE = join(SESSIONS_DIR, 'latest.json');
const SESSION_TMP = join(SESSIONS_DIR, 'latest.tmp');

// ── Serialized Session Format ────────────────────────────────
export interface SessionData {
  version: number;
  timestamp: string;
  project: string;
  history: Message[];
  budget: {
    inputTokens: number;
    outputTokens: number;
    turns: number;
  };
}

// ── Save Session (atomic write) ──────────────────────────────
export function saveSession(
  history: Message[],
  budget: { inputTokens: number; outputTokens: number; turns: number },
  project: string,
): void {
  const data: SessionData = {
    version: SESSION_VERSION,
    timestamp: new Date().toISOString(),
    project,
    history,
    budget,
  };

  mkdirSync(SESSIONS_DIR, { recursive: true });

  // Write to tmp first, then atomic rename
  writeFileSync(SESSION_TMP, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(SESSION_TMP, SESSION_FILE);
}

// ── Load Session ─────────────────────────────────────────────
export function loadSession(): SessionData | null {
  if (!existsSync(SESSION_FILE)) return null;

  try {
    const raw = readFileSync(SESSION_FILE, 'utf-8');
    const data = JSON.parse(raw);

    // Version guard — silently ignore incompatible sessions
    if (data.version !== SESSION_VERSION) return null;

    // Basic shape validation
    if (!Array.isArray(data.history) || !data.budget || !data.timestamp) return null;

    return data as SessionData;
  } catch {
    return null;
  }
}

// ── Format resume info for terminal ──────────────────────────
export function formatResumeInfo(session: SessionData): string {
  const date = new Date(session.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString();
  const totalTokens = session.budget.inputTokens + session.budget.outputTokens;
  return `Resuming session from ${dateStr} ${timeStr} (${session.history.length} messages, ${totalTokens.toLocaleString()} tokens, ${session.budget.turns} turns)`;
}
