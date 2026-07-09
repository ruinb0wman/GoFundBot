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
        <BCard :body-style="{ height: '500px', display: 'flex', flexDirection: 'column' }">
          <FundChart
            :netWorthTrend="processedNetWorthTrend"
            :acWorthTrend="processedAcWorthTrend"
            :grandTotal="fundDetail.total_return_trend"
            :trades="tradeRecords"
          />
        </BCard>

        <div class="grid-2">
          <BCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('ranking')">
            <FundRankingTrend :rateInSimilarType="fundDetail.ranking_trend" :rateInSimilarPercent="fundDetail.ranking_percentage" />
          </BCard>
          <BCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('asset')">
            <FundAssetAllocation :assetAllocation="fundDetail.asset_allocation" />
          </BCard>
        </div>

        <div class="grid-2">
          <BCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('holder')">
            <FundHolderStructure :holderStructure="fundDetail.holder_structure" />
          </BCard>
          <BCard class="clickable" :body-style="{ height: '450px', display: 'flex', flexDirection: 'column' }" @click="openModal('scale')">
            <FundScaleChange :fluctuationScale="fundDetail.scale_fluctuation" />
          </BCard>
        </div>

        <BCard class="clickable" :body-style="{ height: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('subscription')">
          <FundSubscription :subscriptionRedemption="fundDetail.subscription_redemption" />
        </BCard>
      </div>

      <div class="sidebar">
        <BCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('portfolio')">
          <FundPortfolio :portfolio="fundDetail.portfolio" @stock-click="handleStockClick" />
        </BCard>
        <BCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('manager')">
          <FundManagerInfo :managers="fundDetail.fund_managers" />
        </BCard>
        <BCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('ability')">
          <FundAbilityEval :performanceEvaluation="fundDetail.performance_evaluation" />
        </BCard>
        <BCard class="clickable" :body-style="{ flex: '1', minHeight: '300px', maxHeight: '480px', display: 'flex', flexDirection: 'column' }" @click="openModal('sametype')">
          <FundSameType :sameTypeFunds="fundDetail.same_type_funds" @fund-select="handleSameTypeFundSelect" />
        </BCard>
      </div>
    </div>

    <div v-if="modalVisible" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <BButton circle size="small" @click="closeModal">×</BButton>
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
        <BButton circle size="small" @click="closeStockModal">×</BButton>
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
      <BButton type="danger" @click="retry">重试</BButton>
    </div>

    <div v-else-if="!currentFundCode" class="empty-state">
      <div class="empty-icon"><LucideIcon name="BarChart3" :size="32" /></div>
      <p>请输入基金代码或从搜索结果中选择基金</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import BCard from './BCard.vue'
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
  fundAIAnalysisRef, riskMetrics, tradeRecords,
  processedNetWorthTrend, processedAcWorthTrend,
  modalVisible, modalType, openModal, closeModal,
  stockModalVisible, stockQuoteLoading, stockQuoteData, stockQuoteError,
  handleStockClick, closeStockModal, handleSameTypeFundSelect,
  handleStartAIAnalysis, handleAnalysisComplete, retry
} = useFundDetail(props, emit)
</script>

<style scoped>
@import './FundDetail.css';
</style>
