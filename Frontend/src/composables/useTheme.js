import { ref } from 'vue'

const THEME_KEY = 'gofund-theme'
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

const savedTheme = ref(localStorage.getItem(THEME_KEY) || 'auto')

function computeTheme(preference) {
  if (preference === 'auto') {
    return mediaQuery.matches ? 'dark' : 'light'
  }
  return preference
}

const theme = ref(computeTheme(savedTheme.value))

function applyTheme(value) {
  if (value === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

applyTheme(theme.value)

function toggleTheme() {
  const modes = ['light', 'dark', 'auto']
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

export function useTheme() {
  return { theme, savedTheme, toggleTheme }
}
