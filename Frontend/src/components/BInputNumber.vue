<script setup lang="ts">
import { ref, computed, watch, useSlots } from 'vue'

type BInputNumberSize = 'large' | 'default' | 'small'
type ControlsPosition = 'default' | 'right'

const props = withDefaults(defineProps<{
  modelValue?: number | null
  min?: number
  max?: number
  step?: number
  stepStrictly?: boolean
  precision?: number
  size?: BInputNumberSize
  disabled?: boolean
  readonly?: boolean
  controls?: boolean
  controlsPosition?: ControlsPosition
  placeholder?: string
  formatter?: (value: number | null) => string
  parser?: (value: string) => number | null
  name?: string
  id?: string
  valueOnClear?: number | null
}>(), {
  modelValue: null,
  min: Number.MIN_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
  step: 1,
  stepStrictly: false,
  size: 'default',
  disabled: false,
  readonly: false,
  controls: true,
  controlsPosition: 'default',
  placeholder: '',
  valueOnClear: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
  change: [value: number | null]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

defineSlots<{
  'decrease-icon'?: (props: {}) => any
  'increase-icon'?: (props: {}) => any
  prefix?: (props: {}) => any
  suffix?: (props: {}) => any
}>()

const slots = useSlots()

const inputRef = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const tempValue = ref('')

function formatValue(val: number | null | undefined): string {
  if (val == null) return ''
  if (props.formatter) return props.formatter(val)
  return String(val)
}

function parseValue(str: string): number | null {
  if (props.parser) return props.parser(str)
  const trimmed = str.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  return isNaN(num) ? null : num
}

function clampValue(val: number): number {
  let v = val
  if (v < props.min) v = props.min
  if (v > props.max) v = props.max
  if (props.stepStrictly && props.step > 0) {
    v = Math.round((v - props.min) / props.step) * props.step + props.min
  }
  if (props.precision != null) {
    v = Number(v.toFixed(props.precision))
  }
  return v
}

const displayValue = computed(() => {
  if (focused.value) return tempValue.value
  return formatValue(props.modelValue)
})

const atMin = computed(() => props.modelValue != null && props.modelValue <= props.min)
const atMax = computed(() => props.modelValue != null && props.modelValue >= props.max)

const hasPrefix = computed(() => !!slots.prefix)
const hasSuffix = computed(() => !!slots.suffix)



const wrapperClasses = computed(() => {
  const cls = ['b-input-number', `b-input-number--${props.size}`]
  if (props.disabled) cls.push('b-input-number--disabled')
  if (props.readonly && !props.disabled) cls.push('b-input-number--readonly')
  if (focused.value) cls.push('b-input-number--focused')
  if (props.controlsPosition === 'right') cls.push('b-input-number--controls-right')
  if (!props.controls) cls.push('b-input-number--no-controls')
  return cls
})

function emitValue(val: number | null) {
  emit('update:modelValue', val)
  emit('change', val)
}

function stepUp() {
  if (props.disabled || props.readonly || atMax.value) return
  const base = props.modelValue ?? 0
  let val = base + props.step
  val = clampValue(val)
  emitValue(val)
}

function stepDown() {
  if (props.disabled || props.readonly || atMin.value) return
  const base = props.modelValue ?? 0
  let val = base - props.step
  val = clampValue(val)
  emitValue(val)
}

function onInput(event: Event) {
  if (props.disabled || props.readonly) return
  tempValue.value = (event.target as HTMLInputElement).value
}

function onFocus(event: FocusEvent) {
  focused.value = true
  tempValue.value = formatValue(props.modelValue)
  emit('focus', event)
}

function onBlur(event: FocusEvent) {
  focused.value = false
  commitValue()
  emit('blur', event)
}

function commitValue() {
  const parsed = parseValue(tempValue.value)
  if (parsed == null) {
    emitValue(props.valueOnClear)
    return
  }
  const clamped = clampValue(parsed)
  emitValue(clamped)
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled || props.readonly) return
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    stepUp()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    stepDown()
  } else if (event.key === 'Enter') {
    commitValue()
  }
}

function focus() { inputRef.value?.focus() }
function blur() { inputRef.value?.blur() }

watch(() => props.modelValue, (val) => {
  if (!focused.value) {
    tempValue.value = formatValue(val)
  }
})

defineExpose({ focus, blur })
</script>

