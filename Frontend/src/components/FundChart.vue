<template>
  <div class="fund-chart-card">
    <div class="top-tabs">
      <div
        class="tab-item"
        :class="{ active: activeTab === 'performance' }"
        @click="switchTab('performance')"
      >
        {{ t('chart.performanceTrend') }}
       </div>
       <div
         class="tab-item"
         :class="{ active: activeTab === 'comparison' }"
         @click="switchTab('comparison')"
       >
         {{ t('chart.returnComparison') }}
       </div>
       <div
         class="tab-item"
         :class="{ active: activeTab === 'drawdown' }"
         @click="switchTab('drawdown')"
       >
         {{ t('chart.drawdownRepair') }}
      </div>
    </div>

    <div class="summary-info" v-if="activeTab === 'performance'">
        <div class="info-group">
            <span class="legend-dot blue"></span>
            <span class="label">{{ t('chart.thisFund') }}</span>
            <br>
            <span class="value" :class="getColor(fundChange)">{{ fundChange > 0 ? '+' : ''}}{{ fundChange }}%</span>
        </div>
    </div>
    <div class="ma-tabs-wrapper" v-if="activeTab === 'performance'">
      <div class="ma-tabs">
        <span v-for="ma in MA_PRESETS" :key="ma.period" :class="{ active: activeMAs.includes(ma.period) }" @click="toggleMA(ma.period)">
          <span class="ma-dot" :style="{ background: ma.color }"></span>{{ ma.label }}
        </span>
      </div>
    </div>

    <div class="summary-info drawdown-info" v-else-if="activeTab === 'drawdown'">
        <div class="info-group">
            <div class="legend-dot-row">
                <span class="legend-line green"></span>
                <span class="label">{{ t('chart.maxDrawdown') }}</span>
            </div>
            <div class="value-row">{{ maxDrawdownInfo.val }}%</div>
        </div>
        <div class="info-group">
             <div class="legend-dot-row">
                <span class="legend-box pink"></span>
                <span class="label">{{ t('chart.drawdownRepairDays') }}</span>
             </div>
             <div class="value-row">{{ maxDrawdownInfo.days ? maxDrawdownInfo.days + t('chart.days') : t('chart.repairing') }}</div>
        </div>
    </div>

    <div class="summary-info comparison-info" v-else-if="activeTab === 'comparison'">
        <div class="info-group" v-for="item in comparisonInfo" :key="item.name">
             <div class="legend-dot-row">
                <span class="legend-dot" :style="{ background: item.color, width: '12px', height: '3px' }"></span>
                <span class="label" style="margin-left: 4px;">{{ item.name }}</span>
             </div>
             <!-- Optional: Add value at end of period? -->
        </div>
    </div>

    <div class="chart-container">
      <div ref="chartEl" class="chart-el"></div>
    </div>

    <div class="time-ranges">
      <div
        v-for="range in timeRanges"
        :key="range.value"
        class="range-item"
        :class="{ active: selectedRange === range.value }"
        @click="setTimeRange(range.value)"
      >
        {{ range.label }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { MA_PRESETS } from '../utils/ma'
import { useFundChart } from '../composables/useFundChart'

const props = defineProps({
  netWorthTrend: { type: Array, default: () => [] },
  acWorthTrend: { type: Array, default: () => [] },
  grandTotal: { type: Array, default: () => [] },
  trades: { type: Array, default: () => [] }
})

const {
  chartEl,
  timeRanges,
  selectedRange,
  setTimeRange,
  activeTab,
  switchTab,
  fundChange,
  maxDrawdownInfo,
  comparisonInfo,
  getColor,
  activeMAs,
  toggleMA,
} = useFundChart(props)
</script>

<style scoped>
.fund-chart-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.top-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-subtle);
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 15px 0;
  font-size: 16px;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  font-weight: 500;
}

.tab-item.active {
  color: var(--text-primary);
  font-weight: bold;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  background: var(--color-primary);
  border-radius: 2px;
}

.summary-info {
  display: flex;
  justify-content: space-around;
  padding: 15px 20px 5px;
}

.info-group {
    text-align: center;
}

.legend-dot {
    display: inline-block;
    width: 8px;
    height: 3px;
    vertical-align: middle;
    margin-right: 5px;
    background: var(--color-primary);
    border-radius: 2px;
}

.legend-dot-row {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
}

.legend-line.green {
    width: 12px;
    height: 3px;
    background: var(--color-success);
    margin-right: 5px;
}

.legend-box.pink {
    width: 12px;
    height: 12px;
    background: var(--color-danger-bg);
    margin-right: 5px;
}

.label {
    font-size: 13px;
    color: var(--text-tertiary);
}

.value {
    font-size: 18px;
    font-weight: bold;
    display: block;
    margin-top: 4px;
}

.value-row {
    font-size: 18px;
    font-weight: bold;
    color: var(--text-primary);
}

.text-red { color: var(--color-danger); }
.text-green { color: var(--color-success); }

.chart-container {
  padding: 0 10px;
  flex: 1;
  min-height: 0;
}

.chart-el {
  width: 100%;
  height: 100%;
  min-height: 280px;
}

.ma-tabs-wrapper {
  display: flex;
  justify-content: center;
  padding: 4px 20px 2px;
}

.ma-tabs {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  align-items: center;
}

.ma-tabs span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.ma-tabs span:hover {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.ma-tabs span.active {
  color: var(--color-primary);
  font-weight: 600;
  background: var(--color-primary-bg);
}

.ma-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.time-ranges {
  display: flex;
  justify-content: space-between;
  padding: 10px 20px;
}

.range-item {
  padding: 4px 12px;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 13px;
  border-radius: 12px;
}

.range-item.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-weight: 500;
}
</style>
