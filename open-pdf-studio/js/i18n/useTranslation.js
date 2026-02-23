import { createSignal } from 'solid-js';
import i18next, { isRTL } from './config.js';

const [language, setLanguage] = createSignal(i18next.language || 'en');

i18next.on('languageChanged', (lng) => {
  setLanguage(lng);
  const dir = isRTL(lng) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lng);
});

export function useTranslation(ns = 'common') {
  const namespaces = Array.isArray(ns) ? ns : [ns];
  const t = (key, options) => {
    language();
    return i18next.t(key, { ns: namespaces[0], ...options });
  };
  return { t, i18n: i18next, language };
}

export function changeLanguage(lang) {
  if (lang === 'auto') {
    const detected = i18next.services.languageDetector.detect();
    const resolvedLang = Array.isArray(detected) ? detected[0] : detected;
    const baseLang = resolvedLang ? resolvedLang.split('-')[0] : 'en';
    const supported = i18next.options.resources ? Object.keys(i18next.options.resources) : ['en'];
    const finalLang = supported.includes(baseLang) ? baseLang : 'en';
    return i18next.changeLanguage(finalLang);
  }
  return i18next.changeLanguage(lang);
}

export { language };
