import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.json'
import en from './en.json'

const LOCALE_KEY = 'gofund-locale'

type LocaleMessages = Record<string, Record<string, string>>

const messages: LocaleMessages = {
  'zh-CN': zhCN as unknown as Record<string, string>,
  'en': en as unknown as Record<string, string>,
}

const savedLocale = localStorage.getItem(LOCALE_KEY) || navigator.language.startsWith('zh') ? 'zh-CN' : 'en'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'zh-CN',
  messages,
})

export function setLocale(locale: string) {
  i18n.global.locale.value = locale
  localStorage.setItem(LOCALE_KEY, locale)
  document.documentElement.lang = locale
}

export function getCurrentLocale(): string {
  return i18n.global.locale.value
}

export default i18n
