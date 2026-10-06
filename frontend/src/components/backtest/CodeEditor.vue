<template>
  <div ref="host" class="code-editor"></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

/** Follow the app's CSS variables so the editor matches light/dark themes. */
const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text-primary)', fontSize: '12px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-tertiary)' },
  '.cm-activeLine': { backgroundColor: 'rgba(127, 127, 127, 0.08)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
})

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        javascript(),
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
    parent: host.value as HTMLElement,
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  },
)

onUnmounted(() => {
  view?.destroy()
  view = null
})
</script>

<style scoped>
.code-editor {
  height: 100%;
  min-height: 220px;
  overflow: auto;
}
</style>
