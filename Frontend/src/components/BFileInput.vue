<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

const props = withDefaults(defineProps<{
  accept?: string
  multiple?: boolean
  disabled?: boolean
  placeholder?: string
}>(), {
  accept: '',
  multiple: false,
  disabled: false,
  placeholder: '',
})

const emit = defineEmits<{
  change: [files: FileList | null]
}>()

const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const fileNames = ref<string[]>([])

function handleChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files) {
    fileNames.value = Array.from(files).map(f => f.name)
  } else {
    fileNames.value = []
  }
  emit('change', files)
}

function handleTrigger() {
  if (props.disabled) return
  inputRef.value?.click()
}

function triggerClick(e: MouseEvent) {
  e.preventDefault()
  handleTrigger()
}
</script>

<template>
  <div class="b-file-input" :class="{ 'b-file-input--disabled': disabled }">
    <div class="b-file-input__wrapper" @click="triggerClick">
      <slot name="trigger" :trigger="handleTrigger">
        <span class="b-file-input__trigger">{{ placeholder || '选择文件' }}</span>
      </slot>
    </div>
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      class="b-file-input__native"
      @change="handleChange"
    />
    <div v-if="fileNames.length" class="b-file-input__list">
      <div v-for="(name, idx) in fileNames" :key="idx" class="b-file-input__item">
        <slot name="file" :name="name" :index="idx">
          <span class="b-file-input__name">{{ name }}</span>
        </slot>
      </div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.b-file-input {
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
}
.b-file-input--disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.b-file-input__wrapper {
  display: inline-flex;
}
.b-file-input__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}
.b-file-input__trigger:hover {
  background: var(--color-primary-hover);
}
.b-file-input--disabled .b-file-input__trigger {
  background: var(--border-default);
  cursor: not-allowed;
}
.b-file-input__native {
  display: none;
}
.b-file-input__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.b-file-input__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--bg-subtle);
  border-radius: 4px;
  font-size: 13px;
}
.b-file-input__name {
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
