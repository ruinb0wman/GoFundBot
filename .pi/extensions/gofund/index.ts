/**
 * GoFundBot data tools — project pi extension.
 *
 * Gives a terminal pi session read-only access to this repo's market/fund/news
 * data by calling the running service (default http://localhost:8310). It adds
 * no service code and touches no frontend file.
 *
 * Not included on purpose: backtest, 4433 screening, industry classification,
 * my positions / saved strategy scripts, and web search — those still live in
 * the web frontend (browser IndexedDB / Web Worker / localStorage keys).
 *
 * See README.md for the endpoint table and `../../skills/gofund-data/SKILL.md` for
 * when/how the tools should be used.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fundTools } from './tools/fund.ts'
import { marketTools } from './tools/market.ts'
import { newsTools } from './tools/news.ts'

export default function gofundDataExtension(pi: ExtensionAPI): void {
  for (const tool of [...marketTools, ...fundTools, ...newsTools]) {
    pi.registerTool(tool)
  }
}
