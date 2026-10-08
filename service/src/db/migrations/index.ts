import { migration001 } from './001_init.js';
import { migration002 } from './002_user_data.js';
import { migration003 } from './003_screening_cache.js';
import { migration004 } from './004_nav_cache.js';
import { migration005 } from './005_alerts.js';
import { migration006 } from './006_portfolio.js';
import type { Migration } from './types.js';

export type { Migration } from './types.js';

/** 顺序即版本顺序；只追加，不改已发布的迁移。 */
export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
];
