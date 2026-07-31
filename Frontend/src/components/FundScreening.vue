<template>
  <div class="fund-screening">
    <!-- 顶部状态栏 -->
    <div class="screening-header">
      <div class="header-actions">
        <div class="header-left">
          <span class="stat-chip">
            <LucideIcon name="Package" :size="14" /> {{ dbStatus.basic_count || 0 }} {{ '只基金' }}
          </span>
          <span class="stat-chip complete">
            <LucideIcon name="Check" :size="14" /> {{ dbStatus.complete_count || 0 }} 完整
          </span>
          <span class="update-time-chip" v-if="dbStatus.latest_update">
            <LucideIcon name="Clock" :size="14" /> {{ formatDate(dbStatus.latest_update) }}
          </span>
        </div>
        <div class="header-right">
          <a class="doc-link" href="/docs/fund-screening" target="_blank" title="查看文档">
            <LucideIcon name="HelpCircle" :size="16" />
          </a>
          <BButton type="primary" :disabled="updateStatus.running || syncing" @click="openUpdateDialog" :title="'选择要执行的更新任务'">
            <template #icon>
              <LucideIcon v-if="updateStatus.running" name="Hourglass" :size="14" />
              <LucideIcon v-else name="Download" :size="14" />
            </template>
            {{ updateStatus.running ? '更新中...' : '更新数据' }}
          </BButton>
        </div>
      </div>
    </div>

    <!-- 更新数据确认弹窗：三个任务选项在后端均触发同一全量更新（/screening/update 忽略 tasks），故为单一确认 -->
    <BDialog
      :visible="showUpdateDialog"
      title="更新数据"
      subtitle="全量更新所有基金：拉取快照 → 重算风险指标（回撤/夏普/卡玛）→ 更新板块分类，耗时较长。"
      :options="updateDialogOptions"
      @select="handleUpdateDialogSelect"
      @cancel="closeUpdateDialog"
    />

    <!-- 进行中的更新 — 内联进度条 -->
    <div v-if="updateStatus.running" class="inline-update-bar">
      <div class="inline-progress-info">
        <span class="inline-current">{{ updateStatus.current_fund || updateStatus.message }}</span>
        <span class="inline-count">
          <template v-if="updateStatus.total">{{ updateStatus.progress }}/{{ updateStatus.total }}</template>
          <template v-else>{{ '已处理' }} {{ updateStatus.success_count || 0 }}</template>
        </span>
      </div>
      <div class="progress-bar" :class="{ indeterminate: isProgressIndeterminate }">
        <div
          class="progress-fill"
          :class="{ indeterminate: isProgressIndeterminate }"
          :style="{ width: progressPercent + '%' }"
        ></div>
      </div>
      <BButton type="warning" size="small" @click="stopUpdate" icon="Square">{{ '停止' }}</BButton>
    </div>

    <!-- 筛选面板 -->
    <div class="screening-panel">
      <div class="filter-card">
        <!-- 基础筛选栏 -->
        <div class="filter-bar">
          <div class="filter-bar-row">
            <div ref="searchWrapRef" style="display:contents">
              <SearchBar
                v-model="filters.keyword"
                :placeholder="'基金代码/名称'"
                :clearable="true"
                @search="search(true)"
                @focus="onSearchFocus"
              >
                <template #dropdown>
                  <div class="search-dropdown" v-if="searchSuggestions.length && showSearchDropdown">
                    <div
                      v-for="item in searchSuggestions"
                      :key="item.CODE"
                      class="search-dropdown-item"
                      @click="selectSearchSuggestion(item)"
                    >
                      <span class="sug-code">{{ item.CODE }}</span>
                      <span class="sug-name">{{ item.NAME }}</span>
                      <span class="sug-type">{{ item.TYPE }}</span>
                    </div>
                  </div>
                </template>
              </SearchBar>
            </div>
            <!-- 基金类型下拉 -->
            <div class="type-select-wrap" ref="typeDropdownRef">
              <span class="input-icon"><LucideIcon name="Folder" :size="16" /></span>
              <div class="type-trigger" @click="showTypeDropdown = !showTypeDropdown">
                <span class="type-trigger-text">
                  {{ filters.fund_types.length ? filters.fund_types.length + ' 种类型' : '基金类型' }}
                </span>
                <span class="type-trigger-arrow"><LucideIcon name="ChevronDown" :size="12" /></span>
              </div>
              <div class="type-dropdown" v-show="showTypeDropdown" @click.stop>
                <div
                  v-for="cat in fundTypeCategories"
                  :key="cat.name"
                  class="type-cat-group"
                >
                  <div
                    class="type-cat-header"
                    :class="{ all: isCatAllSelected(cat), partial: isCatPartialSelected(cat) }"
                    @click="toggleCategoryTypes(cat)"
                  >
                    <span class="cat-check">
                      <LucideIcon v-if="isCatAllSelected(cat)" name="Check" :size="12" /><LucideIcon v-if="isCatPartialSelected(cat) && !isCatAllSelected(cat)" name="Minus" :size="12" />
                    </span>
                    <span><LucideIcon :name="cat.icon" :size="14" /> {{ cat.name }}</span>
                  </div>
                  <div class="type-cat-items">
                    <label
                      v-for="t in cat.types"
                      :key="t.value"
                      class="type-item-label"
                      :class="{ active: filters.fund_types.includes(t.value) }"
                    >
                      <input
                        type="checkbox"
                        :value="t.value"
                        :checked="filters.fund_types.includes(t.value)"
                        @change="toggleSingleType(t.value)"
                        class="type-checkbox"
                      />
                      {{ t.label }}
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <BButton type="primary" icon="Search" @click="search(true)" :disabled="syncing">查询</BButton>
            <BButton @click="resetFilters" :disabled="syncing">清空</BButton>
          </div>

          <!-- 已选类型标签 -->
          <div class="selected-types-tags" v-if="filters.fund_types.length">
            <span
              v-for="t in filters.fund_types"
              :key="t"
              class="type-tag-selected"
              @click="removeFundType(t)"
            >
              {{ getShortTypeName(t) }} <LucideIcon name="X" :size="12" />
            </span>
          </div>

          <!-- ====== 标签筛选区 ====== -->
        <div class="filter-section">
          <div v-if="fundTypeGroups.length || sectorGroups.length" class="filter-tags-area">

            <!-- 基金大类区 -->
            <div class="filter-zone" v-if="displayFundTypeGroups.length">
              <div class="filter-zone-title">基金大类</div>
              <div class="filter-zone-tags">
                <div class="tag-primary-row">
                  <button
                    class="tag-chip"
                    :class="{ active: filters.industry_tags.length === 0 }"
                    @click="clearIndustryTags"
                  >
                    <span class="tag-chip-name">全部</span>
                  </button>
                  <button
                    v-for="group in displayFundTypeGroups"
                    :key="group.name"
                    class="tag-chip tag-chip-primary"
                    :class="{ active: isGroupActive(group), expanded: expandedGroups.has(group.name) }"
                    @click="handlePrimaryIndustryClick(group)"
                  >
                    <span class="tag-chip-name">{{ group.name }}</span>
                    <span class="tag-chip-count">{{ group.count }}只</span>
                  </button>
                </div>
                <template v-for="group in displayFundTypeGroups" :key="'sub-' + group.name">
                  <div v-if="expandedGroups.has(group.name) && group.tags.length" class="tag-sub-row">
                    <button
                      v-for="tag in group.tags"
                      :key="tag.name"
                      class="tag-chip tag-chip-sub"
                      :class="{ active: filters.industry_tags.includes(tag.name) }"
                      @click="toggleIndustryTag(tag.name)"
                    >
                      <span class="tag-chip-name">{{ tag.name }}</span>
                      <span class="tag-chip-count">{{ tag.count }}</span>
                    </button>
                  </div>
                </template>
              </div>
            </div>

            <!-- 行业/市场板块区 -->
            <div class="filter-zone" v-if="displaySectorGroups.length">
              <div class="filter-zone-title">
                行业 / 市场板块
                <BButton text size="small" @click="sectorExpanded = !sectorExpanded">
                  {{ sectorExpanded ? '收起' : '展开全部' }}
                  <template #icon><LucideIcon :name="sectorExpanded ? 'ChevronUp' : 'ChevronDown'" :size="12" /></template>
                </BButton>
              </div>
              <div class="filter-zone-tags">
                <div class="tag-primary-row">
                  <button
                    v-for="group in visibleSectorGroups"
                    :key="group.name"
                    class="tag-chip tag-chip-primary"
                    :class="{ active: isGroupActive(group), expanded: expandedGroups.has(group.name) }"
                    @click="handlePrimaryIndustryClick(group)"
                  >
                    <span class="tag-chip-name">{{ group.name }}</span>
                    <span class="tag-chip-count">{{ group.count }}只</span>
                  </button>
                </div>
                <template v-for="group in visibleSectorGroups" :key="'sub-' + group.name">
                  <div v-if="expandedGroups.has(group.name) && group.tags.length" class="tag-sub-row">
                    <button
                      v-for="tag in group.tags"
                      :key="tag.name"
                      class="tag-chip tag-chip-sub"
                      :class="{ active: filters.industry_tags.includes(tag.name) }"
                      @click="toggleIndustryTag(tag.name)"
                    >
                      <span class="tag-chip-name">{{ tag.name }}</span>
                      <span class="tag-chip-count">{{ tag.count }}</span>
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </div>

        <!-- 高级筛选 -->
        <div class="advanced-section-wrapper">
          <div class="advanced-toggle" @click="showAdvanced = !showAdvanced">
            <span><LucideIcon name="Settings" :size="14" /> 高级筛选条件</span>
            <span class="toggle-arrow"><LucideIcon :name="showAdvanced ? 'ChevronUp' : 'ChevronDown'" :size="14" /></span>
          </div>
          <div class="advanced-section" v-show="showAdvanced">
          <div class="adv-group" v-for="group in advancedFilterGroups" :key="group.title">
            <div class="adv-group-title">{{ group.title }}</div>
            <div class="adv-grid-simple">
              <div class="adv-item" v-for="item in group.items" :key="item.key || item.minKey || item.maxKey">
                <label>{{ item.label }}</label>
                <label class="adv-check" v-if="item.type === 'checkbox'">
                  <BCheckbox v-model="advFilters[item.key]" :label="item.text" size="small" />
                </label>
                <div class="adv-range" v-else-if="item.type === 'range'">
                  <BInputNumber v-model="advFilters[item.minKey]" placeholder="最小值" :controls="false" size="small" style="width:80px" />
                  <span class="adv-sep">~</span>
                  <BInputNumber v-model="advFilters[item.maxKey]" placeholder="最大值" :controls="false" size="small" style="width:80px" />
                  <span class="adv-unit" v-if="item.unit">{{ item.unit }}</span>
                </div>
                <div class="adv-range" v-else>
                  <span class="adv-op">{{ item.operator }}</span>
                  <BInputNumber v-model="advFilters[item.key]" :placeholder="item.placeholder || ''" :controls="false" size="small" style="width:80px" />
                  <span class="adv-unit" v-if="item.unit">{{ item.unit }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    </div>
    </div>

    <!-- 同步加载条 -->
    <div v-if="syncing && !updateStatus.running" class="sync-loading-bar">
      <div class="sync-loading-spinner"></div>
      <div class="sync-loading-text">
        <strong>正在同步数据...</strong>
        <span v-if="!searched">首次加载基金数据，请稍候</span>
        <span v-else>正在计算风险指标...</span>
      </div>
    </div>

    <!-- 筛选结果 -->
    <div class="results-section" v-if="results.length > 0 || loading">
      <div class="results-header">
        <div class="results-title-row">
          <h3>筛选结果 <span class="result-count">(共 {{ totalCount }} 只)</span></h3>
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner large"></div>
        <p>正在筛选...</p>
      </div>

      <!-- 结果表格 -->
      <div v-else class="results-table-wrapper vxe-results-wrapper">
        <vxe-grid
          ref="screeningGridRef"
          v-bind="gridOptions"
          :data="results"
          :sort-config="sortConfig"
          @sort-change="handleGridSort"
          @cell-click="handleGridCellClick"
        >
          <template #loading>
            <div class="vxe-loading">加载中...</div>
          </template>
          <template #fundName="{ row }">
            <span class="fund-name-cell" :title="row.fund_name">{{ row.fund_name || '--' }}</span>
          </template>
          <template #industryTag="{ row }">
            <span class="industry-cell">{{ row.industry_tag_name || '混合型' }}</span>
          </template>
          <template #percent="{ row, column }">
            <span :class="getReturnClass(row[column.field])">{{ formatPercent(row[column.field]) }}</span>
          </template>
          <template #drawdown="{ row }">
            <span class="negative">{{ formatPercent(row.max_drawdown_1y, true) }}</span>
          </template>
          <template #number="{ row, column }">
            <span>{{ formatNumber(row[column.field]) }}</span>
          </template>
          <template #sharpe="{ row }">
            <span :class="getSharpeClass(row.sharpe_ratio_1y)">{{ formatNumber(row.sharpe_ratio_1y) }}</span>
          </template>
          <template #calmar="{ row }">
            <span :class="getCalmarClass(row.calmar_ratio_1y)">{{ formatNumber(row.calmar_ratio_1y) }}</span>
          </template>
          <template #pass4433="{ row }">
            <span v-if="row.pass_4433 === 1" class="pass-badge"><LucideIcon name="Check" :size="14" /></span>
            <span v-else class="fail-badge">-</span>
          </template>
          <template #actions="{ row }">
            <div class="actions">
              <BButton circle size="small" :class="{ watched: isInWatchlist(row.fund_code) }" @click.stop="toggleWatchlist(row)" :title="isInWatchlist(row.fund_code) ? '取消自选' : '加入自选'" icon="Star" />
              <BButton circle size="small" @click.stop="addToCompare(row)" title="加入对比" icon="LayoutGrid" />
            </div>
          </template>
        </vxe-grid>
      </div>

      <!-- 分页 -->
      <div class="pagination">
        <BButton size="small" :disabled="currentPage === 1" @click="changePage(currentPage - 1)">上一页</BButton>
        <span class="page-info">
          第 {{ currentPage }} / {{ totalPages }} 页
        </span>
        <BButton size="small" :disabled="currentPage === totalPages" @click="changePage(currentPage + 1)">下一页</BButton>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="searched && !loading" class="empty-state">
      <div class="empty-icon"><LucideIcon name="MailOpen" :size="36" /></div>
      <p>未找到符合条件的基金</p>
      <p class="hint">请尝试调整筛选条件</p>
    </div>

    <!-- 初始状态 -->
    <div v-else class="initial-state">
      <div class="initial-icon"><LucideIcon name="Target" :size="36" /></div>
      <p>选择筛选策略或设置筛选条件</p>
      <p class="hint">支持4433法则（同类排名）、夏普比率、卡玛比率等多维度筛选</p>
      <p class="hint sub-hint">注：4433法则的排名是在同类型基金中计算的</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { useFundScreening } from '../composables/useFundScreening'
import BButton from './BButton.vue'
import BInputNumber from './BInputNumber.vue'
import BCheckbox from './BCheckbox.vue'
import BDialog from './BDialog.vue'

defineOptions({ name: 'FundScreening' })
const emit = defineEmits(['view-fund', 'add-to-compare'])

const {
  dbStatus, syncing, updateStatus, showUpdateDialog,
  showAdvanced, showTypeDropdown, typeDropdownRef, searchWrapRef,
  searchSuggestions, showSearchDropdown, advFilters, advancedFilterGroups,
  filters, fundTypeCategories, expandedGroups, sectorExpanded,
  screeningGridRef, currentPage, totalCount, totalPages,
  results, loading, searched, gridOptions, sortConfig,
  progressPercent, isProgressIndeterminate,
  displayFundTypeGroups, displaySectorGroups, visibleSectorGroups,
  fundTypeGroups, sectorGroups,

  onSearchFocus, selectSearchSuggestion,
  removeFundType, toggleSingleType, toggleCategoryTypes,
  isCatAllSelected, isCatPartialSelected,
  openUpdateDialog, closeUpdateDialog, startUpdate, stopUpdate,
  resetFilters, toggleIndustryTag, clearIndustryTags,
  search, getShortTypeName, changePage,
  handleGridSort, handleGridCellClick, toggleWatchlist, addToCompare,
  formatPercent, formatNumber, formatDate,
  getReturnClass, getSharpeClass, getCalmarClass,
  handlePrimaryIndustryClick, isGroupActive, isInWatchlist,
} = useFundScreening(emit)

const updateDialogOptions = [
  { icon: 'RefreshCw', title: '确认，开始更新', desc: '从快照数据源批量拉取基金排行、收益、类型，并重算指标与板块分类', value: 'confirm' },
  { icon: 'X', title: '取消', desc: '保持现有数据不变', value: 'cancel' },
]
const handleUpdateDialogSelect = (value) => {
  if (value === 'confirm') startUpdate()
  else closeUpdateDialog()
}
</script>

<style src="./FundScreening.css" scoped></style>
