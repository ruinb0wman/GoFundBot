# 首页数据「请求失败不清空 + 更新时间」修复

## 问题
首页 5 个模块在请求失败时会清空已在内存中的数据，且没有显示更新时间。

## 改动文件: 6 个

### 1. `Frontend/src/composables/useMarketOverview.ts`

**第 14-15 行** — 新增 updateTime refs:
```diff
   const updateTime = ref('')
+  const klineUpdateTime = ref('')
+  const overviewUpdateTime = ref('')
-  let refreshTimer = null
+  let refreshTimer: ReturnType<typeof setInterval> | null = null
```

**第 197-206 行** — `fetchOverview` 加时间戳:
```diff
   const fetchOverview = async () => {
     const response = await marketAPI.getOverview()
     if (response.data.success) {
       const data = response.data
       if (data.market_index?.success) marketIndex.value = data.market_index.data
       if (data.gold_realtime?.success) goldRealtime.value = data.gold_realtime.data
       if (data.a_volume_7days?.success) aVolume.value = data.a_volume_7days.data.slice().reverse()
       updateTime.value = data.update_time
+      overviewUpdateTime.value = new Date().toISOString()
     }
   }
```

**第 208-227 行** — `fetchKline` 修复核心 BUG（部分失败不清空）:
```diff
   const fetchKline = async () => {
     ...
     const codes = { sh: 'sh000001', sz: 'sz399001', hs300: 'sh000300' }
-    const results = { sh: [], sz: [], hs300: [] }
+    const results = { ...indicesIntraday.value }
     const tasks = Object.entries(codes).map(async ([key, code]) => {
       try {
         const res = await marketAPI.getIndexKline(code, { period: 'daily', startDate })
         if (res.data.success && Array.isArray(res.data.data)) {
           results[key] = res.data.data.slice(-22).map((item: any) => ({
             date: item.date, close: parseFloat(item.close) || 0, change: Number(item.changePercent)
           }))
         }
       } catch (e) { console.error(`获取 ${key} K线失败:`, e) }
     })
     await Promise.all(tasks)
     indicesIntraday.value = results
+    klineUpdateTime.value = new Date().toISOString()
   }
```

**第 278-285 行** — return 导出新增 refs:
```diff
   return {
-    loading, fetchAll, marketIndex, indices,
+    loading, fetchAll, marketIndex, indices, klineUpdateTime, overviewUpdateTime,
     goldRealtime, goldModal, goldDays, goldModalHistory, metalChartOption,
     ...
   }
```

---

### 2. `Frontend/src/components/MarketOverview.vue`

**第 141-149 行** — 引入新 refs:
```diff
 const {
   loading, fetchAll, marketIndex, indices,
+  klineUpdateTime, overviewUpdateTime,
   goldRealtime, goldModal, goldDays, metalChartOption,
   ...
 } = useMarketOverview(props)
```

**第 3-10 行** — 市场指数趋势 header 加更新时间:
```diff
     <div class="market-section" v-if="showSSE30Min">
       <div class="section-header">
         <h3><LucideIcon name="TrendingDown" :size="20" /> {{ t('market.indexTrend1m') }}</h3>
         <div class="tab-group">...</div>
-        <span class="update-tag" v-if="latestKlineDate">截至 {{ latestKlineDate }}</span>
+        <span class="update-tag" v-if="klineUpdateTime">{{ t('market.updatedAt') }} {{ formatUpdateTime(klineUpdateTime) }}</span>
       </div>
```

**第 17-20 行** — 全球行情 section header 加更新时间:
```diff
     <div class="market-section">
       <div class="section-header">
         <h3><LucideIcon name="Globe" :size="20" /> {{ t('market.indices') }}</h3>
+        <span class="update-tag" v-if="overviewUpdateTime">{{ t('market.updatedAt') }} {{ formatUpdateTime(overviewUpdateTime) }}</span>
         <BButton size="small" icon="RefreshCw" :loading="loading" @click="fetchAll" :disabled="loading" />
       </div>
```

**第 47-49 行** — 成交量 section header 加更新时间:
```diff
     <div class="market-section">
       <div class="section-header">
         <h3><LucideIcon name="BarChart3" :size="20" /> {{ t('market.volume') }}</h3>
+        <span class="update-tag" v-if="overviewUpdateTime">{{ t('market.updatedAt') }} {{ formatUpdateTime(overviewUpdateTime) }}</span>
       </div>
```

**第 112-127 行** — 新增 `formatUpdateTime` 函数:
```diff
 <script setup lang="ts">
 import { ref } from 'vue'
 ...
 import { useMarketOverview } from '../composables/useMarketOverview'

+function formatUpdateTime(isoStr: string) {
+  try {
+    const d = new Date(isoStr)
+    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
+  } catch { return isoStr.slice(11, 19) }
+}
```

---

### 3. `Frontend/src/components/SectorRank.vue`

**第 238-244 行** — catch 块去掉 `clearSectorData()`:
```diff
     } catch (e) {
-      clearSectorData()
-      error.value = t('flashNews.networkError')
+      if (!sectors.value.length) {
+        error.value = t('flashNews.networkError')
+      }
       console.error('获取板块排行失败:', e)
     } finally {
```

---

### 4. `Frontend/src/components/FlashNews.vue`

**第 200-238 行** — `fetchNews` 中当 page=1 且返回空 items 时保留旧数据:
```diff
     const response = await marketAPI.getFlashNews(PAGE_SIZE, page)
     if (response.data.success) {
       const incoming = response.data.data?.items || []

       if (page === 1) {
+        if (incoming.length === 0 && newsList.value.length > 0) {
+          // 刷新返回空数据，保留旧数据不覆盖
+          return
+        }
         const currentKeys = new Set(incoming.map(...))
         ...
         newsList.value = enriched
```

---

### 5. `Frontend/src/locales/zh-CN.json`

在 `market` 块尾部新增:
```json
  "market.updatedAt": "更新于"
```

### 6. `Frontend/src/locales/en.json`

同样新增:
```json
  "market.updatedAt": "Updated"
```
