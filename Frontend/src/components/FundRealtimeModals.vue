<template>
  <div>
    <div v-if="funds" />
    <div v-if="addFundModalOpen" class="modal-overlay" @click.self="emit('close-add-fund')">
      <div class="modal-box add-fund-modal">
        <div class="modal-title-row">
          <h3>{{ t('fund.realtimeModal.title') }}</h3>
          <button class="modal-close" @click="emit('close-add-fund')" :aria-label="t('common.close')">×</button>
        </div>
        <SearchBar
          :model-value="searchTerm"
          @update:model-value="emit('update-search-term', $event)"
          :placeholder="t('fund.realtimeModal.searchPlaceholder')"
          @search="emit('search')"
          autofocus
        />
        <div v-if="searchLoading" class="add-loading">{{ t('fund.realtimeModal.searching') }}</div>
        <div v-else-if="searchResults.length > 0" class="add-result-list">
          <button v-for="item in searchResults" :key="item.CODE" class="add-result-item" :class="{ selected: isSelected?.(item.CODE) }" @click="emit('select-fund', item)">
            <span class="fund-code">{{ item.CODE }}</span>
            <span class="fund-name">{{ item.NAME }}</span>
          </button>
        </div>
        <div v-else-if="searchTerm" class="add-empty">{{ t('fund.realtimeModal.noMatch') }}</div>
        <div v-else class="add-empty">{{ t('fund.realtimeModal.searchHint') }}</div>
        <div class="modal-actions">
          <button class="btn" @click="emit('close-add-fund')">{{ t('fund.realtimeModal.cancel') }}</button>
          <button class="btn btn-primary" @click="emit('confirm-add-fund')" :disabled="!selectedFunds?.length && !searchTerm">{{ t('fund.realtimeModal.confirmAdd') }}</button>
        </div>
      </div>
    </div>

    <div v-if="holdingModal?.open" class="modal-overlay" @click.self="emit('close-holding')">
      <div class="modal-box holding-modal">
        <div class="modal-title-row holding-title-row">
          <div>
            <div class="modal-kicker">{{ t('fund.realtimeModal.trade') }}</div>
            <h3>{{ holdingModal.fund?.name }} <span class="fund-code-sm">#{{ holdingModal.fund?.code }}</span></h3>
          </div>
          <button class="modal-close" @click="emit('close-holding')" aria-label="关闭">×</button>
        </div>
        <div class="fund-modal-info holding-summary-card">
          <div class="fund-nav-info">
            <div>
              <span class="nav-label">{{ t('fund.realtimeModal.prevNav') }}</span>
              <span class="nav-value">{{ holdingModal.fund?.dwjz || '-' }}</span>
            </div>
            <span class="nav-date" v-if="holdingModal.fund?.jzrq">{{ holdingModal.fund.jzrq }}</span>
          </div>
        </div>
        <div class="elegant-trade-box">
          <div class="trade-toggle">
            <div class="trade-toggle-btn buy" :class="{ active: tradeForm?.type === 'buy' }" @click="emit('trade-type', 'buy')">{{ t('fund.realtimeModal.buyMore') }}</div>
            <div class="trade-toggle-btn sell" :class="{ active: tradeForm?.type === 'sell' }" @click="emit('trade-type', 'sell')">{{ t('fund.realtimeModal.sellLess') }}</div>
          </div>
          <div class="form-group elegant-input-group">
            <label>{{ t('fund.realtimeModal.tradeDate') }}</label>
            <div class="input-wrapper date-wrapper">
              <input :value="tradeForm?.tradeDate" @input="emit('update-trade-date', ($event.target as HTMLInputElement).value)" type="date" class="modal-input no-border" :max="todayDate" />
            </div>
          </div>
          <div class="trade-nav-derived" v-if="getTradeNav?.() > 0">
            <span>{{ t('fund.realtimeModal.refNav') }} ¥{{ (getTradeNav?.() ?? 0).toFixed(4) }}</span>
            <span class="nav-date-hint" v-if="tradeForm?.tradeDate === todayDate">{{ t('fund.realtimeModal.navHint') }}</span>
          </div>
          <div class="form-group elegant-input-group">
            <label>{{ tradeForm?.type === 'buy' ? t('fund.realtimeModal.increaseAmount') : t('fund.realtimeModal.decreaseShares') }}</label>
            <div class="input-wrapper">
              <span class="prefix">{{ tradeForm?.type === 'buy' ? '¥' : '' }}</span>
              <input :value="tradeForm?.inputValue" @input="emit('update-trade-value', ($event.target as HTMLInputElement).value)" type="number" step="any" :placeholder="tradeForm?.type === 'buy' ? t('fund.realtimeModal.increaseAmountPlaceholder') : t('fund.realtimeModal.decreaseSharesPlaceholder')" class="modal-input no-border highlight" />
            </div>
          </div>
          <div class="modal-actions elegant-actions">
            <button class="elegant-btn-cancel" @click="emit('close-holding')">{{ t('fund.realtimeModal.cancel') }}</button>
            <button class="elegant-btn-confirm" :class="tradeForm?.type" @click="emit('save-trade')" :disabled="!canSubmitTrade?.()">{{ submitButtonText?.() }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="tradeHistoryModal?.open" class="modal-overlay" @click.self="emit('close-trade-history')">
      <div class="modal-box holding-modal trade-history-modal">
        <div class="modal-title-row holding-title-row">
          <div>
            <div class="modal-kicker">{{ t('fund.realtimeModal.tradeHistory') }}</div>
            <h3>{{ tradeHistoryModal.fund?.name }} <span class="fund-code-sm">#{{ tradeHistoryModal.fund?.code }}</span></h3>
          </div>
          <button class="modal-close" @click="emit('close-trade-history')" aria-label="关闭">×</button>
        </div>
        <div class="trade-history-table" v-if="tradeRecords?.length">
          <div class="trade-history-row trade-history-head">
            <span>{{ t('fund.realtimeModal.type') }}</span><span>{{ t('fund.realtimeModal.time') }}</span><span>{{ t('fund.realtimeModal.amount') }}</span><span>{{ t('fund.realtimeModal.shares') }}</span><span>{{ t('fund.realtimeModal.status') }}</span>
          </div>
          <div class="trade-history-row" v-for="record in tradeRecords" :key="record.id">
            <span class="trade-type" :class="record.type">{{ record.type === 'buy' ? t('fund.realtimeModal.buy') : t('fund.realtimeModal.sell') }}</span>
            <span>{{ record.tradeDate || '-' }}</span>
            <span>¥{{ formatMoney?.(record.amount) }}</span>
            <span>{{ formatShare?.(record.share) }}</span>
            <span class="trade-status" :class="record.status">{{ record.status === 'pending' ? t('fund.realtimeModal.pending') : t('fund.realtimeModal.updated') }}</span>
          </div>
        </div>
        <div class="trade-history-empty" v-else>{{ t('fund.realtimeModal.noRecords') }}</div>
      </div>
    </div>

    <div v-if="showGroupModal" class="modal-overlay" @click.self="emit('close-group')">
      <div class="modal-box group-modal">
        <div class="modal-title-row">
          <h3>{{ editingGroup ? t('fund.realtimeModal.renameGroup') : t('fund.realtimeModal.newGroup') }}</h3>
          <button class="modal-close" @click="emit('close-group')" aria-label="关闭">×</button>
        </div>
        <input :value="groupName" @input="emit('update-group-name', ($event.target as HTMLInputElement).value)" type="text" :placeholder="t('fund.realtimeModal.groupPlaceholder')" class="modal-input group-name-input" @keyup.enter="emit('save-group')" autofocus />
        <div class="modal-actions">
          <button class="btn" @click="emit('close-group')">{{ t('fund.realtimeModal.cancel') }}</button>
          <button class="btn btn-primary" @click="emit('save-group')" :disabled="!groupName?.trim()">{{ editingGroup ? t('fund.realtimeModal.save') : t('fund.realtimeModal.create') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showEditModal" class="modal-overlay" @click.self="emit('close-edit')">
      <div class="modal-box holding-modal">
        <div class="modal-title-row holding-title-row">
          <div>
            <div class="modal-kicker">{{ editForm?.fund ? (holdings?.[editForm.fund.code] ? t('fund.realtimeModal.editPosition') : t('fund.realtimeModal.setPosition')) : t('fund.realtimeModal.setPosition') }}</div>
            <h3>{{ editForm?.fund?.name }} <span class="fund-code-sm">#{{ editForm?.fund?.code }}</span></h3>
          </div>
          <button class="modal-close" @click="emit('close-edit')" aria-label="关闭">×</button>
        </div>
        <div class="set-holding-form">
          <div class="form-group elegant-input-group">
            <label>{{ t('fund.realtimeModal.holdAmount') }}</label>
            <div class="input-wrapper">
              <span class="prefix">¥</span>
              <input :value="editForm?.amount" @input="emit('update-edit-amount', ($event.target as HTMLInputElement).value)" type="number" step="any" :placeholder="t('fund.realtimeModal.holdAmountPlaceholder')" class="modal-input no-border highlight" />
            </div>
          </div>
          <div class="form-group elegant-input-group">
            <label>{{ t('fund.realtimeModal.holdProfit') }}</label>
            <div class="input-wrapper">
              <span class="prefix">¥</span>
              <input :value="editForm?.profit" @input="emit('update-edit-profit', ($event.target as HTMLInputElement).value)" type="number" step="any" placeholder="0" class="modal-input no-border" />
            </div>
          </div>
          <div class="modal-actions elegant-actions">
            <button class="elegant-btn-cancel" @click="emit('close-edit')">{{ t('fund.realtimeModal.cancel') }}</button>
            <button class="elegant-btn-confirm buy" @click="emit('save-edit')">{{ t('fund.realtimeModal.saveChanges') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
defineOptions({ name: 'FundRealtimeModals' })

const props = defineProps<{
  addFundModalOpen: boolean
  searchTerm: string
  searchResults: any[]
  selectedFunds: any[]
  searchLoading: boolean
  holdingModal: any
  tradeForm: any
  todayDate: string
  tradeHistoryModal: any
  tradeRecords: any[]
  pendingTxns: any[]
  showGroupModal: boolean
  groupName: string
  editingGroup: any
  showEditModal: boolean
  editForm: any
  holdings: any
  funds: any[]
  isSelected?: (code: string) => boolean
  getTradeNav?: () => number
  canSubmitTrade?: () => boolean
  submitButtonText?: () => string
  formatMoney?: (v: any) => string
  formatShare?: (v: any) => string
}>()

const emit = defineEmits<{
  (e: 'close-add-fund'): void
  (e: 'update-search-term', value: string): void
  (e: 'search'): void
  (e: 'select-fund', fund: any): void
  (e: 'confirm-add-fund'): void
  (e: 'close-holding'): void
  (e: 'trade-type', type: string): void
  (e: 'update-trade-date', date: string): void
  (e: 'update-trade-value', value: string): void
  (e: 'save-trade'): void
  (e: 'close-trade-history'): void
  (e: 'close-group'): void
  (e: 'update-group-name', name: string): void
  (e: 'save-group'): void
  (e: 'close-edit'): void
  (e: 'update-edit-amount', v: string): void
  (e: 'update-edit-profit', v: string): void
  (e: 'save-edit'): void
}>()
</script>