<template>
  <div :class="wrapperClasses">
    <button
      v-if="controls && controlsPosition === 'default'"
      class="b-input-number__decrease"
      :disabled="disabled || readonly || atMin"
      type="button"
      tabindex="-1"
      @click="stepDown"
      :aria-label="'decrease'"
    >
      <slot name="decrease-icon">
        <span class="btn-label">−</span>
      </slot>
    </button>
    <div class="b-input-number__input">
      <div v-if="hasPrefix" class="b-input-number__prefix">
        <slot name="prefix" />
      </div>
      <input
        ref="inputRef"
        :value="displayValue"
        type="text"
        inputmode="decimal"
        :disabled="disabled"
        :readonly="readonly"
        :placeholder="placeholder"
        :name="name"
        :id="id"
        autocomplete="off"
        class="b-input-number__inner"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
      />
      <div v-if="hasSuffix" class="b-input-number__suffix">
        <slot name="suffix" />
      </div>
      <div
        v-if="controls && controlsPosition === 'right'"
        class="b-input-number__controls"
      >
        <button
          class="b-input-number__increase"
          :disabled="disabled || readonly || atMax"
          type="button"
          tabindex="-1"
          @click="stepUp"
          :aria-label="'increase'"
        >
          <slot name="increase-icon">
            <span class="btn-label">+</span>
          </slot>
        </button>
        <button
          class="b-input-number__decrease"
          :disabled="disabled || readonly || atMin"
          type="button"
          tabindex="-1"
          @click="stepDown"
          :aria-label="'decrease'"
        >
          <slot name="decrease-icon">
            <span class="btn-label">−</span>
          </slot>
        </button>
      </div>
    </div>
    <button
      v-if="controls && controlsPosition === 'default'"
      class="b-input-number__increase"
      :disabled="disabled || readonly || atMax"
      type="button"
      tabindex="-1"
      @click="stepUp"
      :aria-label="'increase'"
    >
      <slot name="increase-icon">
        <span class="btn-label">+</span>
      </slot>
    </button>
  </div>
</template>

<style scoped>
.b-input-number {
  display: inline-flex;
  align-items: stretch;
  vertical-align: middle;
  box-sizing: border-box;
  font-size: 14px;
}

.b-input-number__decrease,
.b-input-number__increase {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  cursor: pointer;
  color: var(--text-secondary);
  transition: border-color 0.2s, color 0.2s, background 0.2s;
  user-select: none;
  padding: 0;
  flex-shrink: 0;
  outline: none;
  font-family: inherit;
}

.btn-label {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}

.b-input-number--small .btn-label {
  font-size: 15px;
}

.b-input-number--large .btn-label {
  font-size: 20px;
}

.b-input-number__decrease:hover:not(:disabled),
.b-input-number__increase:hover:not(:disabled) {
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.b-input-number__decrease:active:not(:disabled),
.b-input-number__increase:active:not(:disabled) {
  background: var(--color-primary-bg);
}

.b-input-number__decrease:disabled,
.b-input-number__increase:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.b-input-number--large .b-input-number__decrease,
.b-input-number--large .b-input-number__increase {
  width: 44px;
  font-size: 15px;
}

.b-input-number--default .b-input-number__decrease,
.b-input-number--default .b-input-number__increase {
  width: 36px;
  font-size: 14px;
}

.b-input-number--small .b-input-number__decrease,
.b-input-number--small .b-input-number__increase {
  width: 28px;
  font-size: 12px;
}

.b-input-number__decrease {
  border-right: none;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.b-input-number__increase {
  border-left: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.b-input-number__input {
  flex: 1;
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.b-input-number__inner {
  width: 100%;
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  outline: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: inherit;
  text-align: center;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
  border-radius: var(--radius-sm);
}

.b-input-number__decrease + .b-input-number__input .b-input-number__inner {
  border-radius: 0;
}

.b-input-number:not(.b-input-number--controls-right) .b-input-number__input + .b-input-number__increase .b-input-number__inner {
  border-radius: 0;
}

.b-input-number--controls-right .b-input-number__inner {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.b-input-number--no-controls .b-input-number__inner {
  border-radius: var(--radius-sm);
}

.b-input-number__inner::placeholder {
  color: var(--text-tertiary);
  opacity: 1;
}

.b-input-number--focused .b-input-number__inner {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-bg);
}

.b-input-number--disabled .b-input-number__inner {
  background: var(--bg-subtle);
  cursor: not-allowed;
  color: var(--text-disabled);
}

.b-input-number--readonly .b-input-number__inner {
  background: var(--bg-subtle);
}

.b-input-number--large .b-input-number__inner {
  height: 44px;
  padding: 0 12px;
  font-size: 15px;
}

.b-input-number--default .b-input-number__inner {
  height: 36px;
  padding: 0 10px;
  font-size: 14px;
}

.b-input-number--small .b-input-number__inner {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.b-input-number--controls-right .b-input-number__inner {
  border-right: none;
  text-align: left;
}

.b-input-number__controls {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-left: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  overflow: hidden;
  flex-shrink: 0;
}

.b-input-number--controls-right .b-input-number__decrease,
.b-input-number--controls-right .b-input-number__increase {
  width: 100%;
  border: none;
  border-radius: 0;
  flex: 1;
  font-size: 10px;
  background: var(--bg-subtle);
}

.b-input-number--controls-right .b-input-number__decrease {
  border-top: 1px solid var(--border-default);
}

.b-input-number__prefix,
.b-input-number__suffix {
  display: flex;
  align-items: center;
  padding: 0 8px;
  color: var(--text-tertiary);
  font-size: 13px;
  flex-shrink: 0;
}

.b-input-number--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
