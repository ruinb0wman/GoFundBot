<template>
  <Teleport to="body">
    <Transition name="bdialog-fade">
      <div v-if="visible" class="bdialog-overlay" @click.self="onCancel">
        <div class="bdialog-box">
          <div class="bdialog-header">{{ title }}</div>
          <div class="bdialog-body">{{ message }}</div>
          <div class="bdialog-footer">
            <BButton @click="onCancel">{{ cancelText }}</BButton>
            <BButton :type="danger ? 'danger' : 'primary'" @click="onConfirm">{{ confirmText }}</BButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'

withDefaults(defineProps<{
  visible: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>(), {
  title: '确认',
  message: '确定执行此操作吗？',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.bdialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 7000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-overlay, rgba(0, 0, 0, 0.5));
  backdrop-filter: blur(2px);
}

.bdialog-box {
  width: 320px;
  max-width: 90vw;
  background: var(--bg-card, #202127);
  border: 1px solid var(--border-default, #3c3f44);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.bdialog-header {
  padding: 16px 20px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #dfdfd6);
}

.bdialog-body {
  padding: 12px 20px 20px;
  font-size: 13px;
  color: var(--text-secondary, #98989f);
  line-height: 1.5;
}

.bdialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
}

.bdialog-fade-enter-active,
.bdialog-fade-leave-active {
  transition: opacity 0.15s ease;
}

.bdialog-fade-enter-from,
.bdialog-fade-leave-to {
  opacity: 0;
}
</style>
