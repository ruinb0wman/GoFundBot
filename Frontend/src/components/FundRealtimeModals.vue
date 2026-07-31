<template>
  <div>
    <div v-if="funds" />
    <BaseModal :visible="addFundModalOpen" width="520" @close="emit('close-add-fund')">
      <template #header>
        <h3>{{ '添加基金' }}</h3>
      </template>
      <FundSearch
        :select-mode="true"
        autofocus
        @fund-selected="emit('select-fund', $event)"
      />
      <template #footer>
        <BButton @click="emit('close-add-fund')">{{ '取消' }}</BButton>
        <BButton type="primary" @click="emit('confirm-add-fund')" :disabled="!selectedFunds?.length">{{ '确定添加' }}</BButton>
      </template>
    </BaseModal>

    <BaseModal :visible="holdingModal?.open" width="560" height="auto" @close="emit('close-holding')">
      <template #header>
        <div>
          <div class="modal-kicker">{{ '买卖交易' }}</div>
          <h3 style="margin:0">{{ holdingModal.fund?.name }} <span class="fund-code-sm">#{{ holdingModal.fund?.code }}</span></h3>
        </div>
      </template>
      <div class="holding-summary-card">
        <div class="fund-nav-info">
          <div>
            <span class="nav-label">{{ '上一交易日净值' }}</span>
            <span class="nav-value">{{ holdingModal.fund?.dwjz || '-' }}</span>
          </div>
          <span class="nav-date" v-if="holdingModal.fund?.jzrq">{{ holdingModal.fund.jzrq }}</span>
        </div>
      </div>
      <div class="elegant-trade-box">
        <div class="trade-toggle">
          <div class="trade-toggle-btn buy" :class="{ active: tradeForm?.type === 'buy' }" @click="emit('trade-type', 'buy')">{{ '加仓买入' }}</div>
          <div class="trade-toggle-btn sell" :class="{ active: tradeForm?.type === 'sell' }" @click="emit('trade-type', 'sell')">{{ '减仓卖出' }}</div>
        </div>
        <div class="form-group elegant-input-group">
          <label>{{ '交易日期' }}</label>
          <BDatePicker
            :modelValue="tradeForm?.tradeDate"
            @update:modelValue="emit('update-trade-date', $event)"
            :max="todayDate"
            class="modal-date"
          />
        </div>
        <div class="trade-nav-derived" v-if="getTradeNav?.() > 0">
          <span>{{ '参考净值：' }} ¥{{ fmtNumber(getTradeNav?.() ?? 0, 4) }}</span>
          <span class="nav-date-hint" v-if="tradeForm?.tradeDate === todayDate">{{ '净值状态仅供参考' }}</span>
        </div>
        <div class="form-group elegant-input-group">
          <label>{{ tradeForm?.type === 'buy' ? '加仓金额' : '减仓份额' }}</label>
          <BInputNumber
            :modelValue="tradeForm?.inputValue"
            @update:modelValue="emit('update-trade-value', $event)"
            :placeholder="tradeForm?.type === 'buy' ? '请输入加仓金额' : '请输入减仓份额'"
            :controls="false"
          >
            <template #prefix v-if="tradeForm?.type === 'buy'">¥</template>
          </BInputNumber>
        </div>
      </div>
      <template #footer>
        <BButton @click="emit('close-holding')">{{ '取消' }}</BButton>
        <BButton :type="tradeForm?.type === 'sell' ? 'danger' : 'primary'" @click="emit('save-trade')" :disabled="!canSubmitTrade?.()">{{ submitButtonText?.() }}</BButton>
      </template>
    </BaseModal>

    <BaseModal :visible="tradeHistoryModal?.open" width="680" height="auto" @close="emit('close-trade-history')">
      <template #header>
        <div>
          <div class="modal-kicker">{{ '持仓记录' }}</div>
          <h3 style="margin:0">{{ tradeHistoryModal.fund?.name }} <span class="fund-code-sm">#{{ tradeHistoryModal.fund?.code }}</span></h3>
        </div>
      </template>
      <div class="history-tabs">
        <div class="history-tab" :class="{ active: historyTab === 'all' }" @click="historyTab = 'all'">{{ '全部' }}</div>
        <div class="history-tab" :class="{ active: historyTab === 'trade' }" @click="historyTab = 'trade'">{{ '买卖' }}</div>
        <div class="history-tab" :class="{ active: historyTab === 'adjust' }" @click="historyTab = 'adjust'">{{ '费用' }}</div>
      </div>
      <div class="trade-history-table" v-if="filteredRecords.length">
        <div class="trade-history-row trade-history-head">
          <span>{{ '类型' }}</span><span>{{ '时间' }}</span><span>{{ '金额' }}</span><span>{{ '价格' }}</span><span>{{ '份额' }}</span><span>{{ '状态' }}</span>
        </div>
        <div class="trade-history-row" v-for="record in filteredRecords" :key="record.id">
          <span v-if="record.type === 'fee'" class="trade-type fee">{{ '手续费' }}</span>
          <span v-else-if="record.type === 'dividend'" class="trade-type dividend">{{ '分红再投' }}</span>
          <span v-else class="trade-type" :class="record.type">{{ record.type === 'buy' ? '买' : '卖' }}</span>
          <span>{{ record.tradeDate || '-' }}</span>
          <span>¥{{ formatMoney?.(record.amount) }}</span>
          <span>{{ record.nav != null && record.nav > 0 ? fmtNumber(record.nav, 4) : '-' }}</span>
          <span>{{ record.share > 0 ? formatShare?.(record.share) : '-' }}</span>
          <span class="trade-status" :class="record.status">{{ record.status === 'pending' ? '挂起' : '已更新' }}</span>
        </div>
      </div>
      <div class="trade-history-empty" v-else>{{ '暂无记录' }}</div>
    </BaseModal>

    <BaseModal :visible="showGroupModal" width="420" height="auto" @close="emit('close-group')">
      <template #header>
        <h3 style="margin:0">{{ editingGroup ? '重命名分组' : '新建分组' }}</h3>
      </template>
      <div style="margin-bottom:12px">
        <BInput
          :modelValue="groupName"
          @update:modelValue="emit('update-group-name', $event)"
          :placeholder="'请输入分组名称'"
          autofocus
          @keydown="(e) => e.key === 'Enter' && emit('save-group')"
        />
      </div>
      <div class="rebalance-section">
        <div class="rebalance-header">
          <span>{{ '再平衡设置' }}</span>
          <BSwitch :modelValue="rebalanceForm?.enabled" @update:modelValue="emit('update-rebalance', 'enabled', $event)" />
        </div>
        <div v-if="rebalanceForm?.enabled" class="rebalance-fields">
          <div class="form-group elegant-input-group">
            <label>{{ '目标占比（每只基金）' }}</label>
            <BInputNumber
              :modelValue="rebalanceForm?.target"
              @update:modelValue="emit('update-rebalance', 'target', $event)"
              :min="1" :max="100" :controls="false"
            >
              <template #suffix>%</template>
            </BInputNumber>
          </div>
          <div class="form-group elegant-input-group">
            <label>{{ '上限阈值' }}</label>
            <BInputNumber
              :modelValue="rebalanceForm?.upper"
              @update:modelValue="emit('update-rebalance', 'upper', $event)"
              :min="1" :max="100" :controls="false"
            >
              <template #suffix>%</template>
            </BInputNumber>
          </div>
          <div class="form-group elegant-input-group">
            <label>{{ '下限阈值' }}</label>
            <BInputNumber
              :modelValue="rebalanceForm?.lower"
              @update:modelValue="emit('update-rebalance', 'lower', $event)"
              :min="0" :max="100" :controls="false"
            >
              <template #suffix>%</template>
            </BInputNumber>
          </div>
        </div>
      </div>
      <template #footer>
        <BButton @click="emit('close-group')">{{ '取消' }}</BButton>
        <BButton type="primary" @click="emit('save-group')" :disabled="!groupName?.trim()">{{ editingGroup ? '保存' : '创建' }}</BButton>
      </template>
    </BaseModal>

    <BaseModal :visible="adjustmentModal?.open" width="560" height="auto" @close="emit('close-adjustment')">
      <template #header>
        <div>
          <div class="modal-kicker">{{ '调整' }}</div>
          <h3 style="margin:0">{{ adjustmentModal.fund?.name }} <span class="fund-code-sm">#{{ adjustmentModal.fund?.code }}</span></h3>
        </div>
      </template>
      <div class="set-holding-form">
        <div class="form-group elegant-input-group">
          <label>{{ '交易日期' }}</label>
          <BDatePicker
            :modelValue="adjustmentForm?.tradeDate"
            @update:modelValue="emit('update-adjustment-date', $event)"
            :max="todayDate"
            class="modal-date"
          />
        </div>
        <div class="form-group elegant-input-group">
          <label>{{ '调整类型' }}</label>
          <div class="trade-toggle">
            <div class="trade-toggle-btn fee" :class="{ active: adjustmentForm?.subtype === 'fee' }" @click="emit('update-adjustment-subtype', 'fee')">{{ '手续费' }}</div>
            <div class="trade-toggle-btn dividend" :class="{ active: adjustmentForm?.subtype === 'dividend' }" @click="emit('update-adjustment-subtype', 'dividend')">{{ '分红再投' }}</div>
          </div>
        </div>
        <div class="form-group elegant-input-group">
          <label>{{ adjustmentForm?.subtype === 'dividend' ? '再投金额' : '调整金额' }}</label>
          <BInputNumber
            :modelValue="adjustmentForm?.amount"
            @update:modelValue="emit('update-adjustment-amount', $event)"
            :placeholder="'手续费金额'"
            :controls="false"
            :min="0"
          >
            <template #prefix>¥</template>
          </BInputNumber>
        </div>
        <div v-if="adjustmentForm?.subtype === 'dividend'" class="form-group elegant-input-group">
          <label>{{ '再投份额' }}</label>
          <BInputNumber
            :modelValue="adjustmentForm?.share"
            @update:modelValue="emit('update-adjustment-share', $event)"
            :placeholder="'请输入再投份额'"
            :controls="false"
            :min="0"
          />
        </div>
        <div class="form-group elegant-input-group">
          <label>{{ '备注' }}</label>
          <BInput
            :modelValue="adjustmentForm?.note"
            @update:modelValue="emit('update-adjustment-note', $event)"
            :placeholder="'可选备注'"
          />
        </div>
      </div>
      <template #footer>
        <BButton @click="emit('close-adjustment')">{{ '取消' }}</BButton>
        <BButton type="primary" @click="emit('save-adjustment')">{{ '保存调整' }}</BButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BButton from './BButton.vue'
