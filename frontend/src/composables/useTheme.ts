import { ref, type Ref } from 'vue'

const THEME_KEY = 'gofund-theme'
const mediaQuery: MediaQueryList = window.matchMedia('(prefers-color-scheme: dark)')

type ThemeMode = 'light' | 'dark' | 'auto'

const savedTheme: Ref<ThemeMode> = ref((localStorage.getItem(THEME_KEY) as ThemeMode) || 'auto')

function computeTheme(preference: ThemeMode): 'light' | 'dark' {
  if (preference === 'auto') {
    return mediaQuery.matches ? 'dark' : 'light'
  }
  return preference
}

const theme: Ref<'light' | 'dark'> = ref(computeTheme(savedTheme.value))

function applyTheme(value: 'light' | 'dark'): void {
  if (value === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

applyTheme(theme.value)

function toggleTheme(): void {
  const modes: ThemeMode[] = ['light', 'dark', 'auto']
  const idx = modes.indexOf(savedTheme.value)
  savedTheme.value = modes[(idx + 1) % 3]
  localStorage.setItem(THEME_KEY, savedTheme.value)
  theme.value = computeTheme(savedTheme.value)
  applyTheme(theme.value)
}

mediaQuery.addEventListener('change', () => {
  if (savedTheme.value === 'auto') {
    theme.value = computeTheme('auto')
    applyTheme(theme.value)
  }
})

export function useTheme(): { theme: Ref<'light' | 'dark'>; savedTheme: Ref<ThemeMode>; toggleTheme: () => void } {
  return { theme, savedTheme, toggleTheme }
}
