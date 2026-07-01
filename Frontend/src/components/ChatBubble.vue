<template>
  <Teleport to="body">
    <div class="chat-bubble-wrapper">
      <Transition name="bubble-fade">
        <button
          v-if="!chatStore.isOpen"
          class="chat-bubble-btn"
          @click="chatStore.toggleOpen()"
          :title="'AI 助手'"
        >
          <LucideIcon name="Bot" :size="24" />
        </button>
      </Transition>
      <ChatPanel v-if="chatStore.isOpen" @close="chatStore.close()" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useChatStore } from '../stores/chatStore'
import LucideIcon from './LucideIcon.vue'
import ChatPanel from './ChatPanel.vue'

const chatStore = useChatStore()
</script>

<style scoped>
.chat-bubble-wrapper {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 6000;
}

.chat-bubble-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary-hover);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;
}

.chat-bubble-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}

.bubble-fade-enter-active,
.bubble-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.bubble-fade-enter-from,
.bubble-fade-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

@media (max-width: 768px) {
  .chat-bubble-wrapper {
    bottom: 72px;
    right: 16px;
  }

  .chat-bubble-btn {
    width: 48px;
    height: 48px;
  }
}
</style>
