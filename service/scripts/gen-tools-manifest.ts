/**
 * 生成 pi 扩展的**静态工具清单**（`service` 未启动时的降级数据源）。
 *
 * 用法（仓库根目录）：`bun run gen:tools`
 *
 * 直接从 `src/agent/tools.ts` 的注册表生成，所以清单永远和 service 一致 —— 不要手改产物。
 */
import { writeFileSync } from 'node:fs';
import { agentToolManifest } from '../src/agent/tools.js';

const OUT = new URL('../../.pi/extensions/gofund/tools.manifest.ts', import.meta.url);

const manifest = agentToolManifest();
const body = `/**
 * 自动生成，请勿手改 —— 用 \`bun run gen:tools\`（service/scripts/gen-tools-manifest.ts）重新生成。
 *
 * service 未启动时，pi 扩展用它注册工具（否则模型连工具名都看不到，只会报「没有工具」）。
 */
export const STATIC_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;
`;

writeFileSync(OUT, body, 'utf8');
console.log(`wrote ${OUT.pathname} (${manifest.count} tools, destructive: ${manifest.destructive.join(',') || 'none'})`);

// 导入 service 模块会带起 pino 等长生命周期句柄，写完就显式退出。
process.exit(0);
