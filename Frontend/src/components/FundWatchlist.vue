<template>
  <div class="watchlist-container">
    <div v-if="showCompareToggle" class="compare-toggle-bar">
      <BButton
        :active="compareMode"
        @click="$emit('toggle-compare')"
        icon="TrendingUp"
      >
        {{ compareMode ? '退出对比' : '基金对比' }}
        <span v-if="compareFunds.length && compareMode" class="compare-count">{{ compareFunds.length }}</span>
      </BButton>
      <div v-if="compareMode && compareFunds.length > 0" class="compare-selected">
        <div v-for="fund in compareFunds" :key="fund.code" class="compare-tag">
          <span class="tag-name">{{ fund.name }}</span>
        </div>
      </div>
      <div v-if="compareMode && compareFunds.length === 0" class="compare-hint">
        <LucideIcon name="ArrowBigUp" :size="14" /> {{ '点击下方基金的 + 按钮添加对比' }}
      </div>
      <div v-if="compareMode && compareFunds.length === 1" class="compare-hint">
        {{ `还需选择至少 ${1} 只基金才能对比` }}
      </div>
      <a class="doc-link" href="/docs/market-watchlist" target="_blank" title="查看文档">
        <LucideIcon name="HelpCircle" :size="16" />
      </a>
    </div>

    <div class="watchlist-header">
      <h2>
        <span class="header-icon"><LucideIcon name="Star" :size="18" /></span>
        {{ '我的自选' }}
        <span class="count-badge" v-if="totalCount">{{ totalCount }}</span>
      </h2>
      <div class="header-actions">
        <BButton plain @click="openAddGroupModal" :title="'新建分组'" icon="FolderPlus" />
        <BButton
          v-if="!editMode && totalCount > 0"
          @click="enterEditMode"
        >
          {{ '编辑' }}
        </BButton>
        <template v-if="editMode">
          <BButton
            type="danger"
            :disabled="selectedFunds.length === 0"
            @click="batchDelete"
          >
            {{ selectedFunds.length > 0 ? `删除(${selectedFunds.length})` : '删除' }}
          </BButton>
          <BButton @click="exitEditMode">
            {{ '完成' }}
          </BButton>
        </template>
        <BButton
          @click="refreshEstimates"
          :disabled="isRefreshingEstimates || totalCount === 0"
          :title="lastEstimateUpdate ? `估值更新于 ${lastEstimateUpdate}` : '刷新估值'"
          icon="RefreshCw"
        />
      </div>
    </div>

    <div v-if="lastEstimateUpdate && totalCount > 0" class="estimate-update-hint">
      <span class="hint-icon"><LucideIcon name="BarChart3" :size="12" /></span>
      <span>{{ `估值更新于 ${lastEstimateUpdate}` }}</span>
      <span v-if="adaptiveRefresh.isStale.value" class="stale-badge"><LucideIcon name="Clock" :size="12" /> {{ '超时' }}</span>
      <span class="hint-auto">{{ '（自动刷新）' }}</span>
    </div>

    <div v-if="loading && totalCount === 0" class="skeleton-loading">
      <SkeletonCard v-for="n in 4" :key="n" :lines="2" :height="80" />
    </div>

    <div v-else-if="totalCount === 0" class="empty-state">
      <div class="empty-icon"><LucideIcon name="ClipboardList" :size="36" /></div>
      <p>{{ '暂无自选基金' }}</p>
      <p class="empty-hint">{{ `在基金详情页点击 ${''} 添加自选` }} <LucideIcon name="Star" :size="12" /></p>
    </div>

    <div v-else class="watchlist-content">
      <div class="fund-group" v-if="ungroupedFunds.length > 0 || groups.length === 0">
        <div class="group-header" @click="toggleGroup(null)">
          <span class="group-toggle"><LucideIcon :name="isGroupExpanded(null) ? 'ChevronDown' : 'ChevronRight'" :size="14" /></span>
          <span class="group-name">{{ groups.length > 0 ? '未分组' : '全部基金' }}</span>
          <span class="group-count">{{ ungroupedFunds.length }}</span>
        </div>
        <div class="group-content" v-show="isGroupExpanded(null)">
          <FundListItems
            :funds="ungroupedFunds"
            :editMode="editMode"
            :selectedFunds="selectedFunds"
            :draggingIndex="draggingIndex"
            :groupId="null"
            :compareMode="compareMode"
            :compareFunds="compareFunds"
            :addToRealtimeMode="addToRealtimeMode"
            @toggle-select="toggleSelect"
            @view-fund="viewFundDetail"
            @remove-fund="removeFund"
            @drag-start="onDragStart"
            @drag-end="onDragEnd"
            @drag-over="onDragOver"
            @drop="onDrop"
            @add-to-compare="addToCompare"
            @add-to-realtime="$emit('add-to-realtime', $event)"
            @show-alert-settings="openAlertSettings"
          />
        </div>
      </div>

      <div
        v-for="group in groups"
        :key="group.id"
        class="fund-group"
        @dragover.prevent="onGroupDragOver($event, group.id)"
        @drop="onGroupDrop($event, group.id)"
      >
        <div class="group-header" @click="toggleGroup(group.id)">
          <span class="group-toggle"><LucideIcon :name="isGroupExpanded(group.id) ? 'ChevronDown' : 'ChevronRight'" :size="14" /></span>
          <span class="group-name"><LucideIcon name="Folder" :size="14" /> {{ group.name }}</span>
          <span class="group-count">{{ getGroupFunds(group.id).length }}</span>
          <div class="group-actions" v-if="editMode" @click.stop>
            <BButton circle size="small" @click="openEditGroupModal(group)" :title="'重命名分组'" icon="Pencil" />
            <BButton circle size="small" type="danger" @click="deleteGroup(group)" :title="'删除'" icon="Trash2" />
          </div>
        </div>
        <div class="group-content" v-show="isGroupExpanded(group.id)">
          <FundListItems
            :funds="getGroupFunds(group.id)"
            :editMode="editMode"
            :selectedFunds="selectedFunds"
            :draggingIndex="draggingIndex"
            :groupId="group.id"
            :compareMode="compareMode"
            :compareFunds="compareFunds"
            :addToRealtimeMode="addToRealtimeMode"
            @toggle-select="toggleSelect"
            @view-fund="viewFundDetail"
            @remove-fund="removeFund"
            @drag-start="onDragStart"
            @drag-end="onDragEnd"
            @drag-over="onDragOver"
            @drop="onDrop"
            @add-to-compare="addToCompare"
            @add-to-realtime="$emit('add-to-realtime', $event)"
            @show-alert-settings="openAlertSettings"
          />
          <div v-if="getGroupFunds(group.id).length === 0" class="group-empty">
            {{ '暂无基金，拖拽基金到此分组' }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="showGroupModal" class="modal-overlay" @click.self="closeGroupModal">
      <div class="modal-box">
        <h3>{{ editingGroup ? '重命名分组' : '新建分组' }}</h3>
        <BInput
          v-model="groupName"
          :placeholder="'请输入分组名称'"
          ref="groupNameInput"
          @keydown="(e) => e.key === 'Enter' && saveGroup()"
        />
        <div class="modal-actions">
          <BButton @click="closeGroupModal">{{ '取消' }}</BButton>
          <BButton type="primary" @click="saveGroup" :disabled="!groupName.trim()">
            {{ editingGroup ? '保存' : '创建' }}
          </BButton>
        </div>
      </div>
    </div>

    <AlertSettings :fundCode="alertFundCode" :visible="alertFundCode !== ''" @close="alertFundCode = ''" />
  </div>
</template>

<script setup>
import { useFundWatchlist } from '../composables/useFundWatchlist'
import BButton from './BButton.vue'
import BInput from './BInput.vue'
import FundListItems from './FundListItems.vue'
import SkeletonCard from './SkeletonCard.vue'
import AlertSettings from './AlertSettings.vue'

const props = defineProps({
  compareMode: { type: Boolean, default: false },
  compareFunds: { type: Array, default: () => [] },
  showCompareToggle: { type: Boolean, default: false },
  addToRealtimeMode: { type: Boolean, default: false }
})
const emit = defineEmits(['view-fund', 'add-to-compare', 'toggle-compare', 'add-to-realtime'])

const {
  watchlist, groups, loading, editMode, selectedFunds,
  draggingIndex, expandedGroups, totalCount,
  ungroupedFunds, getGroupFunds, isGroupExpanded,
  showGroupModal, editingGroup, groupName, groupNameInput,
  lastEstimateUpdate, isRefreshingEstimates, alertFundCode,
  loadWatchlist, refreshEstimates, adaptiveRefresh, toggleGroup,
  enterEditMode, exitEditMode, toggleSelect, batchDelete,
  removeFund, viewFundDetail, addToCompare,
  onDragStart, onDragEnd, onDragOver, onDrop,
  onGroupDragOver, onGroupDrop,
  openAlertSettings, openAddGroupModal, openEditGroupModal, closeGroupModal, saveGroup, deleteGroup
} = useFundWatchlist(props, emit)
</script>

<style src="./FundWatchlist.css" scoped></style>
