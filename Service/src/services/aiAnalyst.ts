import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { logger } from '../core/logger.js';

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

const PERFORMANCE_PROMPT = loadPrompt('performanceAnalyst.txt');
const HOLDING_PROMPT = loadPrompt('holdingAnalyst.txt');
const MANAGER_PROMPT = loadPrompt('managerAnalyst.txt');
const MARKET_PROMPT = loadPrompt('marketAnalyst.txt');
const SUPERVISOR_PROMPT = loadPrompt('supervisor.txt');

export interface AnalystInput {
  fundCode: string;
  fundName: string;
  fundType?: string;
  netWorthTrend?: Array<{ date: string; netWorth: number }>;
  riskMetrics?: Record<string, number | null>;
  holdings?: Array<{ name?: string; code?: string; ratio?: number }>;
  managers?: Array<{
    name?: string;
    workExperience?: number;
    managedFundSize?: string;
  }>;
  industryTag?: string;
  marketContext?: string;
}

interface AnalystReport {
  analyst_role: string;
  thesis: string;
  score: number;
  key_evidence: string[];
  risk_flags: string[];
}

interface SupervisorOutput {
  rating: 'Strong Buy' | 'Buy' | 'Hold' | 'Underweight' | 'Sell';
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

export interface FundAnalysisResult {
  fund_code: string;
  fund_name: string;
  reports: AnalystReport[];
  supervisor: SupervisorOutput | null;
}

function getClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  const apiBase = process.env.LLM_API_BASE || 'https://api.siliconflow.cn/v1';
  const model = process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B';
  return new OpenAI({ apiKey, baseURL: apiBase });
}

async function callAnalyst(
  role: string,
  systemPrompt: string,
  fundInfo: string,
  extra: string,
): Promise<AnalystReport> {
  const client = getClient();
  const userPrompt = `基金信息：\n${fundInfo}\n\n详细数据：\n${extra}\n\n请进行分析并输出JSON。`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`Empty response from ${role} analyst`);
    }

    const parsed = JSON.parse(extractJson(content)) as Partial<AnalystReport>;
    return {
      analyst_role: role,
      thesis: parsed.thesis ?? '',
      score: typeof parsed.score === 'number' ? parsed.score : 5,
      key_evidence: Array.isArray(parsed.key_evidence) ? parsed.key_evidence : [],
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [],
    };
  } catch (err) {
    logger.error(`AI analyst ${role} failed`, { error: String(err) });
    return {
      analyst_role: role,
      thesis: `${role}分析师调用异常，分析未完成`,
      score: 5,
      key_evidence: [`${role}分析师：LLM API 调用失败`],
      risk_flags: [],
    };
  }
}

