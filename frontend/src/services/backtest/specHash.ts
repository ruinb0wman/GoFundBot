/**
 * Stable hash of a BacktestSpec — used as a Dexie index so a past run can be found
 * without comparing objects, and (Phase 2) so AI-authored strategy source can be
 * tied to the run it produced. Pure and dependency-free.
 */

import type { BacktestSpec } from './backtestTypes';

/** FNV-1a over a key-sorted JSON dump: stable across key order, cheap, no deps. */
export function specHash(spec: BacktestSpec): string {
  const canonical = JSON.stringify(spec, Object.keys(spec).sort());
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
