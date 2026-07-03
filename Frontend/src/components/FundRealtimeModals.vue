<template>
  <div>
    <div v-if="funds" />
    <BaseModal :visible="addFundModalOpen" width="520" @close="emit('close-add-fund')">
      <template #header>
        <h3>{{ t('fund.realtimeModal.title') }}</h3>
      </template>
      <FundSearch
        :select-mode="true"
        autofocus
        @fund-selected="emit('select-fund', $event)"
      />
      <template #footer>
        <BButton @click="emit('close-add-fund')">{{ t('fund.realtimeModal.cancel') }}</BButton>
        <BButton type="primary" @click="emit('confirm-add-fund')" :disabled="!selectedFunds?.length">{{ t('fund.realtimeModal.confirmAdd') }}</BButton>
      </template>
    </BaseModal>

    <BaseModal :visible="holdingModal?.open" width="560" height="auto" @close="emit('close-holding')">
      <template #header>
        <div>
          <div class="modal-kicker">{{ t('fund.realtimeModal.trade') }}</div>
          <h3 style="margin:0">{{ holdingModal.fund?.name }} <span class="fund-code-sm">#{{ holdingModal.fund?.code }}</span></h3>
        </div>
      </template>
      <div class="holding-summary-card">
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
          <BDatePicker
            :modelValue="tradeForm?.tradeDate"
            @update:modelValue="emit('update-trade-date', $event)"
            :max="todayDate"
            class="modal-date"
          />
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
      </div>
      <template #footer>
        <BButton @click="emit('close-holding')">{{ t('fund.realtimeModal.cancel') }}</BButton>
        <BButton :type="tradeForm?.type === 'sell' ? 'danger' : 'primary'" @click="emit('save-trade')" :disabled="!canSubmitTrade?.()">{{ submitButtonText?.() }}</BButton>
      </template>
    </BaseModal>

    <BaseModal :visible="tradeHistoryModal?.open" width="680" height="auto" @close="emit('close-trade-history')">
      <template #header>
        <div>
          <div class="modal-kicker">{{ t('fund.realtimeModal.tradeHistory') }}</div>
          <h3 style="margin:0">{{ tradeHistoryModal.fund?.name }} <span class="fund-code-sm">#{{ tradeHistoryModal.fund?.code }}</span></h3>
        </div>
      </template>
      <div class="trade-history-table" v-if="tradeRecords?.length">
        <div class="trade-history-row trade-history-head">
          <span>{{ t('fund.realtimeModal.type') }}</span><span>{{ t('fund.realtimeModal.time') }}</span><span>{{ t('fund.realtimeModal.amount') }}</span><span>{{ t('fund.realtimeModal.price') }}</span><span>{{ t('fund.realtimeModal.shares') }}</span><span>{{ t('fund.realtimeModal.status') }}</span>
        </div>
        <div class="trade-history-row" v-for="record in tradeRecords" :key="record.id">
          <span class="trade-type" :class="record.type">{{ record.type === 'buy' ? t('fund.realtimeModal.buy') : t('fund.realtimeModal.sell') }}</span>
          <span>{{ record.tradeDate || '-' }}</span>
          <span>¥{{ formatMoney?.(record.amount) }}</span>
          <span>{{ record.nav != null ? record.nav.toFixed(4) : '-' }}</span>
          <span>{{ formatShare?.(record.share) }}</span>
          <span class="trade-status" :class="record.status">{{ record.status === 'pending' ? t('fund.realtimeModal.pending') : t('fund.realtimeModal.updated') }}</span>
        </div>
      </div>
      <div class="trade-history-empty" v-else>{{ t('fund.realtimeModal.noRecords') }}</div>
    </BaseModal>

    <BaseModal :visible="showGroupModal" width="360" height="auto" @close="emit('close-group')">
      <template #header>
        <h3 style="margin:0">{{ editingGroup ? t('fund.realtimeModal.renameGroup') : t('fund.realtimeModal.newGroup') }}</h3>
      </template>
      <input :value="groupName" @input="emit('update-group-name', ($event.target as HTMLInputElement).value)" type="text" :placeholder="t('fund.realtimeModal.groupPlaceholder')" class="modal-input group-name-input" @keyup.enter="emit('save-group')" autofocus />
      <template #footer>
        <BButton @click="emit('close-group')">{{ t('fund.realtimeModal.cancel') }}</BButton>
        <BButton type="primary" @click="emit('save-group')" :disabled="!groupName?.trim()">{{ editingGroup ? t('fund.realtimeModal.save') : t('fund.realtimeModal.create') }}</BButton>
      </template>
    </BaseModal>

    <BaseModal :visible="showEditModal" width="560" height="auto" @close="emit('close-edit')">
      <template #header>
        <div>
          <div class="modal-kicker">{{ editForm?.fund ? (holdings?.[editForm.fund.code] ? t('fund.realtimeModal.editPosition') : t('fund.realtimeModal.setPosition')) : t('fund.realtimeModal.setPosition') }}</div>
          <h3 style="margin:0">{{ editForm?.fund?.name }} <span class="fund-code-sm">#{{ editForm?.fund?.code }}</span></h3>
        </div>
      </template>
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
      </div>
      <template #footer>
        <BButton @click="emit('close-edit')">{{ t('fund.realtimeModal.cancel') }}</BButton>
        <BButton type="primary" @click="emit('save-edit')">{{ t('fund.realtimeModal.saveChanges') }}</BButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BButton from './BButton.vue'
