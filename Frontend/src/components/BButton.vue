<script setup lang="ts">
import { computed } from 'vue'
import LucideIcon from './LucideIcon.vue'

type BButtonType = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
type BButtonSize = 'large' | 'default' | 'small'

const props = withDefaults(defineProps<{
  type?: BButtonType
  size?: BButtonSize
  plain?: boolean
  round?: boolean
  circle?: boolean
  loading?: boolean
  disabled?: boolean
  text?: boolean
  link?: boolean
  active?: boolean
  nativeType?: 'button' | 'submit' | 'reset'
  icon?: string
}>(), {
  type: 'default',
  size: 'default',
  plain: false,
  round: false,
  circle: false,
  loading: false,
  disabled: false,
  text: false,
  link: false,
  active: false,
  nativeType: 'button',
  icon: '',
})

defineSlots<{
  default?: (props: {}) => any
  icon?: (props: {}) => any
}>()

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const classes = computed(() => {
  const cls = ['b-btn', `b-btn--${props.type}`, `b-btn--${props.size}`]
  if (props.plain) cls.push('b-btn--plain')
  if (props.round) cls.push('b-btn--round')
  if (props.circle) cls.push('b-btn--circle')
  if (props.loading) cls.push('b-btn--loading')
  if (props.text) cls.push('b-btn--text')
  if (props.link) cls.push('b-btn--link')
  if (props.active) cls.push('b-btn--active')
  return cls
})

const iconSize = computed(() => {
  switch (props.size) {
    case 'large': return 18
    case 'small': return 14
    default: return 16
  }
})

function handleClick(event: MouseEvent) {
  if (props.disabled || props.loading) return
  emit('click', event)
}
</script>

<template>
  <button
    :class="classes"
    :disabled="disabled || loading"
    :type="nativeType"
    @click="handleClick"
  >
    <span v-if="loading" class="b-btn-icon">
      <LucideIcon name="Loader" :size="iconSize" class="b-btn-spinner" />
    </span>
    <span v-else-if="$slots.icon || icon" class="b-btn-icon">
      <slot name="icon">
        <LucideIcon v-if="icon" :name="icon" :size="iconSize" />
      </slot>
    </span>
    <span v-if="$slots.default" class="b-btn-text">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.b-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid;
  outline: none;
  transition: all 0.2s ease;
  font-family: inherit;
  font-weight: 500;
  text-decoration: none;
  user-select: none;
  vertical-align: middle;
  box-sizing: border-box;
}

.b-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.b-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Sizes */
.b-btn--large { height: 44px; padding: 0 24px; font-size: 15px; border-radius: var(--radius-sm); }
.b-btn--default { height: 36px; padding: 0 18px; font-size: 14px; border-radius: var(--radius-sm); }
.b-btn--small { height: 28px; padding: 0 12px; font-size: 12px; border-radius: var(--radius-sm); }

/* Round */
.b-btn--round { border-radius: 999px; }

/* Circle */
.b-btn--circle { border-radius: 50%; padding: 0; }
.b-btn--circle.b-btn--large { width: 44px; height: 44px; }
.b-btn--circle.b-btn--default { width: 36px; height: 36px; }
.b-btn--circle.b-btn--small { width: 28px; height: 28px; }

/* Type variants - default */
.b-btn--default { background: var(--bg-card); border-color: var(--border-default); color: var(--text-primary); }
.b-btn--default:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); }

/* Type variants - primary */
.b-btn--primary { background: var(--color-primary); border-color: var(--color-primary); color: var(--text-inverse); }
.b-btn--primary:hover:not(:disabled) { background: var(--color-primary-hover); border-color: var(--color-primary-hover); }

/* Type variants - success */
.b-btn--success { background: var(--color-success); border-color: var(--color-success); color: var(--text-inverse); }
.b-btn--success:hover:not(:disabled) { opacity: 0.85; }

/* Type variants - warning */
.b-btn--warning { background: var(--color-warning); border-color: var(--color-warning); color: var(--text-inverse); }
.b-btn--warning:hover:not(:disabled) { opacity: 0.85; }

/* Type variants - danger */
.b-btn--danger { background: var(--color-danger); border-color: var(--color-danger); color: var(--text-inverse); }
.b-btn--danger:hover:not(:disabled) { opacity: 0.85; }

/* Type variants - info */
.b-btn--info { background: var(--color-info); border-color: var(--color-info); color: var(--text-inverse); }
.b-btn--info:hover:not(:disabled) { opacity: 0.85; }

/* Plain variants */
.b-btn--plain { background: transparent; }
.b-btn--default.b-btn--plain:hover:not(:disabled) { color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-bg); }
.b-btn--primary.b-btn--plain { color: var(--color-primary); border-color: var(--color-primary-border); background: var(--color-primary-bg); }
.b-btn--primary.b-btn--plain:hover:not(:disabled) { background: var(--color-primary); border-color: var(--color-primary); color: var(--text-inverse); }
.b-btn--success.b-btn--plain { color: var(--color-success); border-color: var(--color-success-border); background: var(--color-success-bg); }
.b-btn--success.b-btn--plain:hover:not(:disabled) { background: var(--color-success); border-color: var(--color-success); color: var(--text-inverse); }
.b-btn--warning.b-btn--plain { color: var(--color-warning); border-color: var(--color-warning-border); background: var(--color-warning-bg); }
.b-btn--warning.b-btn--plain:hover:not(:disabled) { background: var(--color-warning); border-color: var(--color-warning); color: var(--text-inverse); }
.b-btn--danger.b-btn--plain { color: var(--color-danger); border-color: var(--color-danger-border); background: var(--color-danger-bg); }
.b-btn--danger.b-btn--plain:hover:not(:disabled) { background: var(--color-danger); border-color: var(--color-danger); color: var(--text-inverse); }

/* Text button */
.b-btn--text { background: transparent; border-color: transparent; }
.b-btn--text.b-btn--default { color: inherit; }
.b-btn--text:hover:not(:disabled) { background: var(--bg-hover); }
.b-btn--active.b-btn--text { background: var(--bg-hover); font-weight: 600; }
.b-btn--primary.b-btn--text { color: var(--color-primary); }
.b-btn--success.b-btn--text { color: var(--color-success); }
.b-btn--warning.b-btn--text { color: var(--color-warning); }
.b-btn--danger.b-btn--text { color: var(--color-danger); }
.b-btn--info.b-btn--text { color: var(--color-info); }

/* Link button */
.b-btn--link { background: transparent; border-color: transparent; padding: 0; height: auto; color: var(--color-primary); }
.b-btn--link:hover:not(:disabled) { text-decoration: underline; }

/* Loading spinner */
.b-btn-spinner { animation: b-btn-spin 1s linear infinite; }
@keyframes b-btn-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.b-btn-icon { display: inline-flex; align-items: center; }
</style>
