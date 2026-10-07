import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { importUserData, type UserDataDump } from '../services/userDataService.js';

/**
 * 一次性导入：把前端 Dexie 里的用户数据搬到 SQLite（P2 迁移用）。
 *
 * 幂等：`importUserData` 只在目标表为空时写入该表，因此重复提交不会产生重复数据。
 */
export const userImportRouter = Router();

userImportRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const raw = req.body as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
    }
    const dump = raw as UserDataDump;
    sendSuccess(res, importUserData(dump));
  })
);
