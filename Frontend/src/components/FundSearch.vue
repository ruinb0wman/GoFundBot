<template>
  <div class="fund-search" :class="{ 'compact-mode': compact }">
    <div class="search-header">
      <div class="search-box">
        <input
          v-model="searchKeyword"
          @input="handleSearch"
          @keyup.enter="performSearch"
          :placeholder="compact ? '输入基金代码或名称搜索...' : '输入基金代码或名称搜索...'"
          class="search-input"
        />
        <button @click="performSearch" class="search-btn">搜索</button>
        <button 
          @click="updateDatabase" 
          :disabled="updating"
          class="refresh-btn"
          :title="dbStatus.has_cache ? `${dbStatus.count}只基金 | 更新: ${formatDate(dbStatus.last_update)}` : '更新基金数据库'"
        >
          <span v-if="updating" class="spinner"></span>
          <span v-else><LucideIcon name="RefreshCw" :size="16" /></span>
        </button>
      </div>
    </div>
    
    <div v-if="searchResults.length > 0" class="search-results">
      <div
        v-for="fund in searchResults"
        :key="fund.CODE"
        class="fund-item"
        @click="selectFund(fund)"
      >
        <div class="fund-code">{{ fund.CODE }}</div>
        <div class="fund-name">{{ fund.NAME }}</div>
        <div class="fund-type">{{ fund.TYPE || '基金' }}</div>
      </div>
    </div>
    
    <div v-if="loading" class="loading">搜索中...</div>
  </div>
</template>

<script>
import { fundAPI } from '../services/api'

export default {
  name: 'FundSearch',
  props: {
    compact: {
      type: Boolean,
      default: false
    }
  },
  emits: ['fund-selected'],
  data() {
    return {
      searchKeyword: '',
      searchResults: [],
      loading: false,
      updating: false,
      searchTimer: null,
      dbStatus: {
        count: 0,
        last_update: '',
        has_cache: false
      }
    }
  },
  mounted() {
    this.fetchDbStatus()
  },
  methods: {
    async fetchDbStatus() {
      try {
        const response = await fundAPI.getSearchStatus()
        this.dbStatus = response.data
      } catch (error) {
        console.error('获取数据库状态失败:', error)
      }
    },
    
    async updateDatabase() {
      if (this.updating) return
      
      this.updating = true
      try {
        const response = await fundAPI.updateSearchDatabase()
        if (response.data.success) {
          this.dbStatus = {
            count: response.data.count,
            last_update: response.data.last_update,
            has_cache: true
          }
          alert(`✅ 更新成功！已加载 ${response.data.count} 只基金`)
        } else {
          alert(`❌ 更新失败: ${response.data.error}`)
        }
      } catch (error) {
        console.error('更新数据库失败:', error)
        alert('❌ 更新失败，请检查网络连接')
      } finally {
        this.updating = false
      }
    },
    
    formatDate(dateStr) {
      if (!dateStr) return '未知'
      // 只显示日期部分
      return dateStr.split(' ')[0]
    },
    
    handleSearch() {
      clearTimeout(this.searchTimer)
      if (this.searchKeyword.length >= 1) {
        this.searchTimer = setTimeout(this.performSearch, 150)
      } else {
        this.searchResults = []
      }
    },
    
    async performSearch() {
      if (!this.searchKeyword.trim()) return
      
      this.loading = true
      try {
        const response = await fundAPI.searchFunds(this.searchKeyword)
        this.searchResults = response.data.data || []
      } catch (error) {
        console.error('搜索失败:', error)
        this.searchResults = []
      } finally {
        this.loading = false
      }
    },
    
    selectFund(fund) {
      // 传递完整的基金对象，以便接收方获取更多信息（如名称）
      this.$emit('fund-selected', fund)
      this.searchResults = []
      this.searchKeyword = ''
    }
  }
}
</script>

<style scoped>
.fund-search {
  margin-bottom: 20px;
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
  position: relative;
}

.fund-search.compact-mode {
  margin-bottom: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.fund-search.compact-mode .search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  margin-top: 4px;
}

.fund-search.compact-mode .loading {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  margin-top: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}

.search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 200px;
  align-items: center;
}

.search-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s;
  min-width: 150px;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
}

.search-btn {
  padding: 10px 20px;
  background: linear-gradient(135deg, #ff9f43 0%, #f39c12 100%);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
}

.search-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(243, 156, 18, 0.4);
}

.refresh-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.3s;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
  transform: rotate(180deg);
}

.refresh-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.search-results {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-card);
  box-shadow: var(--shadow-md);
  margin-top: 10px;
}

.fund-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.15s;
}

.fund-item:last-child {
  border-bottom: none;
}

.fund-item:hover {
  background: var(--bg-subtle);
}

.fund-code {
  font-weight: 600;
  color: var(--color-primary);
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 13px;
  min-width: 60px;
}

.fund-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 14px;
}

.fund-type {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-subtle);
  padding: 2px 8px;
  border-radius: 10px;
}

.loading {
  text-align: center;
  padding: 12px;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>