<!-- 7x24 快讯组件 - 支持无限滚动、多数据源聚合 -->
<template>
  <div class="flash-news-container" ref="containerRef">
    <!-- 头部 -->
    <div class="news-header-bar">
      <div class="header-left">
        <h3 class="header-title">📰 7×24 快讯</h3>
        <span v-if="!loading && newsList.length" class="count-badge">{{ newsList.length }} 条</span>
      </div>
      <div class="header-right">
        <span v-if="sourcesText" class="sources-tag" :title="sourcesText">{{ sourcesText }}</span>
        <button class="refresh-btn" @click="resetAndFetch" :disabled="loading" title="刷新快讯">
          <span :class="{ spinning: loading }">🔄</span>
        </button>
      </div>
    </div>

    <!-- 骨架屏 -->
    <div v-if="loading && !newsList.length" class="skeleton-list">
      <div v-for="n in 6" :key="n" class="skeleton-item">
        <div class="skeleton-line skeleton-time"></div>
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-title short"></div>
      </div>
    </div>

    <!-- 错误 -->
    <div v-else-if="error && !newsList.length" class="error-state">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{{ error }}</span>
      <button class="retry-btn" @click="resetAndFetch">重试</button>
    </div>

    <!-- 空 -->
    <div v-else-if="!newsList.length && !loading" class="empty-state">
      <span class="empty-icon">📭</span>
      <span>暂无快讯数据</span>
    </div>

    <!-- 列表 -->
    <div v-else class="news-list" ref="listRef" @scroll="onScroll">
      <TransitionGroup name="news-fade">
        <div
          v-for="(news, index) in displayedNews"
          :key="news._key || index"
          class="news-item"
          :class="{
            positive: news.evaluate === '利好',
            negative: news.evaluate === '利空',
            'is-new': news._isNew,
          }"
          @click="openDetail(news)"
        >
          <div class="item-meta">
            <span class="meta-time">{{ formatRelativeTime(news.publish_time) }}</span>
            <span v-if="news.source" class="meta-source">{{ news.source }}</span>
          </div>
          <p class="item-title">
            {{ truncate(news.title) }}
          </p>
        </div>
      </TransitionGroup>

      <!-- 底部加载状态 -->
      <div v-if="loadingMore" class="loading-more">
        <span class="loading-dot"></span> 加载更多快讯...
      </div>
      <div v-else-if="!hasMore && newsList.length > 0" class="loading-more end">
        — 已加载全部快讯 —
      </div>
    </div>

    <!-- 底部 -->
    <div v-if="updateTime && !loading" class="news-footer">
      <span class="footer-dot online"></span>
      <span>更新于 {{ formatUpdateTime(updateTime) }}</span>
    </div>

    <!-- 详情弹窗 -->
    <Teleport to="body">
      <div v-if="modal.visible" class="news-modal-overlay" @click.self="closeDetail">
        <div class="news-modal">
          <div class="modal-header">
            <span class="modal-time">{{ modal.news?.publish_time }}</span>
            <button class="modal-close" @click="closeDetail">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-title">{{ modal.news?.title }}</p>
            <div class="modal-tags">
              <span v-if="modal.news?.source" class="meta-source">{{ modal.news.source }}</span>
              <span
                v-if="modal.news?.evaluate"
                class="meta-tag"
                :class="modal.news.evaluate === '利好' ? 'tag-bullish' : 'tag-bearish'"
              >{{ modal.news.evaluate }}</span>
            </div>
            <div v-if="modal.news?.related_stocks?.length" class="modal-stocks">
              <span class="modal-stocks-label">相关股票</span>
              <div class="modal-stocks-list">
                <span
                  v-for="stock in modal.news.related_stocks"
                  :key="stock.code"
                  class="stock-chip"
                  :class="{
                    'chip-up': stock.ratio && !stock.ratio.startsWith('-') && stock.ratio !== '0.00%',
                    'chip-down': stock.ratio && stock.ratio.startsWith('-'),
                  }"
                >
                  <span class="chip-name">{{ stock.name }}</span>
                  <span class="chip-ratio">{{ stock.ratio || '—' }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { marketAPI } from '../services/api'

export default {
  name: 'FlashNews',
  props: {
    count: { type: Number, default: 30 },
    autoRefresh: { type: Boolean, default: true },
    refreshInterval: { type: Number, default: 30000 },
  },
  setup(props) {
    const MAX_LEN = 35
    const PAGE_SIZE = 50 // Items per page fetch
    const DISPLAY_BATCH = 30 // Items to reveal per scroll

    const newsList = ref([])
    const loading = ref(false)
    const loadingMore = ref(false)
    const error = ref(null)
    const updateTime = ref('')
    const currentPage = ref(1)
    const hasMore = ref(true)
    const displayCount = ref(DISPLAY_BATCH)
    const prevKeys = new Set()
    const modal = reactive({ visible: false, news: null })
    const listRef = ref(null)
    const containerRef = ref(null)
    let refreshTimer = null

    const displayedNews = computed(() => {
      return newsList.value.slice(0, displayCount.value)
    })

    const sourcesText = computed(() => {
      const sources = new Set()
      newsList.value.forEach(n => { if (n.source) sources.add(n.source) })
      return [...sources].join(' + ') || ''
    })

    const truncate = (text) => {
      if (!text) return ''
      return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '…' : text
    }

    const openDetail = (news) => {
      modal.news = news
      modal.visible = true
      document.body.style.overflow = 'hidden'
    }

    const closeDetail = () => {
      modal.visible = false
      modal.news = null
      document.body.style.overflow = ''
    }

    const mergeNews = (incoming) => {
      const existingKeys = new Set(newsList.value.map(n => n._key))
      const newItems = []
      incoming.forEach(n => {
        const key = n.publish_time + n.title?.slice(0, 20)
        if (!existingKeys.has(key)) {
          newItems.push({
            ...n,
            _key: key,
            _isNew: prevKeys.size > 0 && !prevKeys.has(key),
          })
          existingKeys.add(key)
        }
      })
      if (newItems.length) {
        newsList.value = [...newsList.value, ...newItems]
      }
    }

    const fetchNews = async (page = 1, append = false) => {
      if (page === 1) {
        loading.value = true
      } else {
        loadingMore.value = true
      }
      error.value = null
      try {
        const response = await marketAPI.getFlashNews(PAGE_SIZE, page)
        if (response.data.success) {
          const incoming = response.data.data || []

          if (page === 1) {
            // First page: replace entirely and track new items
            const currentKeys = new Set(incoming.map(n => n.publish_time + n.title?.slice(0, 20)))
            const enriched = incoming.map(n => ({
              ...n,
              _key: n.publish_time + n.title?.slice(0, 20),
              _isNew: prevKeys.size > 0 && !prevKeys.has(n.publish_time + n.title?.slice(0, 20)),
            }))
            prevKeys.clear()
            currentKeys.forEach(k => prevKeys.add(k))
            newsList.value = enriched
            displayCount.value = DISPLAY_BATCH
            currentPage.value = 1
          } else if (append) {
            mergeNews(incoming)
          }

          hasMore.value = response.data.hasMore ?? (incoming.length >= PAGE_SIZE)
          updateTime.value = response.data.update_time || ''

          // Clear new-item animation after 2s
          nextTick(() => {
            setTimeout(() => { newsList.value.forEach(n => (n._isNew = false)) }, 2000)
          })
        } else if (page === 1) {
          error.value = response.data.error || '获取快讯失败'
        }
      } catch (e) {
        if (page === 1) {
          error.value = '网络异常，请稍后重试'
        }
      } finally {
        loading.value = false
        loadingMore.value = false
      }
    }

    const loadMore = async () => {
      if (loadingMore.value || !hasMore.value) return

      // First try revealing more from already-fetched data
      if (displayCount.value < newsList.value.length) {
        displayCount.value = Math.min(displayCount.value + DISPLAY_BATCH, newsList.value.length)
        return
      }

      // Need to fetch next page
      const nextPage = currentPage.value + 1
      await fetchNews(nextPage, true)
      currentPage.value = nextPage
      // Reveal the new items
      displayCount.value = Math.min(displayCount.value + DISPLAY_BATCH, newsList.value.length)
    }

    const resetAndFetch = () => {
      displayCount.value = DISPLAY_BATCH
      currentPage.value = 1
      hasMore.value = true
      fetchNews(1, false)
    }

    const onScroll = () => {
      const el = listRef.value
      if (!el) return
      // Load more when within 80px of the bottom
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
        loadMore()
      }
    }

    const formatRelativeTime = (timeStr) => {
      if (!timeStr) return ''
      try {
        const ts = new Date(timeStr.replace(' ', 'T')).getTime()
        if (isNaN(ts)) return timeStr.slice(5, 16)
        const diff = Math.max(0, Date.now() - ts)
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return '刚刚'
        if (mins < 60) return `${mins}分钟前`
        const hours = Math.floor(mins / 60)
        if (hours < 24) return `${hours}小时前`
        if (hours < 48) return '昨天'
        return timeStr.slice(5, 16)
      } catch { return timeStr.slice(5, 16) }
    }

    const formatUpdateTime = (timeStr) => {
      if (!timeStr) return ''
      const normalized = String(timeStr).replace(' ', 'T')
      const date = new Date(normalized)
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      }
      const match = String(timeStr).match(/(\d{2}:\d{2}:\d{2})/)
      return match ? match[1] : String(timeStr)
    }

    onMounted(() => {
      fetchNews(1, false)
      if (props.autoRefresh) refreshTimer = setInterval(() => fetchNews(1, false), props.refreshInterval)
    })
    onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer) })

    return {
      newsList, displayedNews, loading, loadingMore, error, updateTime, modal,
      hasMore, sourcesText, listRef, containerRef,
      truncate, openDetail, closeDetail, fetchNews, loadMore, resetAndFetch,
      onScroll, formatRelativeTime, formatUpdateTime,
    }
  },
}
</script>

