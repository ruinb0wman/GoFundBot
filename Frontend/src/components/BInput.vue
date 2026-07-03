<script setup lang="ts">
import { ref, computed, useSlots, onMounted, nextTick } from 'vue'
import LucideIcon from './LucideIcon.vue'

type BInputType = 'text' | 'textarea' | 'password'
type BInputSize = 'large' | 'default' | 'small'

const props = withDefaults(defineProps<{
  modelValue?: string | number
  type?: BInputType
  size?: BInputSize
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
  showPassword?: boolean
  showWordLimit?: boolean
  maxlength?: number | string
  minlength?: number | string
  rows?: number
  autosize?: boolean | { minRows?: number; maxRows?: number }
  readonly?: boolean
  autofocus?: boolean
  prefixIcon?: string
  suffixIcon?: string
  clearIcon?: string
  wordLimitPosition?: 'inside' | 'outside'
  formatter?: (value: string | number) => string
  parser?: (value: string) => string | number
}>(), {
  modelValue: '',
  type: 'text',
  size: 'default',
  placeholder: '',
  disabled: false,
  clearable: false,
  showPassword: false,
  showWordLimit: false,
  rows: 2,
  autosize: false,
  readonly: false,
  autofocus: false,
  prefixIcon: '',
  suffixIcon: '',
  clearIcon: 'X',
  wordLimitPosition: 'inside',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
  change: [event: Event]
  input: [event: Event]
  clear: []
  keydown: [event: KeyboardEvent]
}>()

defineSlots<{
  prefix?: (props: {}) => any
  suffix?: (props: {}) => any
  prepend?: (props: {}) => any
  append?: (props: {}) => any
  passwordIcon?: (props: { visible: boolean }) => any
}>()

const slots = useSlots()
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const focused = ref(false)
const passwordVisible = ref(false)
const isComposing = ref(false)

const isTextarea = computed(() => props.type === 'textarea')
const actualType = computed(() => {
  if (props.type === 'password') return passwordVisible.value ? 'text' : 'password'
  return props.type
})

const displayValue = computed(() => {
  const val = props.modelValue ?? ''
  if (props.formatter) return String(props.formatter(val))
  return String(val)
})

const hasPrefix = computed(() => !!(slots.prefix || props.prefixIcon))
const showClearBtn = computed(() => props.clearable && !props.disabled && !props.readonly && !!displayValue.value && !isTextarea.value)
const hasSuffix = computed(() => !!(slots.suffix || props.suffixIcon || showClearBtn.value || (props.showPassword && !isTextarea.value) || (props.showWordLimit && maxCount.value != null)))
const hasPrepend = computed(() => !!slots.prepend)
const hasAppend = computed(() => !!slots.append)
const wordCount = computed(() => displayValue.value.length)
const maxCount = computed(() => (props.maxlength != null ? Number(props.maxlength) : undefined))
const wordExceeded = computed(() => maxCount.value != null && wordCount.value > maxCount.value)

const iconSize = computed(() => {
  switch (props.size) {
    case 'large': return 18
    case 'small': return 14
    default: return 16
  }
})

const wrapperClasses = computed(() => {
  const cls = ['b-input', `b-input--${props.size}`]
  if (props.disabled) cls.push('b-input--disabled')
  if (props.readonly && !props.disabled) cls.push('b-input--readonly')
  if (focused.value) cls.push('b-input--focused')
  if (isTextarea.value) cls.push('b-input--textarea')
  if (hasPrepend.value) cls.push('b-input--prepend')
  if (hasAppend.value) cls.push('b-input--append')
  if (wordExceeded.value) cls.push('b-input--exceed')
  return cls
})

function onInput(event: Event) {
  if (isComposing.value) return
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  let value: string | number = target.value
  if (props.parser) {
    value = props.parser(value)
  }
  emit('update:modelValue', value)
  emit('input', event)
  if (isTextarea.value && props.autosize) {
    nextTick(() => resizeTextarea())
  }
}

function onChange(event: Event) {
  emit('change', event)
}

function onFocus(event: FocusEvent) {
  focused.value = true
  emit('focus', event)
}

function onBlur(event: FocusEvent) {
  focused.value = false
  emit('blur', event)
}

function onKeydown(event: KeyboardEvent) {
  emit('keydown', event)
}

function onCompositionStart() { isComposing.value = true }
function onCompositionEnd(event: CompositionEvent) {
  isComposing.value = false
  onInput(event)
}

function onClear() {
  emit('update:modelValue', '')
  emit('clear')
  inputRef.value?.focus()
}

function togglePassword() {
  passwordVisible.value = !passwordVisible.value
}

function resizeTextarea() {
  const el = inputRef.value as HTMLTextAreaElement | null
  if (!el || !el.scrollHeight) return
  el.style.height = 'auto'
  if (props.autosize) {
    const lineHeight = 22
    const minRows = typeof props.autosize === 'object' && props.autosize.minRows != null ? props.autosize.minRows : props.rows
    const maxRows = typeof props.autosize === 'object' && props.autosize.maxRows != null ? props.autosize.maxRows : Infinity
    const minH = minRows * lineHeight
    const maxH = maxRows * lineHeight
    el.style.height = Math.min(Math.max(el.scrollHeight, minH), maxH) + 'px'
  }
}

function focus() { inputRef.value?.focus() }
function blur() { inputRef.value?.blur() }
function clear() { onClear() }
function select() { inputRef.value?.select() }

onMounted(() => {
  if (props.autofocus) focus()
  if (isTextarea.value && props.autosize) nextTick(() => resizeTextarea())
})

defineExpose({ focus, blur, clear, select, input: inputRef })
</script>

<template>
  <div
    :class="wrapperClasses"
  >
    <div v-if="hasPrepend" class="b-input__prepend">
      <slot name="prepend" />
    </div>
    <div class="b-input__wrapper">
      <span v-if="hasPrefix" class="b-input__prefix">
        <slot name="prefix">
          <LucideIcon v-if="prefixIcon" :name="prefixIcon" :size="iconSize" class="b-input__icon" />
        </slot>
      </span>
      <input
        v-if="!isTextarea"
        ref="inputRef"
        :value="displayValue"
        :type="actualType"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :maxlength="maxlength"
        :minlength="minlength"
        class="b-input__inner"
        @input="onInput"
        @change="onChange"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionupdate="onCompositionStart"
        @compositionend="onCompositionEnd"
      />
      <textarea
        v-else
        ref="inputRef"
        :value="displayValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :maxlength="maxlength"
        :rows="rows"
        class="b-input__inner"
        @input="onInput"
        @change="onChange"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionupdate="onCompositionStart"
        @compositionend="onCompositionEnd"
      />
      <span v-if="hasSuffix" class="b-input__suffix">
        <span
          v-if="showClearBtn"
          class="b-input__suffix-item b-input__clear"
          @click="onClear"
          @mousedown.prevent
        >
          <LucideIcon :name="clearIcon" :size="14" />
        </span>
        <span
          v-if="showPassword && !isTextarea"
          class="b-input__suffix-item b-input__password-toggle"
          @click="togglePassword"
        >
          <slot name="passwordIcon" :visible="passwordVisible">
            <LucideIcon :name="passwordVisible ? 'Eye' : 'EyeOff'" :size="iconSize" class="b-input__icon" />
          </slot>
        </span>
        <span
          v-if="showWordLimit && maxCount != null && wordLimitPosition === 'inside'"
          class="b-input__suffix-item b-input__word-limit"
        >
          {{ wordCount }} / {{ maxCount }}
        </span>
        <slot name="suffix">
          <LucideIcon v-if="suffixIcon" :name="suffixIcon" :size="iconSize" class="b-input__icon" />
        </slot>
      </span>
    </div>
    <span
      v-if="showWordLimit && maxCount != null && wordLimitPosition === 'outside'"
      class="b-input__word-limit-outside"
    >
      {{ wordCount }} / {{ maxCount }}
    </span>
    <div v-if="hasAppend" class="b-input__append">
      <slot name="append" />
    </div>
  </div>
</template>

<style scoped>
.b-input {
  display: inline-flex;
  align-items: stretch;
  width: 100%;
  font-size: 14px;
  vertical-align: middle;
  box-sizing: border-box;
}

.b-input__wrapper {
  display: flex;
  align-items: center;
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  transition: border-color 0.2s, box-shadow 0.2s;
  overflow: hidden;
  min-width: 0;
}

.b-input--focused .b-input__wrapper {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-bg);
}

