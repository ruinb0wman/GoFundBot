<script setup lang="ts">
type BCheckboxSize = 'default' | 'small'

const props = withDefaults(defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
  indeterminate?: boolean
  size?: BCheckboxSize
}>(), {
  modelValue: false,
  label: '',
  disabled: false,
  indeterminate: false,
  size: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function handleChange() {
  if (props.disabled) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <label
    class="b-checkbox"
    :class="[`b-checkbox--${size}`, {
      'b-checkbox--checked': modelValue,
      'b-checkbox--indeterminate': indeterminate && !modelValue,
      'b-checkbox--disabled': disabled,
    }]"
    @keydown.space.prevent="handleChange"
  >
    <span class="b-checkbox__input">
      <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="handleChange" />
      <span class="b-checkbox__inner">
        <svg v-if="indeterminate && !modelValue" class="b-checkbox__icon" viewBox="0 0 16 16">
          <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <svg v-else-if="modelValue" class="b-checkbox__icon" viewBox="0 0 16 16">
          <polyline points="3,8 7,12 13,5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </span>
    <span v-if="label" class="b-checkbox__label">{{ label }}</span>
    <slot v-else />
  </label>
</template>

<style scoped>
.b-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  outline: none;
}
.b-checkbox--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.b-checkbox__input {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.b-checkbox__input input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  z-index: 1;
}
.b-checkbox--disabled .b-checkbox__input input {
  cursor: not-allowed;
}
.b-checkbox__inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-card);
  transition: all 0.2s;
}
.b-checkbox--default .b-checkbox__inner {
  width: 18px;
  height: 18px;
}
.b-checkbox--small .b-checkbox__inner {
  width: 14px;
  height: 14px;
}
.b-checkbox--checked .b-checkbox__inner,
.b-checkbox--indeterminate .b-checkbox__inner {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.b-checkbox:hover .b-checkbox__inner {
  border-color: var(--color-primary);
}
.b-checkbox:focus-visible .b-checkbox__inner {
  box-shadow: 0 0 0 2px var(--color-primary-bg), 0 0 0 3px var(--color-primary);
}
.b-checkbox__icon {
  color: #fff;
  width: 12px;
  height: 12px;
}
.b-checkbox--small .b-checkbox__icon {
  width: 10px;
  height: 10px;
}
.b-checkbox__label {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.4;
}
.b-checkbox--small .b-checkbox__label {
  font-size: 13px;
}
</style>
