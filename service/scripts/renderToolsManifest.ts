/**
 * 渲染 pi 扩展的**静态工具清单**文件内容（纯函数，便于测试比对漂移）。
 *
 * 产物：`.pi/extensions/gofund/tools.manifest.ts` —— service 未启动时 pi 用它注册工具。
 * 生成入口：`bun run gen:tools`；漂移守卫：`src/__tests__/agent/toolsManifest.test.ts`。
 */
import { agentToolManifest } from '../src/agent/tools.js';

export function renderToolsManifest(): string {
  const manifest = agentToolManifest();
  return `/**
 * 自动生成，请勿手改 —— 用 \`bun run gen:tools\`（service/scripts/gen-tools-manifest.ts）重新生成。
 *
 * service 未启动时，pi 扩展用它注册工具（否则模型连工具名都看不到，只会报「没有工具」）。
 */
export const STATIC_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;
`;
}
