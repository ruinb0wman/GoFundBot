<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'

defineOptions({ name: 'BRadio' })

type BRadioSize = 'large' | 'default' | 'small'

interface RadioGroupContext {
  modelValue: ComputedRef<string | number>
  disabled: ComputedRef<boolean>
  size: ComputedRef<BRadioSize>
  emit: (event: 'update:modelValue' | 'change', value: string | number) => void
}

const props = withDefaults(defineProps<{
  value?: string | number
  label?: string
  disabled?: boolean
}>(), {
  value: '',
  label: '',
  disabled: false,
})

const radioGroup = inject<RadioGroupContext | null>('radioGroup', null)

const checked = computed(() => radioGroup ? radioGroup.modelValue.value === props.value : false)
const isDisabled = computed(() => props.disabled || (radioGroup?.disabled.value ?? false))
const size = computed(() => radioGroup?.size.value ?? 'default')

function handleClick() {
  if (isDisabled.value) return
  if (radioGroup) {
    radioGroup.emit('update:modelValue', props.value)
    radioGroup.emit('change', props.value)
  }
}
</script>

<template>
  <label
    class="b-radio"
    :class="[`b-radio--${size}`, {
      'b-radio--checked': checked,
      'b-radio--disabled': isDisabled,
    }]"
    @click="handleClick"
    @keydown.space.prevent="handleClick"
    tabindex="0"
  >
    <span class="b-radio__input">
      <input type="radio" :checked="checked" :disabled="isDisabled" :value="value" @click="handleClick" />
      <span class="b-radio__inner">
        <span v-if="checked" class="b-radio__dot" />
      </span>
    </span>
    <span v-if="label" class="b-radio__label">{{ label }}</span>
    <slot v-else />
  </label>
</template>

<style scoped>
.b-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  outline: none;
}
.b-radio:focus-visible .b-radio__inner {
  box-shadow: 0 0 0 2px var(--color-primary-bg), 0 0 0 3px var(--color-primary);
}
.b-radio--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.b-radio__input {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.b-radio__input input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  z-index: 1;
}
.b-radio--disabled .b-radio__input input {
  cursor: not-allowed;
}
.b-radio__inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-card);
  transition: all 0.2s;
}
.b-radio--default .b-radio__inner {
  width: 18px;
  height: 18px;
}
.b-radio--small .b-radio__inner {
  width: 14px;
  height: 14px;
}
.b-radio:hover .b-radio__inner {
  border-color: var(--color-primary);
}
.b-radio--checked .b-radio__inner {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
}
.b-radio__dot {
  border-radius: 50%;
  background: var(--color-primary);
  transition: transform 0.2s;
}
.b-radio--default .b-radio__dot {
  width: 10px;
  height: 10px;
}
.b-radio--small .b-radio__dot {
  width: 8px;
  height: 8px;
}
.b-radio__label {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.4;
}
.b-radio--small .b-radio__label {
  font-size: 13px;
}
</style>
