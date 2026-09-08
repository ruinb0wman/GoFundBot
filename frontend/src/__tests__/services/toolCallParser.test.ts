import { describe, expect, it } from 'vitest'
import { extractToolCalls, sanitizeAssistantContent, parseParamValue, unescapeXml } from '../../services/chatEngine/toolCallParser'

describe('extractToolCalls', () => {
  it('extracts a single invoke with a JSON array parameter', () => {
    const content = `我在分析行业。
<ai_tool_calls>
   <invoke name="get_hot_sectors">
   <parameter name="limit">15</parameter>
   </invoke>
</ai_tool_calls>
请稍候。`
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ name: 'get_hot_sectors', source: 'xml' })
    expect(calls[0].args).toEqual({ limit: 15 })
    expect(cleaned).toBe('我在分析行业。\n\n请稍候。')
  })

  it('extracts multiple invokes from one block', () => {
    const content = `<ai_tool_calls>
    <invoke name="get_hot_sectors"><parameter name="limit">10</parameter></invoke>
    <invoke name="get_market_indices"></invoke>
  </ai_tool_calls>`
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toHaveLength(2)
    expect(calls[0].name).toBe('get_hot_sectors')
    expect(calls[1]).toMatchObject({ name: 'get_market_indices', args: {} })
    expect(cleaned).not.toMatch(/<ai_tool_calls|<invoke/)
  })

  it('parses JSON-typed parameter values (array / object / number / boolean)', () => {
    const content = `<ai_tool_calls>
    <invoke name="get_funds_by_industry"><parameter name="keyword">["半导体","新能源"]</parameter></invoke>
    <invoke name="run_backtest"><parameter name="amount">1000.5</parameter><parameter name="investment_type">monthly</parameter></invoke>
  </ai_tool_calls>`
    const { calls } = extractToolCalls(content)
    expect(calls[0].args).toEqual({ keyword: ['半导体', '新能源'] })
    expect(calls[1].args).toEqual({ amount: 1000.5, investment_type: 'monthly' })
  })

  it('keeps plain-text (non-JSON) values as strings', () => {
    const content = `<ai_tool_calls><invoke name="search_news"><parameter name="query">碳中和 政策</parameter><parameter name="max_results">5</parameter></invoke></ai_tool_calls>`
    const { calls } = extractToolCalls(content)
    expect(calls[0].args).toEqual({ query: '碳中和 政策', max_results: 5 })
  })

  it('unescapes XML entities in values', () => {
    expect(parseParamValue('a &lt;b&gt; &amp; &quot;c&quot;')).toBe('a <b> & "c"')
    expect(unescapeXml('&#20013;&#25991;')).toBe('中文')
  })

  it('supports single-quoted attributes and multi-line values', () => {
    const content = `<ai_tool_calls>
    <invoke name='get_hot_sectors'>
      <parameter name='limit'>3</parameter>
    </invoke>
  </ai_tool_calls>`
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toEqual([{ name: 'get_hot_sectors', args: { limit: 3 }, source: 'xml' }])
    expect(cleaned.trim()).toBe('')
  })

  it('is case-insensitive on tags and attribute names', () => {
    const content = `<AI_TOOL_CALLS><INVOKE NAME="get_market_indices"></INVOKE></AI_TOOL_CALLS>`
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('get_market_indices')
    expect(cleaned).toBe('')
  })

  it('drops an unterminated ai_tool_calls block (and everything after it)', () => {
    const content = '开头文字\n<ai_tool_calls>\n<invoke name="get_hot_sectors"><parameter name="limit">5</parameter></invoke>'
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toHaveLength(1)
    expect(cleaned).toBe('开头文字\n')
  })

  it('consumes a truncated invoke to the end of a closed block', () => {
    const content = '<ai_tool_calls><invoke name="search_funds"><parameter name="keyword">白酒</parameter></ai_tool_calls>'
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toEqual([{ name: 'search_funds', args: { keyword: '白酒' }, source: 'xml' }])
    expect(cleaned).toBe('')
  })

  it('does not execute stray <invoke> outside an ai_tool_calls block, and sanitizes it', () => {
    const content = '请使用工具 <invoke name="search_funds"><parameter name="keyword">消费</parameter></invoke> 查询。'
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toHaveLength(0)
    expect(cleaned).not.toMatch(/<invoke|<parameter/)
    expect(cleaned).toBe('请使用工具  查询。')
  })

  it('returns content untouched when no tool markup exists', () => {
    const content = '纯概念问题，不涉及数据查询。'
    const { calls, cleaned } = extractToolCalls(content)
    expect(calls).toHaveLength(0)
    expect(cleaned).toBe(content)
  })
})

describe('sanitizeAssistantContent', () => {
  it('strips complete blocks and leftover standalone tags', () => {
    const content = 'aa<ai_tool_calls><invoke name="x"><parameter name="y">1</parameter></invoke></ai_tool_calls>bb'
    expect(sanitizeAssistantContent(content)).toBe('aabb')
  })

  it('keeps markdown intact', () => {
    const markdown = '## 标题\n- 列表项\n**重点** `代码`\n| 表格 | 列 |\n| --- | --- |'
    expect(sanitizeAssistantContent(markdown)).toBe(markdown)
  })

  it('drops unterminated block tags with the remainder', () => {
    expect(sanitizeAssistantContent('前<ai_tool_calls>后')).toBe('前')
    expect(sanitizeAssistantContent('前<available_tools>后')).toBe('前')
  })

  it('strips a lone inline open tag but keeps following prose', () => {
    expect(sanitizeAssistantContent('见 <parameter name="x">正文继续')).toBe('见 正文继续')
  })

  it('handles empty / nullish content', () => {
    expect(sanitizeAssistantContent('')).toBe('')
    expect(sanitizeAssistantContent(null as unknown as string)).toBeNull()
  })
})
