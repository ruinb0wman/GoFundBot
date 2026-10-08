/**
 * 生成 pi 扩展的**静态工具清单**（`service` 未启动时的降级数据源）。
 *
 * 用法（仓库根目录）：`bun run gen:tools`
 *
 * 直接从 `src/agent/tools.ts` 的注册表生成，所以清单永远和 service 一致 —— 不要手改产物。
 * 内容渲染在 `renderToolsManifest.ts`（单测会比对产物，漂移即测试失败）。
 */
import { writeFileSync } from 'node:fs';
import { renderToolsManifest } from './renderToolsManifest.js';
import { agentToolManifest } from '../src/agent/tools.js';

const OUT = new URL('../../.pi/extensions/gofund/tools.manifest.ts', import.meta.url);

writeFileSync(OUT, renderToolsManifest(), 'utf8');

const manifest = agentToolManifest();
console.log(`wrote ${OUT.pathname} (${manifest.count} tools, destructive: ${manifest.destructive.join(',') || 'none'})`);

// 导入 service 模块会带起 pino 等长生命周期句柄，写完就显式退出。
process.exit(0);
