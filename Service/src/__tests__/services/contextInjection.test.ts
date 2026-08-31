import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../services/chatService.js';
import { strategyNote } from '../../services/aiAnalyst.js';

describe('Strategy context injection helpers', () => {
  describe('buildSystemPrompt', () => {
    it('appends the user strategy section when strategyContext is provided', () => {
      const base = '系统提示';
      const out = buildSystemPrompt(base, '### 1. 稳健定投\n内容：每月定投');
      expect(out.startsWith(base)).toBe(true);
      expect(out).toContain('## 用户策略记忆');
      expect(out).toContain('稳健定投');
    });

    it('returns the base prompt unchanged without strategy context', () => {
      expect(buildSystemPrompt('base', undefined)).toBe('base');
      expect(buildSystemPrompt('base', '   ')).toBe('base');
    });
  });

  describe('strategyNote', () => {
    it('returns empty string without context', () => {
      expect(strategyNote()).toBe('');
      expect(strategyNote('   ')).toBe('');
    });

    it('wraps context in a labelled section', () => {
      const out = strategyNote('规则内容');
      expect(out).toContain('## 用户投资策略');
      expect(out).toContain('规则内容');
    });
  });
});