import BaseModal from './BaseModal.vue'
import BDatePicker from './BDatePicker.vue'
import BInput from './BInput.vue'
import BInputNumber from './BInputNumber.vue'
import BSwitch from './BSwitch.vue'
import FundSearch from './FundSearch.vue'
import { fmtNumber } from '../utils/number'
defineOptions({ name: 'FundRealtimeModals' })

const historyTab = ref('all')

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
  rebalanceForm: any
  adjustmentModal: any
  adjustmentForm: any
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
  (e: 'update-rebalance', field: string, value: any): void
  (e: 'close-adjustment'): void
  (e: 'save-adjustment'): void
  (e: 'update-adjustment-date', date: string): void
  (e: 'update-adjustment-amount', v: string): void
  (e: 'update-adjustment-note', v: string): void
  (e: 'update-adjustment-subtype', v: string): void
  (e: 'update-adjustment-share', v: string): void
}>()

const filteredRecords = computed(() => {
  if (historyTab.value === 'all') return props.tradeRecords
  if (historyTab.value === 'trade') return props.tradeRecords.filter(r => r.type === 'buy' || r.type === 'sell')
  if (historyTab.value === 'adjust') return props.tradeRecords.filter(r => r.type === 'fee' || r.type === 'dividend')
  return props.tradeRecords
})
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
.trade-type.fee { color: var(--color-primary); background: var(--color-primary-bg); }
.trade-type.dividend { color: var(--color-success); background: var(--color-success-bg); }

.history-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  padding: 3px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  overflow: hidden;
}

.history-tab {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;
}

.history-tab.active {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.trade-status.settled { color: var(--color-primary); background: var(--color-primary-bg); }
.trade-status.pending { color: var(--color-warning); background: var(--color-warning-bg); }

.trade-history-empty {
  padding: 28px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
}

.set-holding-form {
  padding-top: 2px;
}

.rebalance-section {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.rebalance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.rebalance-fields {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
}

.rebalance-fields .form-group {
  margin-bottom: 10px;
}
</style>
