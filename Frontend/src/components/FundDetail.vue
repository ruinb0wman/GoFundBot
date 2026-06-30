<template>
  <div class="fund-detail">
    <FundBasicInfo
      :fundCode="currentFundCode"
      :fundData="fundDetail"
      :riskMetrics="riskMetrics"
      @trigger-ai-analysis="handleStartAIAnalysis"
    />

    <div v-show="showAIAnalysis" class="ai-analysis-section">
      <FundAIAnalysis
        ref="fundAIAnalysisRef"
        :fundCode="currentFundCode"
        @close="showAIAnalysis = false"
        @analysis-complete="handleAnalysisComplete"
      />
    </div>

    <div v-if="fundDetail" class="dashboard">
      <div class="main-area">
        <div class="card card-chart">
          <FundChart
            :netWorthTrend="processedNetWorthTrend"
            :acWorthTrend="processedAcWorthTrend"
            :grandTotal="fundDetail.total_return_trend"
          />
        </div>

        <div class="grid-2">
          <div class="card card-md clickable" @click="openModal('ranking')">
            <FundRankingTrend :rateInSimilarType="fundDetail.ranking_trend" :rateInSimilarPercent="fundDetail.ranking_percentage" />
          </div>
          <div class="card card-md clickable" @click="openModal('asset')">
            <FundAssetAllocation :assetAllocation="fundDetail.asset_allocation" />
          </div>
        </div>

        <div class="grid-2">
          <div class="card card-md clickable" @click="openModal('holder')">
            <FundHolderStructure :holderStructure="fundDetail.holder_structure" />
          </div>
          <div class="card card-md clickable" @click="openModal('scale')">
            <FundScaleChange :fluctuationScale="fundDetail.scale_fluctuation" />
          </div>
        </div>

        <div class="card card-full clickable" @click="openModal('subscription')">
          <FundSubscription :subscriptionRedemption="fundDetail.subscription_redemption" />
        </div>
      </div>

      <div class="sidebar">
        <div class="card card-sidebar clickable" @click="openModal('portfolio')">
          <FundPortfolio :portfolio="fundDetail.portfolio" @stock-click="handleStockClick" />
        </div>
        <div class="card card-sidebar clickable" @click="openModal('manager')">
          <FundManagerInfo :fundManagers="fundDetail.fund_managers" />
        </div>
        <div class="card card-sidebar clickable" @click="openModal('ability')">
          <FundAbilityEval :performanceEvaluation="fundDetail.performance_evaluation" />
        </div>
        <div class="card card-sidebar clickable" @click="openModal('sametype')">
          <FundSameType :sameTypeFunds="fundDetail.same_type_funds" @fund-select="handleSameTypeFundSelect" />
        </div>
      </div>
    </div>

    <div v-if="modalVisible" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <button class="modal-close" @click="closeModal">×</button>
        <div class="modal-body">
          <FundRankingTrend v-if="modalType === 'ranking'" :rateInSimilarType="fundDetail.ranking_trend" :rateInSimilarPercent="fundDetail.ranking_percentage" :isExpanded="true" />
          <FundAssetAllocation v-if="modalType === 'asset'" :assetAllocation="fundDetail.asset_allocation" />
          <FundHolderStructure v-if="modalType === 'holder'" :holderStructure="fundDetail.holder_structure" />
          <FundScaleChange v-if="modalType === 'scale'" :fluctuationScale="fundDetail.scale_fluctuation" />
          <FundPortfolio v-if="modalType === 'portfolio'" :portfolio="fundDetail.portfolio" @stock-click="handleStockClick" />
          <FundManagerInfo v-if="modalType === 'manager'" :fundManagers="fundDetail.fund_managers" />
          <FundAbilityEval v-if="modalType === 'ability'" :performanceEvaluation="fundDetail.performance_evaluation" />
          <FundSubscription v-if="modalType === 'subscription'" :subscriptionRedemption="fundDetail.subscription_redemption" />
          <FundSameType v-if="modalType === 'sametype'" :sameTypeFunds="fundDetail.same_type_funds" :isExpanded="true" @fund-select="handleSameTypeFundSelect" />
        </div>
      </div>
    </div>

    <div v-if="stockModalVisible" class="modal-overlay" @click.self="closeStockModal">
      <div class="modal-content stock-modal-content">
        <button class="modal-close" @click="closeStockModal">×</button>
        <div class="modal-body">
          <StockPopup :stockData="stockQuoteData" :loading="stockQuoteLoading" :error="stockQuoteError" />
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="skeleton-loading">
      <SkeletonCard :lines="4" :height="160" title />
      <SkeletonChart :height="300" />
      <div class="skeleton-grid"><SkeletonCard v-for="n in 3" :key="n" :lines="2" :height="100" /></div>
    </div>

    <div v-else-if="error" class="error">
      <div class="error-icon"><LucideIcon name="TriangleAlert" :size="32" /></div>
      <p>{{ error }}</p>
      <button @click="retry" class="retry-btn">重试</button>
    </div>

    <div v-else-if="!currentFundCode" class="empty-state">
      <div class="empty-icon"><LucideIcon name="BarChart3" :size="32" /></div>
      <p>请输入基金代码或从搜索结果中选择基金</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import LucideIcon from './LucideIcon.vue'
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
import FundAIAnalysis from './FundAIAnalysis.vue'
import StockPopup from './StockPopup.vue'
import SkeletonCard from './SkeletonCard.vue'
import SkeletonChart from './SkeletonChart.vue'
import { useFundDetail } from '../composables/useFundDetail'

const props = defineProps({ fundCode: { type: String, default: '' } })
const emit = defineEmits(['navigate-to-fund'])

const {
  currentFundCode, fundDetail, loading, error, showAIAnalysis,
  fundAIAnalysisRef, riskMetrics, processedNetWorthTrend, processedAcWorthTrend,
  modalVisible, modalType, openModal, closeModal,
  stockModalVisible, stockQuoteLoading, stockQuoteData, stockQuoteError,
  handleStockClick, closeStockModal, handleSameTypeFundSelect,
  handleStartAIAnalysis, handleAnalysisComplete, retry
} = useFundDetail(props, emit)
</script>

<style scoped>
@import './FundDetail.css';
</style>
