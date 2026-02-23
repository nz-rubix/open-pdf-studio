import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// English translations
import enCommon from './locales/en/common.json';
import enRibbon from './locales/en/ribbon.json';
import enPreferences from './locales/en/preferences.json';
import enDialogs from './locales/en/dialogs.json';
import enBackstage from './locales/en/backstage.json';
import enProperties from './locales/en/properties.json';
import enContext from './locales/en/context.json';
import enStatusbar from './locales/en/statusbar.json';

// Dutch translations
import nlCommon from './locales/nl/common.json';
import nlRibbon from './locales/nl/ribbon.json';
import nlPreferences from './locales/nl/preferences.json';
import nlDialogs from './locales/nl/dialogs.json';
import nlBackstage from './locales/nl/backstage.json';
import nlProperties from './locales/nl/properties.json';
import nlContext from './locales/nl/context.json';
import nlStatusbar from './locales/nl/statusbar.json';

// French translations
import frCommon from './locales/fr/common.json';
import frRibbon from './locales/fr/ribbon.json';
import frPreferences from './locales/fr/preferences.json';
import frDialogs from './locales/fr/dialogs.json';
import frBackstage from './locales/fr/backstage.json';
import frProperties from './locales/fr/properties.json';
import frContext from './locales/fr/context.json';
import frStatusbar from './locales/fr/statusbar.json';

// German translations
import deCommon from './locales/de/common.json';
import deRibbon from './locales/de/ribbon.json';
import dePreferences from './locales/de/preferences.json';
import deDialogs from './locales/de/dialogs.json';
import deBackstage from './locales/de/backstage.json';
import deProperties from './locales/de/properties.json';
import deContext from './locales/de/context.json';
import deStatusbar from './locales/de/statusbar.json';

// Spanish translations
import esCommon from './locales/es/common.json';
import esRibbon from './locales/es/ribbon.json';
import esPreferences from './locales/es/preferences.json';
import esDialogs from './locales/es/dialogs.json';
import esBackstage from './locales/es/backstage.json';
import esProperties from './locales/es/properties.json';
import esContext from './locales/es/context.json';
import esStatusbar from './locales/es/statusbar.json';

// Chinese translations
import zhCommon from './locales/zh/common.json';
import zhRibbon from './locales/zh/ribbon.json';
import zhPreferences from './locales/zh/preferences.json';
import zhDialogs from './locales/zh/dialogs.json';
import zhBackstage from './locales/zh/backstage.json';
import zhProperties from './locales/zh/properties.json';
import zhContext from './locales/zh/context.json';
import zhStatusbar from './locales/zh/statusbar.json';

// Italian translations
import itCommon from './locales/it/common.json';
import itRibbon from './locales/it/ribbon.json';
import itPreferences from './locales/it/preferences.json';
import itDialogs from './locales/it/dialogs.json';
import itBackstage from './locales/it/backstage.json';
import itProperties from './locales/it/properties.json';
import itContext from './locales/it/context.json';
import itStatusbar from './locales/it/statusbar.json';

// Portuguese translations
import ptCommon from './locales/pt/common.json';
import ptRibbon from './locales/pt/ribbon.json';
import ptPreferences from './locales/pt/preferences.json';
import ptDialogs from './locales/pt/dialogs.json';
import ptBackstage from './locales/pt/backstage.json';
import ptProperties from './locales/pt/properties.json';
import ptContext from './locales/pt/context.json';
import ptStatusbar from './locales/pt/statusbar.json';

// Polish translations
import plCommon from './locales/pl/common.json';
import plRibbon from './locales/pl/ribbon.json';
import plPreferences from './locales/pl/preferences.json';
import plDialogs from './locales/pl/dialogs.json';
import plBackstage from './locales/pl/backstage.json';
import plProperties from './locales/pl/properties.json';
import plContext from './locales/pl/context.json';
import plStatusbar from './locales/pl/statusbar.json';

// Turkish translations
import trCommon from './locales/tr/common.json';
import trRibbon from './locales/tr/ribbon.json';
import trPreferences from './locales/tr/preferences.json';
import trDialogs from './locales/tr/dialogs.json';
import trBackstage from './locales/tr/backstage.json';
import trProperties from './locales/tr/properties.json';
import trContext from './locales/tr/context.json';
import trStatusbar from './locales/tr/statusbar.json';

// Arabic translations
import arCommon from './locales/ar/common.json';
import arRibbon from './locales/ar/ribbon.json';
import arPreferences from './locales/ar/preferences.json';
import arDialogs from './locales/ar/dialogs.json';
import arBackstage from './locales/ar/backstage.json';
import arProperties from './locales/ar/properties.json';
import arContext from './locales/ar/context.json';
import arStatusbar from './locales/ar/statusbar.json';

// Japanese translations
import jaCommon from './locales/ja/common.json';
import jaRibbon from './locales/ja/ribbon.json';
import jaPreferences from './locales/ja/preferences.json';
import jaDialogs from './locales/ja/dialogs.json';
import jaBackstage from './locales/ja/backstage.json';
import jaProperties from './locales/ja/properties.json';
import jaContext from './locales/ja/context.json';
import jaStatusbar from './locales/ja/statusbar.json';

