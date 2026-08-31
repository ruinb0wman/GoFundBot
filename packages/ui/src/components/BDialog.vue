<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="visible" class="confirm-mask" @click.self="emit('cancel')">
        <div class="confirm-dialog" role="dialog" :aria-label="title">
          <div class="dialog-head">
            <div>
              <h3>{{ title }}</h3>
              <p v-if="subtitle">{{ subtitle }}</p>
            </div>
            <BButton v-if="closable" circle size="small" @click="emit('cancel')">×</BButton>
          </div>
          <div class="confirm-body">
            <div
              v-for="(opt, i) in options"
              :key="String(opt.value ?? opt.title ?? i)"
              class="confirm-option"
              :class="{ danger: opt.danger }"
              @click="emit('select', opt.value)"
            >
              <span class="confirm-option-icon"><LucideIcon :name="opt.icon" :size="20" /></span>
              <div>
                <strong>{{ opt.title }}</strong>
                <em v-if="opt.desc">{{ opt.desc }}</em>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import LucideIcon from './LucideIcon.vue'

defineOptions({ name: 'BDialog' })

export interface ConfirmDialogOption {
  icon: string
  title: string
  desc?: string
  value?: unknown
  danger?: boolean
}

withDefaults(defineProps<{
  visible: boolean
  title?: string
  subtitle?: string
  options?: ConfirmDialogOption[]
  closable?: boolean
}>(), {
  title: '确认',
  subtitle: '',
  options: () => [],
  closable: true,
})

const emit = defineEmits<{
  (e: 'select', value?: unknown): void
  (e: 'cancel'): void
}>()
</script>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--bg-overlay);
}

.confirm-dialog {
  width: min(480px, 100%);
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.dialog-head h3 {
  margin: 0 0 6px;
  font-size: 18px;
  color: var(--text-primary);
}

.dialog-head p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.confirm-body {
  padding: 16px 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.confirm-option {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.confirm-option:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
}

.confirm-option.danger {
  border-color: var(--color-danger, #e5534b);
}

.confirm-option.danger:hover {
  border-color: var(--color-danger, #e5534b);
  background: var(--color-danger-bg, rgba(229, 83, 75, 0.08));
}

.confirm-option-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.confirm-option strong {
  display: block;
  font-size: 14px;
  color: var(--text-primary);
}

.confirm-option em {
  display: block;
  margin-top: 4px;
  font-style: normal;
  font-size: 12px;
  color: var(--text-secondary);
}

.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.15s ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
