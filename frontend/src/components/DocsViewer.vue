<template>
  <Teleport to="body">
    <Transition name="docs-fade">
      <div v-if="store.open" class="docs-viewer" @click.self="store.closeDocs()">
        <header class="docs-header">
          <span class="docs-title">
            <LucideIcon name="BookOpen" :size="16" />
            GoFundBot 文档
          </span>
          <span class="docs-hint">{{ '文档需 docs 服务（8574）；空白请确认文档站已启动' }}</span>
          <button class="docs-close" @click="store.closeDocs()" :title="'关闭'">
            <LucideIcon name="X" :size="18" />
          </button>
        </header>
        <iframe
          class="docs-iframe"
          :src="store.src || undefined"
          :title="'GoFundBot 文档'"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { LucideIcon } from '@gofund/ui'
import { useDocsStore } from '../stores/docsStore'

const store = useDocsStore()
</script>

<style scoped>
.docs-viewer {
  position: fixed;
  inset: 0;
  z-index: 6000;
  background: var(--bg-root, var(--bg-card));
  display: flex;
  flex-direction: column;
}

.docs-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.docs-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.docs-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docs-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}

.docs-close:hover {
  background: var(--bg-subtle);
  color: var(--text-primary);
}

.docs-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: #fff;
}

[data-theme="dark"] .docs-iframe {
  background: #1e1e1e;
}

.docs-fade-enter-active,
.docs-fade-leave-active {
  transition: opacity 0.2s ease;
}

.docs-fade-enter-from,
.docs-fade-leave-to {
  opacity: 0;
}
</style>
