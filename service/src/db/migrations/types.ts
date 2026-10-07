import type { DatabaseSync } from 'node:sqlite';

/** 一次 schema 变更。只追加，不改已发布的迁移（版本号即顺序）。 */
export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}
