<template>
  <div>
    <div v-if="funds" />
    <div v-if="addFundModalOpen" class="modal-overlay" @click.self="emit('close-add-fund')">
      <div class="modal-box add-fund-modal">
        <div class="modal-title-row">
          <h3>添加基金</h3>
          <button class="modal-close" @click="emit('close-add-fund')" aria-label="关闭">×</button>
        </div>
        <SearchBar
          :model-value="searchTerm"
          @update:model-value="emit('update-search-term', $event)"
          placeholder="输入基金名称或代码"
          @search="emit('search')"
          autofocus
        />
        <div v-if="searchLoading" class="add-loading">搜索中...</div>
        <div v-else-if="searchResults.length > 0" class="add-result-list">
          <button v-for="item in searchResults" :key="item.CODE" class="add-result-item" :class="{ selected: isSelected?.(item.CODE) }" @click="emit('select-fund', item)">
            <span class="fund-code">{{ item.CODE }}</span>
            <span class="fund-name">{{ item.NAME }}</span>
          </button>
        </div>
        <div v-else-if="searchTerm" class="add-empty">未找到匹配基金</div>
        <div v-else class="add-empty">输入基金名称、简称或 6 位代码后选择基金</div>
        <div class="modal-actions">
          <button class="btn" @click="emit('close-add-fund')">取消</button>
          <button class="btn btn-primary" @click="emit('confirm-add-fund')" :disabled="!selectedFunds?.length && !searchTerm">确定添加</button>
        </div>
      </div>
    </div>

    <div v-if="holdingModal?.open" class="modal-overlay" @click.self="emit('close-holding')">
      <div class="modal-box holding-modal">
        <div class="modal-title-row holding-title-row">
          <div>
            <div class="modal-kicker">买卖交易</div>
            <h3>{{ holdingModal.fund?.name }} <span class="fund-code-sm">#{{ holdingModal.fund?.code }}</span></h3>
          </div>
          <button class="modal-close" @click="emit('close-holding')" aria-label="关闭">×</button>
        </div>
        <div class="fund-modal-info holding-summary-card">
          <div class="fund-nav-info">
            <div>
              <span class="nav-label">上一交易日净值</span>
              <span class="nav-value">{{ holdingModal.fund?.dwjz || '-' }}</span>
            </div>
            <span class="nav-date" v-if="holdingModal.fund?.jzrq">{{ holdingModal.fund.jzrq }}</span>
          </div>
        </div>
        <div class="elegant-trade-box">
          <div class="trade-toggle">
            <div class="trade-toggle-btn buy" :class="{ active: tradeForm?.type === 'buy' }" @click="emit('trade-type', 'buy')">加仓买入</div>
            <div class="trade-toggle-btn sell" :class="{ active: tradeForm?.type === 'sell' }" @click="emit('trade-type', 'sell')">减仓卖出</div>
          </div>
          <div class="form-group elegant-input-group">
            <label>交易日期</label>
            <div class="input-wrapper date-wrapper">
              <input :value="tradeForm?.tradeDate" @input="emit('update-trade-date', ($event.target as HTMLInputElement).value)" type="date" class="modal-input no-border" :max="todayDate" />
            </div>
          </div>
          <div class="trade-nav-derived" v-if="getTradeNav?.() > 0">
            <span>参考净值：¥{{ (getTradeNav?.() ?? 0).toFixed(4) }}</span>
            <span class="nav-date-hint" v-if="tradeForm?.tradeDate === todayDate">净值状态仅供参考</span>
          </div>
          <div class="form-group elegant-input-group">
            <label>{{ tradeForm?.type === 'buy' ? '加仓金额' : '减仓份额' }}</label>
            <div class="input-wrapper">
              <span class="prefix">{{ tradeForm?.type === 'buy' ? '¥' : '' }}</span>
              <input :value="tradeForm?.inputValue" @input="emit('update-trade-value', ($event.target as HTMLInputElement).value)" type="number" step="any" :placeholder="tradeForm?.type === 'buy' ? '请输入加仓金额' : '请输入减仓份额'" class="modal-input no-border highlight" />
            </div>
          </div>
          <div class="modal-actions elegant-actions">
            <button class="elegant-btn-cancel" @click="emit('close-holding')">取消</button>
            <button class="elegant-btn-confirm" :class="tradeForm?.type" @click="emit('save-trade')" :disabled="!canSubmitTrade?.()">{{ submitButtonText?.() }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="tradeHistoryModal?.open" class="modal-overlay" @click.self="emit('close-trade-history')">
      <div class="modal-box holding-modal trade-history-modal">
        <div class="modal-title-row holding-title-row">
          <div>
            <div class="modal-kicker">买卖记录</div>
            <h3>{{ tradeHistoryModal.fund?.name }} <span class="fund-code-sm">#{{ tradeHistoryModal.fund?.code }}</span></h3>
          </div>
          <button class="modal-close" @click="emit('close-trade-history')" aria-label="关闭">×</button>
        </div>
        <div class="trade-history-table" v-if="tradeRecords?.length">
          <div class="trade-history-row trade-history-head">
            <span>类型</span><span>时间</span><span>金额</span><span>份额</span><span>状态</span>
          </div>
          <div class="trade-history-row" v-for="record in tradeRecords" :key="record.id">
            <span class="trade-type" :class="record.type">{{ record.type === 'buy' ? '买' : '卖' }}</span>
            <span>{{ record.tradeDate || '-' }}</span>
            <span>¥{{ formatMoney?.(record.amount) }}</span>
            <span>{{ formatShare?.(record.share) }}</span>
            <span class="trade-status" :class="record.status">{{ record.status === 'pending' ? '挂起' : '已更新' }}</span>
          </div>
        </div>
        <div class="trade-history-empty" v-else>暂无买卖记录</div>
      </div>
    </div>

    <div v-if="showGroupModal" class="modal-overlay" @click.self="emit('close-group')">
      <div class="modal-box group-modal">
        <div class="modal-title-row">
          <h3>{{ editingGroup ? '重命名分组' : '新建分组' }}</h3>
          <button class="modal-close" @click="emit('close-group')" aria-label="关闭">×</button>
        </div>
        <input :value="groupName" @input="emit('update-group-name', ($event.target as HTMLInputElement).value)" type="text" placeholder="请输入分组名称" class="modal-input group-name-input" @keyup.enter="emit('save-group')" autofocus />
        <div class="modal-actions">
          <button class="btn" @click="emit('close-group')">取消</button>
          <button class="btn btn-primary" @click="emit('save-group')" :disabled="!groupName?.trim()">{{ editingGroup ? '保存' : '创建' }}</button>
        </div>
      </div>
    </div>

    <div v-if="showEditModal" class="modal-overlay" @click.self="emit('close-edit')">
      <div class="modal-box holding-modal">
        <div class="modal-title-row holding-title-row">
          <div>
            <div class="modal-kicker">{{ editForm?.fund ? (holdings?.[editForm.fund.code] ? '修改持仓' : '设置持仓') : '设置持仓' }}</div>
            <h3>{{ editForm?.fund?.name }} <span class="fund-code-sm">#{{ editForm?.fund?.code }}</span></h3>
          </div>
          <button class="modal-close" @click="emit('close-edit')" aria-label="关闭">×</button>
        </div>
        <div class="set-holding-form">
          <div class="form-group elegant-input-group">
            <label>持有金额 (元)</label>
            <div class="input-wrapper">
              <span class="prefix">¥</span>
              <input :value="editForm?.amount" @input="emit('update-edit-amount', ($event.target as HTMLInputElement).value)" type="number" step="any" placeholder="请输入当前持有金额" class="modal-input no-border highlight" />
            </div>
          </div>
          <div class="form-group elegant-input-group">
            <label>持有收益 (元)</label>
            <div class="input-wrapper">
              <span class="prefix">¥</span>
              <input :value="editForm?.profit" @input="emit('update-edit-profit', ($event.target as HTMLInputElement).value)" type="number" step="any" placeholder="0" class="modal-input no-border" />
            </div>
          </div>
          <div class="modal-actions elegant-actions">
            <button class="elegant-btn-cancel" @click="emit('close-edit')">取消</button>
            <button class="elegant-btn-confirm buy" @click="emit('save-edit')">保存修改</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
