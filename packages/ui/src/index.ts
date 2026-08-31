import type { App, Plugin } from 'vue'
import './index.css'
import BButton from './components/BButton.vue'
import BInput from './components/BInput.vue'
import BInputNumber from './components/BInputNumber.vue'
import BCheckbox from './components/BCheckbox.vue'
import BSwitch from './components/BSwitch.vue'
import BRadio from './components/BRadio.vue'
import BRadioGroup from './components/BRadioGroup.vue'
import BDatePicker from './components/BDatePicker.vue'
import BTimePicker from './components/BTimePicker.vue'
import BFileInput from './components/BFileInput.vue'
import BaseModal from './components/BaseModal.vue'
import BDialog from './components/BDialog.vue'
import BCard from './components/BCard.vue'
import SkeletonCard from './components/SkeletonCard.vue'
import SkeletonChart from './components/SkeletonChart.vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import OfflineBanner from './components/OfflineBanner.vue'
import LucideIcon from './components/LucideIcon.vue'

// 组件导出
export {
  BButton,
  BInput,
  BInputNumber,
  BCheckbox,
  BSwitch,
  BRadio,
  BRadioGroup,
  BDatePicker,
  BTimePicker,
  BFileInput,
  BaseModal,
  BDialog,
  BCard,
  SkeletonCard,
  SkeletonChart,
  ErrorBoundary,
  OfflineBanner,
  LucideIcon,
}

// 设计 token
export * from './tokens/index'

// composables
export { useOnlineStatus } from './composables/useOnlineStatus'

/** 全局注册插件：app.use(GofundUI) */
export const GofundUI: Plugin = {
  install(app: App) {
    const components = [
      BButton, BInput, BInputNumber, BCheckbox, BSwitch,
      BRadio, BRadioGroup, BDatePicker, BTimePicker, BFileInput,
      BaseModal, BDialog, BCard,
      SkeletonCard, SkeletonChart, ErrorBoundary, OfflineBanner, LucideIcon,
    ]
    for (const comp of components) {
      const name = (comp as { name?: string; __name?: string }).name
        ?? (comp as { name?: string; __name?: string }).__name
      if (name) app.component(name, comp)
    }
  },
}

export default GofundUI
