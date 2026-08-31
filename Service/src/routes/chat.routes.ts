import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { chat } from '../services/chatService.js';

export const chatRouter = Router();

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { messages, skill, llmConfig, strategyContext } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      skill?: string;
      llmConfig?: { apiKey?: string; apiBase?: string; model?: string };
      strategyContext?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ARGUMENT', message: 'messages is required' } });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let closed = false;
    req.on('close', () => { closed = true; });

    try {
      for await (const event of chat(messages, skill, llmConfig, strategyContext !== undefined ? String(strategyContext) : undefined)) {
        if (closed) break;
        res.write(`event: ${event.event}\ndata: ${event.data}\n\n`);
      }
    } catch (error) {
      logger.error('chat SSE error', { error: String(error) });
      if (!closed) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: String(error) })}\n\n`);
      }
    } finally {
      if (!closed) {
        res.end();
      }
    }
  }),
);
