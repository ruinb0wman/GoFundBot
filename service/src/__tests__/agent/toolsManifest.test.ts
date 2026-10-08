import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * 漂移守卫：提交的静态工具清单必须与 `src/agent/` 的注册表一致。
 * 改了工具没跑 `bun run gen:tools` → 这个测试会失败（`bun run check` 会拦住）。
 */
describe('pi 静态工具清单', () => {
  it('与 service 工具注册表逐字一致', async () => {
    const { renderToolsManifest } = await import('../../../scripts/renderToolsManifest.js');
    const committed = readFileSync(
      new URL('../../../../.pi/extensions/gofund/tools.manifest.ts', import.meta.url),
      'utf8'
    );
    expect(committed).toBe(renderToolsManifest());
  });
});
