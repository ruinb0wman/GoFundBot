/**
 * Tool-call extraction & content sanitization.
 *
 * Models that do not speak the OpenAI-native `tool_calls` protocol (e.g. Qwen2.5 on
 * SiliconFlow) emit their invocations as a `<ai_tool_calls>` XML block inside content.
 * This module normalizes that transport at the boundary: parse the block into typed
 * ParsedToolCall[] and always strip every tool marker from assistant content, so tool
 * markup can never leak into chat display or history.
 */

export interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
  source: 'native' | 'xml'
}

const AI_TOOL_CALLS_RE = /<ai_tool_calls\b[^>]*>/gi
const INVOKE_RE = /<invoke\b[^>]*>/gi
const PARAMETER_RE = /<parameter\b[^>]*>/gi

/** Block-style tags: unterminated occurrences cause the remainder to be dropped. */
const BLOCK_TAGS = ['ai_tool_calls', 'available_tools']
/** Inline tags: unterminated occurrences drop only up to the next `<`. */
const INLINE_TAGS = ['invoke', 'parameter', 'tool']

function readAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  if (!m) return null
  return m[1] ?? m[2] ?? null
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&') // last: &amp; may be produced by the replacements above
}

/** Parse a parameter value: JSON when it looks like JSON, otherwise plain text. */
export function parseParamValue(raw: string): unknown {
  const t = unescapeXml(raw).trim()
  if (t === '') return ''
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

function findClose(inner: string, tagName: string): number {
  const re = new RegExp(`<\\/${tagName}\\s*>`, 'i')
  const m = re.exec(inner)
  return m && m.index !== undefined ? m.index : -1
}

function findNextOpen(source: string, re: RegExp, start: number): { open: RegExpExecArray | null; index: number } {
  re.lastIndex = start
  const m = re.exec(source)
  return { open: m, index: m !== null && m.index !== undefined ? m.index : -1 }
}

function matchTag(re: RegExp, source: string, start = 0): RegExpExecArray | null {
  re.lastIndex = start
  return re.exec(source)
}

/** Extract the inner contents of every <ai_tool_calls>…</ai_tool_calls> block. */
function collectBlocks(content: string): string[] {
  const blocks: string[] = []
  let cursor = 0
  for (;;) {
    const { open, index } = findNextOpen(content, AI_TOOL_CALLS_RE, cursor)
    if (!open || index < 0) break
    const after = index + open[0].length
    const closeIdx = findClose(content.slice(after), 'ai_tool_calls')
    if (closeIdx < 0) {
      blocks.push(content.slice(after))
      break // unterminated block consumes the rest of the content
    }
    blocks.push(content.slice(after, after + closeIdx))
    cursor = after + closeIdx
  }
  return blocks
}

function parseInvoke(block: string, start: number): { name: string | null; args: Record<string, unknown>; cursor: number } {
  const open = matchTag(INVOKE_RE, block, start)
  if (!open || open.index === undefined) {
    return { name: null, args: {}, cursor: block.length }
  }
  const token = open[0]
  // `open.index` is block-relative, so the body starts at index + token.length
  const bodyStart = open.index + token.length
  const closeIdx = findClose(block.slice(bodyStart), 'invoke')
  const bodyEnd = closeIdx < 0 ? block.length : bodyStart + closeIdx
  const name = readAttr(token, 'name')
  const args: Record<string, unknown> = {}

  let p = bodyStart
  for (;;) {
    const { open: pOpen, index: pIndex } = findNextOpen(block, PARAMETER_RE, p)
    if (!pOpen || pIndex < 0 || pIndex >= bodyEnd) break
    const pToken = pOpen[0]
    const pBodyStart = pIndex + pToken.length
    const pCloseIdx = findClose(block.slice(pBodyStart, bodyEnd), 'parameter')
    const pBodyEnd = pCloseIdx < 0 ? bodyEnd : pBodyStart + pCloseIdx
    const key = readAttr(pToken, 'name')
    if (key) args[key] = parseParamValue(block.slice(pBodyStart, pBodyEnd))
    p = pCloseIdx < 0 ? bodyEnd : pBodyStart + pCloseIdx + '</parameter>'.length
  }

  const cursor = closeIdx < 0 ? bodyEnd : bodyStart + closeIdx + '</invoke>'.length
  return { name, args, cursor }
}

/**
 * Parse a model response: extract XML tool calls and return the cleaned prose.
 * Only `<ai_tool_calls>` blocks are executed; stray `<invoke>` outside blocks is
 * sanitized away but never executed.
 */
export function extractToolCalls(content: string): { calls: ParsedToolCall[]; cleaned: string } {
  const calls: ParsedToolCall[] = []
  const blocks = collectBlocks(content)
  for (const block of blocks) {
    let cursor = 0
    while (cursor < block.length) {
      const { name, args, cursor: next } = parseInvoke(block, cursor)
      if (name) calls.push({ name, args, source: 'xml' })
      if (next <= cursor) break // safety: guarantee progress
      cursor = next
    }
  }
  return { calls, cleaned: sanitizeAssistantContent(content) }
}

/**
 * Strip every tool/envelope marker from assistant content (complete, truncated or
 * standalone). Used on display, persistence and streaming paths as a hard guarantee
 * that no tool markup ever reaches the user.
 */
export function sanitizeAssistantContent(content: string): string {
  if (!content) return content
  return stripElements(stripElements(content, BLOCK_TAGS), INLINE_TAGS)
}

function stripElements(text: string, tags: string[]): string {
  const openRe = new RegExp(`<(${tags.join('|')})\\b[^>]*>`, 'gi')
  const isBlock = (name: string) => BLOCK_TAGS.includes(name)
  let out = ''
  let rest = text
  for (;;) {
    openRe.lastIndex = 0
    const m = openRe.exec(rest)
    if (!m) {
      out += rest
      break
    }
    out += rest.slice(0, m.index)
    const tagName = m[1]
    const after = (m.index ?? 0) + m[0].length
    const tail = rest.slice(after)
    const closeRe = new RegExp(`<\\/${tagName}\\s*>`, 'i')
    const close = closeRe.exec(tail)
    if (close && close.index !== undefined) {
      rest = tail.slice(close.index + close[0].length)
    } else if (isBlock(tagName)) {
      break // unterminated block tag: drop the remainder
    } else {
      // unterminated inline tag: drop only the opening tag, keep the prose after it
      rest = tail
    }
  }
  return out
}