// Korean translations
import koCommon from './locales/ko/common.json';
import koRibbon from './locales/ko/ribbon.json';
import koPreferences from './locales/ko/preferences.json';
import koDialogs from './locales/ko/dialogs.json';
import koBackstage from './locales/ko/backstage.json';
import koProperties from './locales/ko/properties.json';
import koContext from './locales/ko/context.json';
import koStatusbar from './locales/ko/statusbar.json';

// Farsi translations
import faCommon from './locales/fa/common.json';
import faRibbon from './locales/fa/ribbon.json';
import faPreferences from './locales/fa/preferences.json';
import faDialogs from './locales/fa/dialogs.json';
import faBackstage from './locales/fa/backstage.json';
import faProperties from './locales/fa/properties.json';
import faContext from './locales/fa/context.json';
import faStatusbar from './locales/fa/statusbar.json';

const ns = ['common', 'ribbon', 'preferences', 'dialogs', 'backstage', 'properties', 'context', 'statusbar'];

export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'fr', name: 'Fran\u00e7ais' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Espa\u00f1ol' },
  { code: 'zh', name: '\u4e2d\u6587' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Portugu\u00eas' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'T\u00fcrk\u00e7e' },
  { code: 'ar', name: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', dir: 'rtl' },
  { code: 'ja', name: '\u65e5\u672c\u8a9e' },
  { code: 'ko', name: '\ud55c\uad6d\uc5b4' },
  { code: 'fa', name: '\u0641\u0627\u0631\u0633\u06cc', dir: 'rtl' }
];

export const RTL_LANGUAGES = ['ar', 'fa'];

export function isRTL(lang) {
  return RTL_LANGUAGES.includes(lang);
}

i18next
  .use(LanguageDetector)
  .init({
    resources: {
      en: { common: enCommon, ribbon: enRibbon, preferences: enPreferences, dialogs: enDialogs, backstage: enBackstage, properties: enProperties, context: enContext, statusbar: enStatusbar },
      nl: { common: nlCommon, ribbon: nlRibbon, preferences: nlPreferences, dialogs: nlDialogs, backstage: nlBackstage, properties: nlProperties, context: nlContext, statusbar: nlStatusbar },
      fr: { common: frCommon, ribbon: frRibbon, preferences: frPreferences, dialogs: frDialogs, backstage: frBackstage, properties: frProperties, context: frContext, statusbar: frStatusbar },
      de: { common: deCommon, ribbon: deRibbon, preferences: dePreferences, dialogs: deDialogs, backstage: deBackstage, properties: deProperties, context: deContext, statusbar: deStatusbar },
      es: { common: esCommon, ribbon: esRibbon, preferences: esPreferences, dialogs: esDialogs, backstage: esBackstage, properties: esProperties, context: esContext, statusbar: esStatusbar },
      zh: { common: zhCommon, ribbon: zhRibbon, preferences: zhPreferences, dialogs: zhDialogs, backstage: zhBackstage, properties: zhProperties, context: zhContext, statusbar: zhStatusbar },
      it: { common: itCommon, ribbon: itRibbon, preferences: itPreferences, dialogs: itDialogs, backstage: itBackstage, properties: itProperties, context: itContext, statusbar: itStatusbar },
      pt: { common: ptCommon, ribbon: ptRibbon, preferences: ptPreferences, dialogs: ptDialogs, backstage: ptBackstage, properties: ptProperties, context: ptContext, statusbar: ptStatusbar },
      pl: { common: plCommon, ribbon: plRibbon, preferences: plPreferences, dialogs: plDialogs, backstage: plBackstage, properties: plProperties, context: plContext, statusbar: plStatusbar },
      tr: { common: trCommon, ribbon: trRibbon, preferences: trPreferences, dialogs: trDialogs, backstage: trBackstage, properties: trProperties, context: trContext, statusbar: trStatusbar },
      ar: { common: arCommon, ribbon: arRibbon, preferences: arPreferences, dialogs: arDialogs, backstage: arBackstage, properties: arProperties, context: arContext, statusbar: arStatusbar },
      ja: { common: jaCommon, ribbon: jaRibbon, preferences: jaPreferences, dialogs: jaDialogs, backstage: jaBackstage, properties: jaProperties, context: jaContext, statusbar: jaStatusbar },
      ko: { common: koCommon, ribbon: koRibbon, preferences: koPreferences, dialogs: koDialogs, backstage: koBackstage, properties: koProperties, context: koContext, statusbar: koStatusbar },
      fa: { common: faCommon, ribbon: faRibbon, preferences: faPreferences, dialogs: faDialogs, backstage: faBackstage, properties: faProperties, context: faContext, statusbar: faStatusbar }
    },
    ns,
    defaultNS: 'common',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: []
    }
  });

export default i18next;