<style scoped>
/* ── 容器 ──────────────────────────────────────────── */
.flash-news-container {
  background: var(--bg-card);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  min-height: 320px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.news-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 8px; }
.header-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--text-primary); }
.count-badge { font-size: 11px; font-weight: 600; color: var(--color-primary); background: var(--color-primary-bg); padding: 2px 8px; border-radius: var(--radius-md); }

.header-right { display: flex; align-items: center; gap: 8px; }

.sources-tag {
  font-size: 10px; color: var(--text-tertiary); background: var(--bg-subtle);
  padding: 2px 8px; border-radius: var(--radius-md); max-width: 150px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.refresh-btn {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px; background: var(--bg-subtle);
  font-size: 14px; cursor: pointer; transition: all 0.2s;
}
.refresh-btn:hover { background: var(--bg-hover); }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.spinning { display: inline-block; animation: spin 0.8s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ── 骨架屏 ────────────────────────────────────────── */
.skeleton-list { padding: 10px 14px; }
.skeleton-item { padding: 12px 0; border-bottom: 1px solid var(--border-subtle); }
.skeleton-line { height: 10px; border-radius: 5px; margin-bottom: 6px;
  background: linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-hover) 50%, var(--bg-subtle) 75%); background-size: 200% 100%;
  animation: shimmer 1.5s infinite; }
