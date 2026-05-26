// ─────────────────────────────────────────────────────────────
//  kelyra :: sqlite-loader.ts
//  Centralized SQLite loader — single loading strategy
//
//  Uses createRequire for CJS-compatible synchronous loading
//  of node:sqlite, which is experimental in Node 22+.
//  All SQLite consumers import from this module.
// ─────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';

let _DatabaseSync: any = null;
let _loadAttempted = false;

/**
 * Returns the DatabaseSync constructor from node:sqlite.
 * Lazily loaded on first call. Throws with a clear message
 * if node:sqlite is not available.
 */
export function getDatabaseSync(): typeof import('node:sqlite').DatabaseSync {
  if (_DatabaseSync) return _DatabaseSync;
  if (_loadAttempted) {
    throw new Error(
      'node:sqlite is not available. Requires Node.js 22+ with native SQLite support.',
    );
  }

  _loadAttempted = true;
  try {
    const require = createRequire(import.meta.url);
    const mod = require('node:sqlite');
    _DatabaseSync = mod.DatabaseSync;
    return _DatabaseSync;
  } catch {
    throw new Error(
      'node:sqlite is not available. Requires Node.js 22+ with native SQLite support.',
    );
  }
}
