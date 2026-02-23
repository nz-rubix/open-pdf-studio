import { createSignal, onMount } from 'solid-js';
import { getAppVersion, openExternal } from '../../../core/platform.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function AboutPanel() {
  const { t } = useTranslation('backstage');
  const [version, setVersion] = createSignal(t('aboutPanel.version'));

  onMount(async () => {
    const v = await getAppVersion();
    if (v) setVersion(`${t('aboutPanel.version')} ${v}`);
  });

  return (
    <div class="bs-about-panel">
      <h2 class="bs-about-title">{t('aboutPanel.title')}</h2>
      <div class="bs-about-app">
        <div class="bs-about-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2V8H20" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 13H8" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 17H8" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 9H9H8" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="bs-about-app-info">
          <h1 class="bs-about-app-name">{t('aboutPanel.appName')}</h1>
          <p class="bs-about-version">{version()}</p>
        </div>
      </div>
      <p class="bs-about-tagline">{t('aboutPanel.tagline')}</p>
      <p class="bs-about-description">
        {t('aboutPanel.description')}
      </p>
      <div class="bs-about-company">
        <h3 class="bs-about-company-name">{t('aboutPanel.companyName')}</h3>
        <p class="bs-about-company-desc">
          {t('aboutPanel.companyDescription')}
        </p>
      </div>
      <div class="bs-about-links">
        <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExternal('https://impertio.nl/'); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          {t('aboutPanel.website')}
        </a>
        <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExternal('mailto:maarten@impertio.nl'); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          {t('aboutPanel.contact')}
        </a>
      </div>
      <div class="bs-about-footer">
        <p class="bs-about-copyright">{t('aboutPanel.copyright')}</p>
      </div>
    </div>
  );
}
