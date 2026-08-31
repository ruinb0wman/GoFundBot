<script setup lang="ts">
defineOptions({ name: 'BSwitch' })

type BSwitchSize = 'default' | 'small'

const props = withDefaults(defineProps<{
  modelValue?: boolean
  activeText?: string
  inactiveText?: string
  disabled?: boolean
  loading?: boolean
  size?: BSwitchSize
}>(), {
  modelValue: false,
  activeText: '',
  inactiveText: '',
  disabled: false,
  loading: false,
  size: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function handleClick() {
  if (props.disabled || props.loading) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    handleClick()
  }
}
</script>

<template>
  <span
    class="b-switch"
    :class="[`b-switch--${size}`, {
      'b-switch--checked': modelValue,
      'b-switch--disabled': disabled,
      'b-switch--loading': loading,
    }]"
    role="switch"
    :aria-checked="modelValue"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled ? -1 : 0"
    @click="handleClick"
    @keydown="handleKeydown"
  >
    <span v-if="inactiveText && !modelValue" class="b-switch__label b-switch__label--inactive">{{ inactiveText }}</span>
    <span class="b-switch__track">
      <span class="b-switch__knob">
        <span v-if="loading" class="b-switch__spinner" />
      </span>
    </span>
    <span v-if="activeText && modelValue" class="b-switch__label b-switch__label--active">{{ activeText }}</span>
  </span>
</template>

<style scoped>
.b-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  outline: none;
}
.b-switch:focus-visible .b-switch__track {
  box-shadow: 0 0 0 2px var(--color-primary-bg), 0 0 0 3px var(--color-primary);
}
.b-switch--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.b-switch--loading {
  cursor: wait;
}
.b-switch__track {
  position: relative;
  border-radius: 100px;
  background: var(--border-default);
  transition: background 0.25s;
  flex-shrink: 0;
}
.b-switch--default .b-switch__track {
  width: 44px;
  height: 22px;
}
.b-switch--small .b-switch__track {
  width: 32px;
  height: 16px;
}
.b-switch--checked .b-switch__track {
  background: var(--color-primary);
}
.b-switch__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform 0.25s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.b-switch--small .b-switch__knob {
  width: 12px;
  height: 12px;
}
.b-switch--checked .b-switch__knob {
  transform: translateX(22px);
}
.b-switch--small.b-switch--checked .b-switch__knob {
  transform: translateX(16px);
}
.b-switch__label {
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
}
.b-switch__label--active {
  color: var(--color-primary);
}
.b-switch__label--inactive {
  color: var(--text-tertiary);
}
.b-switch__spinner {
  width: 10px;
  height: 10px;
  border: 2px solid transparent;
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: b-switch-spin 0.6s linear infinite;
}
.b-switch--small .b-switch__spinner {
  width: 8px;
  height: 8px;
  border-width: 1.5px;
}
.b-switch--loading .b-switch__knob {
  background: var(--color-primary-bg);
}
@keyframes b-switch-spin {
  to { transform: rotate(360deg); }
}
</style>
