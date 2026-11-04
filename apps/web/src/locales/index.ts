import { createI18n } from 'vue-i18n'
import { locales as uiLocales } from '@inkcre/ui-web/locales'
import en from './messages/en.json'
import zhCN from './messages/zh-CN.json'

export const SUPPORT_LOCALES = ['en', 'zh-CN'] as const
export type SupportLocale = (typeof SUPPORT_LOCALES)[number]

const STORAGE_KEY = 'inkcre-locale'

// Locale display names for UI
export const LOCALE_NAMES: Record<SupportLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

// Get saved locale from localStorage or use browser default
function getInitialLocale(): SupportLocale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && SUPPORT_LOCALES.includes(saved as SupportLocale)) {
    return saved as SupportLocale
  }

  // Try to match browser language with explicit mapping
  const browserLang = navigator.language

  // Exact match first
  if (SUPPORT_LOCALES.includes(browserLang as SupportLocale)) {
    return browserLang as SupportLocale
  }

  // Language code prefix matching
  const langCode = browserLang.split('-')[0]
  if (langCode === 'zh') {
    return 'zh-CN' // Default to Simplified Chinese for Chinese variants
  }

  // Default fallback
  return 'en'
}

const initialLocale = getInitialLocale()
// Both small catalogs ship with the app so its first render never exposes translation keys.
const i18n = createI18n({
  legacy: false, // Use Composition API
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: {
    en: { ...en, ui: uiLocales.en },
    'zh-CN': { ...zhCN, ui: uiLocales['zh-CN'] },
  },
})

export function setLocale(locale: SupportLocale) {
  i18n.global.locale.value = locale
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale
}

document.documentElement.lang = initialLocale

export default i18n