.b-input--disabled .b-input__wrapper {
  background: var(--bg-subtle);
  cursor: not-allowed;
}

.b-input--readonly .b-input__wrapper {
  background: var(--bg-subtle);
}

.b-input--exceed .b-input__wrapper {
  border-color: var(--color-danger);
}

.b-input--exceed.b-input--focused .b-input__wrapper {
  box-shadow: 0 0 0 2px var(--color-danger-bg);
}

.b-input__inner {
  border: none;
  background: transparent;
  outline: none;
  flex: 1;
  min-width: 0;
  width: 100%;
  color: var(--text-primary);
  font-family: inherit;
  font-size: inherit;
  line-height: 1.5;
}

.b-input__inner::placeholder {
  color: var(--text-tertiary);
  opacity: 1;
}

.b-input--disabled .b-input__inner {
  cursor: not-allowed;
  color: var(--text-disabled);
}

.b-input--large .b-input__inner {
  height: 44px;
  padding: 0 16px;
  font-size: 15px;
}

.b-input--default .b-input__inner {
  height: 36px;
  padding: 0 12px;
  font-size: 14px;
}

.b-input--small .b-input__inner {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.b-input--textarea .b-input__wrapper {
  padding: 8px 12px;
  align-items: flex-start;
}

.b-input--textarea .b-input__inner {
  height: auto;
  min-height: 44px;
  resize: vertical;
  padding: 0;
  line-height: 1.6;
}

.b-input__prefix,
.b-input__suffix {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-tertiary);
  gap: 4px;
}

