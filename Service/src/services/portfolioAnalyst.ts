import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { logger } from '../core/logger.js';
import { getLlmSettings } from './settingsService.js';
import { getFundDetail } from './fundService.js';
import type { FundDetailDto } from '../types/fund.js';

const _DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = join(_DIR, '../prompts');

function loadPrompt(name: string): string {
  const p = join(PROMPT_DIR, name);
  if (!existsSync(p)) {
    logger.warn('Prompt file not found', { name, path: p });
    return '';
  }
  return readFileSync(p, 'utf-8').trim();
}

const PORTFOLIO_PROMPT = loadPrompt('portfolioAnalyst.txt');

export interface PortfolioFundInput {
  code: string;
  share?: number;
  cost?: number;
  weight_pct?: number;
}

export interface PortfolioAnalysisRequest {
  funds: PortfolioFundInput[];
  strategyContext?: string;
}

export interface PortfolioAnalysisResult {
  fund_code: string;
  fund_name: string;
  rating: string | null;
  sentiment_score: number;
  operation_advice: string;
  summary: string;
  dashboard: {
    performance_eval: string;
    manager_ability: string;
    position_analysis: string;
    market_outlook: string;
  };
  highlights: string[];
  risk_factors: string[];
  news_intel: string[];
  detailed_report: string;
}

const MAX_FUNDS = 20;

function extractJson(raw: string): string {
  const stripped = raw.trim();
  if (stripped.startsWith('{')) return stripped;
  const jsonMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return jsonMatch[1].trim();
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return stripped;
}

function formatWeight(input: PortfolioFundInput): string {
  if (input.weight_pct != null && input.weight_pct > 0) {
    return `权重${input.weight_pct.toFixed(1)}%`;
  }
  return '';
}

function buildPortfolioContext(
  inputs: PortfolioFundInput[],
  details: Map<string, FundDetailDto | null>,
): string {
  const lines = inputs.map((f) => {
    const detail = details.get(f.code);
    const basic = detail?.sections.basic.data;
    const perf = detail?.sections.performance.data;
    const holdings = detail?.sections.holdings.data?.items?.slice(0, 5) ?? [];
    const parts = [
      `- ${basic?.name ?? f.code}（${f.code}）${basic?.type ?? ''}`,
      formatWeight(f),
      perf?.return1m != null ? `近1月${perf.return1m >= 0 ? '+' : ''}${(perf.return1m * 100).toFixed(2)}%` : '',
      perf?.return3m != null ? `近3月${perf.return3m >= 0 ? '+' : ''}${(perf.return3m * 100).toFixed(2)}%` : '',
      holdings.length > 0
        ? `重仓：${holdings.map((h) => `${h.stockName ?? h.stockCode}${h.ratio != null ? ` ${(h.ratio * 100).toFixed(1)}%` : ''}`).join('、')}`
        : '',
    ].filter(Boolean);
    return parts.join(' · ');
  });
  return lines.length > 0 ? `## 持仓明细\n${lines.join('\n')}` : '暂无持仓明细';
}

export function fallbackPortfolioResult(inputs: PortfolioFundInput[], missingKey = false): PortfolioAnalysisResult {
  const count = inputs.length;
  const reason = missingKey
    ? 'AI 服务未配置：请先在设置中配置 AI 服务密钥，再进行组合诊断。'
    : 'AI 组合诊断生成失败，请稍后重试。';
  return {
    fund_code: '',
    fund_name: '我的持仓',
    rating: null,
    sentiment_score: 50,
    operation_advice: reason,
    summary: `共 ${count} 只基金，数据已汇总，但未能生成完整诊断。${reason}`,
    dashboard: {
      performance_eval: '—',
      manager_ability: '—',
      position_analysis: '—',
      market_outlook: '—',
    },
    highlights: [],
    risk_factors: [],
    news_intel: [],
    detailed_report: `## 组合概况\n共持有 ${count} 只基金。\n\n## 提示\n${reason}`,
  };
}

export async function analyzePortfolio(req: PortfolioAnalysisRequest): Promise<PortfolioAnalysisResult> {
  const inputs = (req.funds ?? []).slice(0, MAX_FUNDS);
  if (inputs.length === 0) {
    return fallbackPortfolioResult([], false);
  }

  const llm = getLlmSettings();
  if (!llm.apiKey) {
    logger.warn('Portfolio analysis skipped: LLM not configured');
    return fallbackPortfolioResult(inputs, true);
  }

  // Fetch fund details in parallel, tolerating individual failures.
  const settled = await Promise.allSettled(inputs.map((f) => getFundDetail(f.code)));
  const details = new Map<string, FundDetailDto | null>();
  settled.forEach((s, i) => {
    const code = inputs[i]?.code ?? '';
    if (s.status === 'fulfilled') {
      details.set(code, s.value.data ?? null);
    } else {
      details.set(code, null);
    }
  });

  const portfolioCtx = buildPortfolioContext(inputs, details);
  const strategyCtx = req.strategyContext?.trim()
    ? `## 用户投资策略\n分析师给出建议时需贴合用户的策略取向，但不得为迎合策略而歪曲数据。\n${req.strategyContext.trim()}`
    : '';

  const userPrompt = [portfolioCtx, strategyCtx].filter(Boolean).join('\n\n');
  const model = llm.model || 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B';

  try {
    const client = new OpenAI({ apiKey: llm.apiKey, baseURL: llm.apiBase || 'https://api.siliconflow.cn/v1' });
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PORTFOLIO_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty portfolio analysis response');

    const parsed = JSON.parse(extractJson(content)) as Partial<PortfolioAnalysisResult>;
    return {
      fund_code: '',
      fund_name: '我的持仓',
      rating: typeof parsed.rating === 'string' ? parsed.rating : null,
      sentiment_score: typeof parsed.sentiment_score === 'number' ? Math.max(0, Math.min(100, parsed.sentiment_score)) : 50,
      operation_advice: parsed.operation_advice ?? '',
      summary: parsed.summary ?? '',
      dashboard: {
        performance_eval: parsed.dashboard?.performance_eval ?? '—',
        manager_ability: parsed.dashboard?.manager_ability ?? '—',
        position_analysis: parsed.dashboard?.position_analysis ?? '—',
        market_outlook: parsed.dashboard?.market_outlook ?? '—',
      },
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors : [],
      news_intel: Array.isArray(parsed.news_intel) ? parsed.news_intel : [],
      detailed_report: parsed.detailed_report ?? '',
    };
  } catch (err) {
    logger.error('Portfolio analysis failed', { error: String(err) });
    return fallbackPortfolioResult(inputs, false);
  }
}