async function callSupervisor(
  reports: AnalystReport[],
  fundInfo: string,
): Promise<SupervisorOutput | null> {
  const client = getClient();
  const reportsStr = reports
    .map(
      (r) =>
        `### ${r.analyst_role}\n评分：${r.score}/10\n核心论点：${r.thesis}\n关键证据：${r.key_evidence.join(', ')}`,
    )
    .join('\n\n');

  const userPrompt = `基金信息：\n${fundInfo}\n\n分析师报告：\n${reportsStr}\n\n请综合四位分析师观点，输出最终裁决JSON。`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
      messages: [
        { role: 'system', content: SUPERVISOR_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(extractJson(content)) as SupervisorOutput;
  } catch (err) {
    logger.error('Supervisor synthesis failed', { error: String(err) });
    return null;
  }
}

export async function analyzeFund(input: AnalystInput): Promise<FundAnalysisResult> {
  const fundInfo =
    `代码：${input.fundCode}\n名称：${input.fundName}\n类型：${input.fundType ?? '未知'}`;

  const perfExtra = [
    input.riskMetrics ? `风险指标：${JSON.stringify(input.riskMetrics, null, 2)}` : '',
    input.netWorthTrend ? `净值数据：${input.netWorthTrend.length} 个数据点` : '',
    `行业标签：${input.industryTag ?? '未知'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const holdingExtra = input.holdings
    ? `持仓数据：\n${input.holdings.map((h) => `- ${h.name ?? h.code ?? '未知'}: ${h.ratio ? (h.ratio * 100).toFixed(2) + '%' : '未知'}`).join('\n')}`
    : '暂无持仓数据';

  const managerExtra = input.managers
    ? `经理信息：\n${input.managers.map((m) => `- ${m.name ?? '未知'}：从业${m.workExperience ?? '未知'}年，管理规模${m.managedFundSize ?? '未知'}`).join('\n')}`
    : '暂无经理信息';

  const marketExtra =
    input.marketContext ?? `行业标签：${input.industryTag ?? '未知'}`;

  const [perfReport, holdingReport, managerReport, marketReport] = await Promise.all([
    callAnalyst('performance', PERFORMANCE_PROMPT, fundInfo, perfExtra),
    callAnalyst('holding', HOLDING_PROMPT, fundInfo, holdingExtra),
    callAnalyst('manager', MANAGER_PROMPT, fundInfo, managerExtra),
    callAnalyst('market', MARKET_PROMPT, fundInfo, marketExtra),
  ]);

  const reports = [perfReport, holdingReport, managerReport, marketReport];

  const supervisor = await callSupervisor(reports, fundInfo);

  return {
    fund_code: input.fundCode,
    fund_name: input.fundName,
    reports,
    supervisor,
  };
}

export async function* analyzeFundStream(
  input: AnalystInput,
): AsyncGenerator<{ stage: string; content: string }> {
  yield { stage: 'start', content: `开始分析 ${input.fundName}` };

  yield { stage: 'stage', content: 'performance分析师工作中...' };
  const fundInfo =
    `代码：${input.fundCode}\n名称：${input.fundName}\n类型：${input.fundType ?? '未知'}`;
  const perfExtra = input.riskMetrics
    ? JSON.stringify(input.riskMetrics, null, 2)
    : '暂无风险数据';

  const perfReport = await callAnalyst('performance', PERFORMANCE_PROMPT, fundInfo, perfExtra);
  yield { stage: 'token', content: JSON.stringify(perfReport) };

  yield { stage: 'stage', content: 'holding分析师工作中...' };
  const holdingExtra = input.holdings
    ? JSON.stringify(input.holdings)
    : '暂无持仓数据';
  const holdingReport = await callAnalyst('holding', HOLDING_PROMPT, fundInfo, holdingExtra);
  yield { stage: 'token', content: JSON.stringify(holdingReport) };

  yield { stage: 'stage', content: 'manager分析师工作中...' };
  const managerExtra = input.managers
    ? JSON.stringify(input.managers)
    : '暂无经理信息';
  const managerReport = await callAnalyst('manager', MANAGER_PROMPT, fundInfo, managerExtra);
  yield { stage: 'token', content: JSON.stringify(managerReport) };

  yield { stage: 'stage', content: 'market分析师工作中...' };
  const marketExtra =
    input.marketContext ?? `行业标签：${input.industryTag ?? '未知'}`;
  const marketReport = await callAnalyst('market', MARKET_PROMPT, fundInfo, marketExtra);
  yield { stage: 'token', content: JSON.stringify(marketReport) };

  yield { stage: 'stage', content: '总监合成最终报告...' };
  const reports = [perfReport, holdingReport, managerReport, marketReport];
  const supervisor = await callSupervisor(reports, fundInfo);
  yield { stage: 'result', content: JSON.stringify(supervisor) };

  yield { stage: 'done', content: '' };
}

function extractJson(raw: string): string {
  const stripped = raw.trim();
  if (stripped.startsWith('{')) {
    return stripped;
  }
  const jsonMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (objMatch) {
    return objMatch[0];
  }
  return stripped;
}
