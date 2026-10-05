/**
 * UI-only helper: decide whether a tool result carries no usable data, so the
 * chat chip can show a warning mark instead of a green check.
 *
 * Deliberately conservative — a wrong "empty" mark is worse than a missing one,
 * so we only flag strong signals:
 *   - an empty collection (array) anywhere near the top level
 *   - a payload whose non-meta scalars are all null / empty / zero
 *
 * Note this is *not* about `data_status`. `get_north_flow` always reports
 * `data_status: 'unavailable'` (net inflow is no longer disclosed) while still
 * returning a usable 成交总额 — that must stay green. Zero/empty payloads are
 * judged by value, not by status.
 */

/** Bookkeeping fields that carry no data themselves (the tool's own narrative). */
const META_KEYS = new Set([
  'data_status',
  'note',
  'error',
  'source',
  'provider',
  'status',
  'success',
  'reason',
  'message',
  'scope',
  'date',
  'data_date',
  'update_time',
  'updatedAt',
  'timestamp',
  'stale',
  'fallback',
  'count',
  'total',
  'total_count',
  'page',
  'pageSize',
  'pageNumber',
  'limit',
  'offset',
  'asOf',
  'net_inflow_available',
])

/**
 * `true` when nothing usable came back. Arrays count as data by length alone,
 * numbers by being finite and non-zero, strings by being non-blank.
 */
export function isEmptyToolResult(result: unknown): boolean {
  return !hasPayload(result, 0)
}

function hasPayload(value: unknown, depth: number): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0

  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) && value !== 0
    case 'string':
      return value.trim() !== ''
    case 'boolean':
      // Flags like `net_inflow_available: false` are status, not payload.
      return false
    case 'object':
      break
    default:
      return false
  }

  // One nested hop (e.g. `{ data: { items: [...] } }`) is enough in practice.
  if (depth >= 2) return false

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (META_KEYS.has(key)) continue
    if (hasPayload(entry, depth + 1)) return true
  }
  return false
}