import BaseModal from './BaseModal.vue'
import BDatePicker from './BDatePicker.vue'
import FundSearch from './FundSearch.vue'
const { t } = useI18n()
defineOptions({ name: 'FundRealtimeModals' })

const props = defineProps<{
  addFundModalOpen: boolean
  selectedFunds: any[]
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
  getTradeNav?: () => number
  canSubmitTrade?: () => boolean
  submitButtonText?: () => string
  formatMoney?: (v: any) => string
  formatShare?: (v: any) => string
}>()

const emit = defineEmits<{
  (e: 'close-add-fund'): void
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

<style scoped>
.modal-kicker {
  margin-bottom: 4px;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.fund-code-sm {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-left: 4px;
}

.holding-summary-card {
  padding: 16px;
  margin-bottom: 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--bg-page) 0%, var(--bg-card) 100%);
}

.fund-nav-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.nav-label {
  display: block;
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.nav-value {
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 800;
}

.nav-date {
  color: var(--text-tertiary);
  font-size: 13px;
  white-space: nowrap;
}

.form-group { margin-bottom: 12px; }

.modal-input { width: 100%; padding: 8px; box-sizing: border-box; }

.elegant-trade-box {
  padding-top: 16px;
}

.trade-toggle {
  display: flex;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  margin-bottom: 20px;
  overflow: hidden;
  padding: 3px;
}

.trade-toggle-btn {
  flex: 1;
  text-align: center;
  padding: 9px 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 8px;
}

.trade-toggle-btn.buy.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.trade-toggle-btn.sell.active {
  background: var(--color-warning-bg);
  color: var(--color-warning);
  box-shadow: var(--shadow-md);
}

.elegant-input-group label {
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 8px;
  font-weight: 700;
  display: block;
}

.elegant-input-group .input-wrapper {
  display: flex;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 0 14px;
  transition: all 0.25s;
  min-height: 48px;
}

.elegant-input-group .input-wrapper:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-bg);
  background: var(--bg-card);
}

.elegant-input-group .prefix {
  color: var(--text-tertiary);
  font-size: 16px;
  margin-right: 8px;
  font-weight: 800;
}

.elegant-input-group .modal-input.no-border {
  border: none;
  outline: none;
  box-shadow: none;
  font-size: 15px;
  padding: 12px 0;
  flex: 1;
  background: transparent;
  width: 100%;
  box-sizing: border-box;
}

.elegant-input-group .modal-input.highlight {
  font-weight: bold;
  color: var(--text-primary);
  font-size: 16px;
}

.modal-date {
  width: 100%;
  min-height: 48px;
  border-radius: 10px;
}

.trade-nav-derived {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-primary-bg);
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--color-primary);
  font-weight: 600;
}

.nav-date-hint {
  color: var(--color-warning);
  font-weight: 500;
  font-size: 12px;
}

.trade-history-table {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.trade-history-row {
  min-width: 600px;
  display: grid;
  grid-template-columns: 72px 0.66fr 1fr 1fr 1fr 80px;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}

.trade-history-row:last-child { border-bottom: none; }

.trade-history-head {
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-weight: 800;
}

.trade-type,
.trade-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-width: 44px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-weight: 800;
}

.trade-type.buy { color: var(--color-danger); background: var(--color-danger-bg); }
.trade-type.sell { color: var(--color-success); background: var(--color-success-bg); }

.trade-status.settled { color: var(--color-primary); background: var(--color-primary-bg); }
.trade-status.pending { color: var(--color-warning); background: var(--color-warning-bg); }

.trade-history-empty {
  padding: 28px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
}

.group-name-input {
  margin-bottom: 12px;
}

.set-holding-form {
  padding-top: 2px;
}
</style>
