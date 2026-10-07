/**
 * pi 的工具面：清单 + 调用。
 *
 * - `GET /api/agent/tools` —— 工具清单（name/description/JSON Schema/readOnly）。
 *   pi 扩展启动时拉它并逐个注册，所以「工具契约」只有 service 一份。
 * - `POST /api/agent/call {tool, args}` —— 校验参数 → 执行 → 结果截断。
 *
 * 语义：**结构错误**（未知工具、参数不合 Schema）→ 400；
 * **写操作** → 200 + `{confirm_required: true, token, message}`（带令牌再调一次才落库）；
 * **数据问题**（取不到数）→ 200 + 业务对象里的 `error` 字段（同回测路由）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { sendSuccess } from '../core/response.js';
import { consumeConfirmToken, issueConfirmToken } from '../agent/confirm.js';
import { agentToolManifest, findAgentTool } from '../agent/tools.js';
import { unwrapServiceResult } from '../agent/types.js';

export const agentRouter = Router();

/** 模型侧结果的字符上限（超过就只给预览，避免一次调用吃掉整个上下文）。 */
const MAX_RESULT_CHARS = 30_000;

function bound(result: unknown): unknown {
  const text = JSON.stringify(result) ?? 'null';
  if (text.length <= MAX_RESULT_CHARS) return result;
  return {
    truncated: true,
    note: `结果超过 ${MAX_RESULT_CHARS} 字符已截断；请缩小时间范围 / 减少 limit / 改用更具体的工具后重试。`,
    preview: text.slice(0, MAX_RESULT_CHARS),
  };
}

agentRouter.get(
  '/tools',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, agentToolManifest());
  })
);

agentRouter.post(
  '/call',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { tool?: unknown; args?: unknown };
    const name = typeof body.tool === 'string' ? body.tool.trim() : '';
    if (!name) throw new AppError('INVALID_ARGUMENT', 'tool is required', 400);

    const tool = findAgentTool(name);
    if (!tool) {
      throw new AppError('INVALID_ARGUMENT', `unknown tool: ${name}`, 400, {
        known_tools: agentToolManifest().tools.map((item) => item.name),
      });
    }

    const rawArgs = (body.args ?? {}) as Record<string, unknown>;
    const parsed = tool.params.safeParse(rawArgs);
    if (!parsed.success) {
      throw new AppError('INVALID_ARGUMENT', `invalid args for ${name}`, 400, {
        issues: z.treeifyError(parsed.error),
      });
    }
    const args = parsed.data as Record<string, unknown>;

    if (!tool.readOnly) {
      const token = typeof args.__confirm_token === 'string' ? args.__confirm_token : '';
      if (!token) {
        sendSuccess(res, {
          confirm_required: true,
          tool: name,
          token: issueConfirmToken(name, args),
          message: `「${tool.label}」会写入数据：请先把内容完整展示给用户并取得明确同意，再带上 __confirm_token 重新调用。`,
        });
        return;
      }
      const check = consumeConfirmToken(token, name, args);
      if (!check.ok) throw new AppError('INVALID_ARGUMENT', check.reason, 400, { confirm_invalid: true });
    }

    const startedAt = Date.now();
    try {
      const result = bound(unwrapServiceResult(await tool.handler(args as never)));
      logger.info('agent tool call', {
        tool: name,
        durationMs: Date.now() - startedAt,
        readOnly: tool.readOnly,
      });
      sendSuccess(res, { tool: name, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('agent tool failed', { tool: name, error: message });
      // 取数类失败不当 HTTP 错误：让模型读到消息并决定怎么补救。
      sendSuccess(res, { tool: name, error: message });
    }
  })
);
