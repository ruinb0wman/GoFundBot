<template>
  <div class="watchlist-container">
    <div v-if="showCompareToggle" class="compare-toggle-bar">
      <BButton
        :active="compareMode"
        @click="$emit('toggle-compare')"
        icon="TrendingUp"
      >
        {{ compareMode ? t('fund.watchlist.exitCompare') : t('fund.watchlist.compareMode') }}
        <span v-if="compareFunds.length && compareMode" class="compare-count">{{ compareFunds.length }}</span>
      </BButton>
      <div v-if="compareMode && compareFunds.length > 0" class="compare-selected">
        <div v-for="fund in compareFunds" :key="fund.code" class="compare-tag">
          <span class="tag-name">{{ fund.name }}</span>
        </div>
      </div>
      <div v-if="compareMode && compareFunds.length === 0" class="compare-hint">
        <LucideIcon name="ArrowBigUp" :size="14" /> {{ t('fund.watchlist.compareHint') }}
      </div>
      <div v-if="compareMode && compareFunds.length === 1" class="compare-hint">
        {{ t('fund.watchlist.compareNeed', { count: 1 }) }}
      </div>
    </div>

    <div class="watchlist-header">
      <h2>
        <span class="header-icon"><LucideIcon name="Star" :size="18" /></span>
        {{ t('fund.watchlist') }}
        <span class="count-badge" v-if="totalCount">{{ totalCount }}</span>
      </h2>
      <div class="header-actions">
        <BButton plain @click="openAddGroupModal" :title="t('fund.watchlist.newGroup')" icon="FolderPlus" />
        <BButton
          v-if="!editMode && totalCount > 0"
          @click="enterEditMode"
        >
          {{ t('fund.watchlist.edit') }}
        </BButton>
        <template v-if="editMode">
          <BButton
            type="danger"
            :disabled="selectedFunds.length === 0"
            @click="batchDelete"
          >
            {{ selectedFunds.length > 0 ? t('fund.watchlist.groupDelete', { count: selectedFunds.length }) : t('common.delete') }}
          </BButton>
          <BButton @click="exitEditMode">
            {{ t('fund.watchlist.done') }}
          </BButton>
        </template>
        <BButton
          @click="refreshEstimates"
          :disabled="isRefreshingEstimates || totalCount === 0"
          :title="lastEstimateUpdate ? t('fund.watchlist.estimateUpdated', { time: lastEstimateUpdate }) : t('fund.watchlist.refreshEstimates')"
          icon="RefreshCw"
        />
      </div>
    </div>

    <div v-if="lastEstimateUpdate && totalCount > 0" class="estimate-update-hint">
      <span class="hint-icon"><LucideIcon name="BarChart3" :size="12" /></span>
      <span>{{ t('fund.watchlist.estimateUpdated', { time: lastEstimateUpdate }) }}</span>
      <span class="hint-auto">{{ t('fund.watchlist.autoRefresh') }}</span>
    </div>

    <div v-if="loading && totalCount === 0" class="skeleton-loading">
      <SkeletonCard v-for="n in 4" :key="n" :lines="2" :height="80" />
    </div>

    <div v-else-if="totalCount === 0" class="empty-state">
      <div class="empty-icon"><LucideIcon name="ClipboardList" :size="36" /></div>
      <p>{{ t('fund.watchlist.empty') }}</p>
      <p class="empty-hint">{{ t('fund.watchlist.emptyHint', { icon: '' }) }} <LucideIcon name="Star" :size="12" /></p>
    </div>

    <div v-else class="watchlist-content">
      <div class="fund-group" v-if="ungroupedFunds.length > 0 || groups.length === 0">
        <div class="group-header" @click="toggleGroup(null)">
          <span class="group-toggle"><LucideIcon :name="isGroupExpanded(null) ? 'ChevronDown' : 'ChevronRight'" :size="14" /></span>
          <span class="group-name">{{ groups.length > 0 ? t('fund.watchlist.ungrouped') : t('fund.watchlist.allFunds') }}</span>
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
            <BButton circle size="small" @click="openEditGroupModal(group)" :title="t('fund.watchlist.renameGroup')" icon="Pencil" />
            <BButton circle size="small" type="danger" @click="deleteGroup(group)" :title="t('fund.watchlist.delete')" icon="Trash2" />
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
            {{ t('fund.watchlist.emptyGroup') }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="showGroupModal" class="modal-overlay" @click.self="closeGroupModal">
      <div class="modal-box">
        <h3>{{ editingGroup ? t('fund.watchlist.renameGroup') : t('fund.watchlist.newGroup') }}</h3>
        <input
          v-model="groupName"
          type="text"
          :placeholder="t('fund.watchlist.groupName')"
          class="modal-input"
          @keyup.enter="saveGroup"
          ref="groupNameInput"
        />
        <div class="modal-actions">
          <BButton @click="closeGroupModal">{{ t('fund.watchlist.cancel') }}</BButton>
          <BButton type="primary" @click="saveGroup" :disabled="!groupName.trim()">
            {{ editingGroup ? t('fund.watchlist.save') : t('fund.watchlist.create') }}
          </BButton>
        </div>
      </div>
    </div>

    <AlertSettings :fundCode="alertFundCode" :visible="alertFundCode !== ''" @close="alertFundCode = ''" />
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useFundWatchlist } from '../composables/useFundWatchlist'
import BButton from './BButton.vue'
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
  loadWatchlist, refreshEstimates, toggleGroup,
  enterEditMode, exitEditMode, toggleSelect, batchDelete,
  removeFund, viewFundDetail, addToCompare,
  onDragStart, onDragEnd, onDragOver, onDrop,
  onGroupDragOver, onGroupDrop,
  openAlertSettings, openAddGroupModal, openEditGroupModal, closeGroupModal, saveGroup, deleteGroup
} = useFundWatchlist(props, emit)
</script>

<style src="./FundWatchlist.css" scoped></style>