.b-input__prefix {
  padding-left: 12px;
}

.b-input__suffix {
  padding-right: 12px;
}

.b-input--large .b-input__prefix { padding-left: 16px; }
.b-input--large .b-input__suffix { padding-right: 16px; }
.b-input--small .b-input__prefix { padding-left: 8px; }
.b-input--small .b-input__suffix { padding-right: 8px; }

.b-input__icon {
  display: inline-flex;
  flex-shrink: 0;
}

.b-input__suffix-item {
  display: inline-flex;
  align-items: center;
}

.b-input__clear {
  cursor: pointer;
  transition: color 0.15s;
  color: var(--text-tertiary);
}

.b-input__clear:hover {
  color: var(--text-primary);
}

.b-input__password-toggle {
  cursor: pointer;
  transition: color 0.15s;
  display: inline-flex;
  align-items: center;
}

.b-input__password-toggle:hover {
  color: var(--text-primary);
}

.b-input__word-limit,
.b-input__word-limit-outside {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

.b-input__word-limit-outside {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
}

.b-input--exceed .b-input__word-limit,
.b-input--exceed .b-input__word-limit-outside {
  color: var(--color-danger);
}

.b-input--textarea.b-input--focused .b-input__wrapper {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-bg);
}

.b-input__prepend,
.b-input__append {
  display: flex;
  align-items: center;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  padding: 0 12px;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 14px;
  flex-shrink: 0;
}

.b-input__prepend {
  border-right: none;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.b-input__append {
  border-left: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.b-input--prepend .b-input__wrapper {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.b-input--append .b-input__wrapper {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.b-input--prepend.b-input--append .b-input__wrapper {
  border-radius: 0;
}
</style>