.skeleton-time { width: 60px; height: 9px; }
.skeleton-title { width: 100%; }
.skeleton-title.short { width: 60%; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── 状态 ──────────────────────────────────────────── */
.error-state, .empty-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 20px; color: var(--text-tertiary);
}
.error-icon, .empty-icon { font-size: 28px; }
.retry-btn {
  margin-top: 8px; padding: 6px 18px; border: none; border-radius: 8px;
  background: var(--color-primary); color: var(--text-inverse); font-size: 13px; font-weight: 600; cursor: pointer;
}
.retry-btn:hover { background: var(--color-primary-hover); }

/* ── 列表 ──────────────────────────────────────────── */
.news-list { flex: 1; overflow-y: auto; padding: 2px 0; }
.news-list::-webkit-scrollbar { width: 4px; }
.news-list::-webkit-scrollbar-track { background: transparent; }
.news-list::-webkit-scrollbar-thumb { background: var(--text-disabled); border-radius: 2px; }

.news-item {
  display: block;
  padding: 9px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  border-left: 3px solid transparent;
  transition: background 0.15s;
}
.news-item:last-child { border-bottom: none; }
.news-item:hover { background: var(--bg-hover); }
.news-item.is-new { animation: highlightIn 2s ease-out; }
.news-item.positive { border-left-color: var(--color-danger); }
.news-item.negative { border-left-color: var(--color-success); }

