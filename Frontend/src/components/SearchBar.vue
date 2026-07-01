<template>
  <div
    class="search-bar"
    :class="[`size-${size}`, { compact }]"
  >
    <slot name="prepend">
      <LucideIcon v-if="showIcon" name="Search" :size="iconSize" class="search-bar-icon" />
    </slot>
    <input
      ref="inputRef"
      :value="modelValue"
      @input="onInput"
      @keyup.enter="onEnter"
      @focus="$emit('focus', $event)"
      @blur="$emit('blur', $event)"
      :placeholder="placeholderText"
      :autofocus="autofocus"
      class="search-bar-input"
    />
    <button
      v-if="clearable && modelValue"
      class="search-bar-clear"
      @click="onClear"
      type="button"
      tabindex="-1"
    >
      <LucideIcon name="X" :size="14" />
    </button>
    <div v-if="$slots.dropdown" class="search-bar-dropdown">
      <slot name="dropdown" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  showIcon?: boolean
  clearable?: boolean
  compact?: boolean
  size?: string
  autofocus?: boolean
  iconSize?: number
}>(), {
  modelValue: '',
  placeholder: '',
  showIcon: true,
  clearable: false,
  compact: false,
  size: 'md',
  autofocus: false,
  iconSize: 16,
})

const placeholderText = computed(() => props.placeholder || t('searchBar.placeholder'))
const inputRef = ref<HTMLInputElement | null>(null)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: []
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function onEnter() {
  emit('search')
}

function onClear() {
  emit('update:modelValue', '')
  inputRef.value?.focus()
}

onMounted(() => {
  if (props.autofocus) {
    inputRef.value?.focus()
  }
})

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style scoped>
.search-bar {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 0 10px;
  transition: border-color 0.2s, box-shadow 0.2s;
  gap: 6px;
}

.search-bar:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.08);
}

.search-bar.compact {
  background: transparent;
  border-color: transparent;
}

.search-bar.compact:focus-within {
  border-color: var(--color-primary);
}

.search-bar-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.search-bar-input {
  border: none;
  background: transparent;
  padding: 8px 0;
  font-size: 14px;
  outline: none;
  min-width: 0;
  flex: 1;
  color: var(--text-primary);
}

.search-bar-input::placeholder {
  color: var(--text-tertiary);
  opacity: 1;
}

.search-bar.size-sm .search-bar-input {
  padding: 4px 0;
  font-size: 13px;
}

.search-bar.size-lg .search-bar-input {
  padding: 10px 0;
  font-size: 15px;
}

.search-bar-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 2px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}

.search-bar-clear:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.search-bar-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 300;
  margin-top: 4px;
}
</style>
