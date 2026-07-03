<script setup lang="ts">
import { computed, provide } from 'vue'
import type { ComputedRef } from 'vue'

type BRadioSize = 'large' | 'default' | 'small'

interface RadioGroupContext {
  modelValue: ComputedRef<string | number>
  disabled: ComputedRef<boolean>
  size: ComputedRef<BRadioSize>
  emit: (event: 'update:modelValue' | 'change', value: string | number) => void
}

const props = withDefaults(defineProps<{
  modelValue?: string | number
  disabled?: boolean
  size?: BRadioSize
  vertical?: boolean
  border?: boolean
}>(), {
  modelValue: '',
  disabled: false,
  size: 'default',
  vertical: false,
  border: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

provide<RadioGroupContext>('radioGroup', {
  modelValue: computed(() => props.modelValue),
  disabled: computed(() => props.disabled),
  size: computed(() => props.size),
  emit: (event: 'update:modelValue' | 'change', value: string | number) => {
    if (event === 'update:modelValue') emit('update:modelValue', value)
    else emit('change', value)
  },
})
</script>

<template>
  <div
    class="b-radio-group"
    :class="[`b-radio-group--${size}`, {
      'b-radio-group--vertical': vertical,
      'b-radio-group--border': border,
    }]"
    role="radiogroup"
  >
    <slot />
  </div>
</template>

<style scoped>
.b-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.b-radio-group--vertical {
  flex-direction: column;
  gap: 8px;
}
.b-radio-group--border {
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.b-radio-group--border .b-radio {
  flex: 1;
  justify-content: center;
  padding: 6px 16px;
  margin: 0;
  border-right: 1px solid var(--border-default);
}
.b-radio-group--border .b-radio:last-child {
  border-right: none;
}
</style>