@keyframes highlightIn { 0% { background: var(--color-warning-bg); } 100% { background: transparent; } }

.item-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap; }
.meta-time { font-size: 11px; color: var(--text-tertiary); font-weight: 500; white-space: nowrap; }
.meta-source { font-size: 10px; color: var(--color-primary); background: var(--color-primary-bg); padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.meta-tag { font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
.tag-bullish { background: var(--color-danger-bg); color: var(--color-danger); }
.tag-bearish { background: var(--color-success-bg); color: var(--color-success); }

.item-title { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-primary); }
.news-item:hover .item-title { color: var(--color-primary); }

/* ── 加载更多 ──────────────────────────────────────── */
.loading-more {
  text-align: center; padding: 14px; font-size: 12px; color: var(--text-tertiary);
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.loading-more.end { color: var(--text-disabled); }
.loading-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

/* ── 底部 ──────────────────────────────────────────── */
.news-footer {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-top: 1px solid var(--border-default);
  font-size: 11px; color: var(--text-disabled); flex-shrink: 0;
}
.footer-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }

/* ── 过渡动画 ──────────────────────────────────────── */
.news-fade-enter-active { transition: all 0.4s ease; }
.news-fade-leave-active { transition: all 0.25s ease; }
.news-fade-enter-from { opacity: 0; transform: translateY(-8px); }
.news-fade-leave-to { opacity: 0; transform: translateX(20px); }

/* ── 弹窗 ──────────────────────────────────────────── */
.news-modal-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: var(--bg-overlay);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.news-modal {
  background: var(--bg-elevated); border-radius: var(--radius-lg);
  width: 100%; max-width: 560px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: slideUp 0.25s ease;
}
@keyframes slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }

.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-default);
}
.modal-time { font-size: 13px; color: var(--text-tertiary); }
.modal-close {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px; background: var(--bg-subtle);
  font-size: 16px; color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }

.modal-body { padding: 20px; overflow-y: auto; }
.modal-title { margin: 0 0 14px; font-size: 16px; line-height: 1.7; color: var(--text-primary); font-weight: 500; }
.modal-tags { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.modal-tags .meta-source { font-size: 12px; padding: 3px 10px; }
.modal-tags .meta-tag { font-size: 13px; padding: 4px 12px; border-radius: 6px; font-weight: 700; }

.modal-stocks { border-top: 1px solid var(--border-default); padding-top: 14px; }
.modal-stocks-label { display: block; font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px; }
.modal-stocks-list { display: flex; flex-wrap: wrap; gap: 6px; }

.stock-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: var(--radius-sm); background: var(--bg-subtle); font-size: 11px;
}
.stock-chip:hover { background: var(--bg-hover); }
.chip-name { color: var(--text-secondary); font-weight: 500; }
.chip-ratio { font-weight: 600; color: var(--text-tertiary); }
.chip-up { background: var(--color-danger-bg); } .chip-up .chip-ratio { color: var(--color-danger); }
.chip-down { background: var(--color-success-bg); } .chip-down .chip-ratio { color: var(--color-success); }

/* ── 响应式 ────────────────────────────────────────── */
@media (max-width: 768px) {
  .news-item { padding: 8px 12px; }
  .item-title { font-size: 12px; }
  .news-modal { max-width: 100%; max-height: 90vh; border-radius: 12px 12px 0 0; margin-top: auto; }
  .news-modal-overlay { align-items: flex-end; padding: 0; }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
}
</style>
