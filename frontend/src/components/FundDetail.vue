<template>
  <div class="fund-detail">
    <FundBasicInfo
      :fundCode="currentFundCode"
      :fundData="fundDetail"
      :riskMetrics="riskMetrics"
    />

    <div v-if="fundDetail" class="dashboard">
      <div class="main-area">
        <RCard :body-style="{ height: '500px', display: 'flex', flexDirection: 'column' }">
          <FundChart
            :netWorthTrend="processedNetWorthTrend"
            :acWorthTrend="processedAcWorthTrend"
            :grandTotal="fundDetail.total_return_trend"
            :trades="tradeRecords"
          />
        </RCard>

        <div class="grid-2">
          <RCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('ranking')">
            <FundRankingTrend :rateInSimilarType="fundDetail.ranking_trend" :rateInSimilarPercent="fundDetail.ranking_percentage" />
          </RCard>
          <RCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('asset')">
            <FundAssetAllocation :assetAllocation="fundDetail.asset_allocation" />
          </RCard>
        </div>

        <div class="grid-2">
          <RCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('holder')">
            <FundHolderStructure :holderStructure="fundDetail.holder_structure" />
          </RCard>
          <RCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('scale')">
            <FundScaleChange :fluctuationScale="fundDetail.scale_fluctuation" />
          </RCard>
        </div>

        <RCard class="clickable" :body-style="{ height: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('subscription')">
          <FundSubscription :subscriptionRedemption="fundDetail.subscription_redemption" />
        </RCard>
      </div>

      <div class="sidebar">
        <RCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('portfolio')">
          <FundPortfolio :portfolio="fundDetail.portfolio" @stock-click="handleStockClick" />
        </RCard>
        <RCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('manager')">
          <FundManagerInfo :managers="fundDetail.fund_managers" />
        </RCard>
        <RCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('ability')">
          <FundAbilityEval :performanceEvaluation="fundDetail.performance_evaluation" />
        </RCard>
        <RCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('sametype')">
          <FundSameType :sameTypeFunds="fundDetail.same_type_funds" @fund-select="handleSameTypeFundSelect" />
        </RCard>
      </div>
    </div>

    <div v-if="modalVisible" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <RButton circle size="small" @click="closeModal">×</RButton>
        <div class="modal-body">
          <FundRankingTrend v-if="modalType === 'ranking'" :rateInSimilarType="fundDetail.ranking_trend" :rateInSimilarPercent="fundDetail.ranking_percentage" :isExpanded="true" />
          <FundAssetAllocation v-if="modalType === 'asset'" :assetAllocation="fundDetail.asset_allocation" />
          <FundHolderStructure v-if="modalType === 'holder'" :holderStructure="fundDetail.holder_structure" />
          <FundScaleChange v-if="modalType === 'scale'" :fluctuationScale="fundDetail.scale_fluctuation" />
          <FundPortfolio v-if="modalType === 'portfolio'" :portfolio="fundDetail.portfolio" @stock-click="handleStockClick" />
          <FundManagerInfo v-if="modalType === 'manager'" :managers="fundDetail.fund_managers" />
          <FundAbilityEval v-if="modalType === 'ability'" :performanceEvaluation="fundDetail.performance_evaluation" />
          <FundSubscription v-if="modalType === 'subscription'" :subscriptionRedemption="fundDetail.subscription_redemption" />
          <FundSameType v-if="modalType === 'sametype'" :sameTypeFunds="fundDetail.same_type_funds" :isExpanded="true" @fund-select="handleSameTypeFundSelect" />
        </div>
      </div>
    </div>

    <div v-if="stockModalVisible" class="modal-overlay" @click.self="closeStockModal">
      <div class="modal-content stock-modal-content">
        <RButton circle size="small" @click="closeStockModal">×</RButton>
        <div class="modal-body">
          <StockPopup :stockData="stockQuoteData" :loading="stockQuoteLoading" :error="stockQuoteError" />
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="skeleton-loading">
      <RSkeletonCard :lines="4" :height="160" title />
      <RSkeletonChart :height="300" />
      <div class="skeleton-grid"><RSkeletonCard v-for="n in 3" :key="n" :lines="2" :height="100" /></div>
    </div>

    <div v-else-if="error" class="error">
      <div class="error-icon"><RLucideIcon name="TriangleAlert" :size="32" /></div>
      <p>{{ error }}</p>
      <RButton type="danger" @click="retry">重试</RButton>
    </div>

    <div v-else-if="!currentFundCode" class="empty-state">
      <div class="empty-icon"><RLucideIcon name="BarChart3" :size="32" /></div>
      <p>请输入基金代码或从搜索结果中选择基金</p>
    </div>
  </div>
</template>

<script setup lang="ts">

import { RButton, RCard, RLucideIcon, RSkeletonCard, RSkeletonChart } from '@ruinb0w/ui'
import FundBasicInfo from './FundBasicInfo.vue'
import FundChart from './FundChart.vue'
import FundRankingTrend from './FundRankingTrend.vue'
import FundAssetAllocation from './FundAssetAllocation.vue'
import FundScaleChange from './FundScaleChange.vue'
import FundManagerInfo from './FundManagerInfo.vue'
import FundHolderStructure from './FundHolderStructure.vue'
import FundPortfolio from './FundPortfolio.vue'
import FundAbilityEval from './FundAbilityEval.vue'
import FundSubscription from './FundSubscription.vue'
import FundSameType from './FundSameType.vue'
import StockPopup from './StockPopup.vue'

import { useFundDetail } from '../composables/useFundDetail'

const props = defineProps({ fundCode: { type: String, default: '' } })
const emit = defineEmits(['navigate-to-fund'])

const {
  currentFundCode, fundDetail, loading, error,
  riskMetrics, tradeRecords,
  processedNetWorthTrend, processedAcWorthTrend,
  modalVisible, modalType, openModal, closeModal,
  stockModalVisible, stockQuoteLoading, stockQuoteData, stockQuoteError,
  handleStockClick, closeStockModal, handleSameTypeFundSelect,
  retry
} = useFundDetail(props, emit)
</script>

<style scoped>
@import './FundDetail.css';
</style>
