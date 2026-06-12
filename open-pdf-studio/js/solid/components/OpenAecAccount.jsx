// "Sign in with OpenAEC" — platform-account in the title bar (mirrors the
// Open Calc Studio integration). Distinct from AccountDropdown.jsx, which is
// the Impertio account that unlocks the AI features.
import { Show, createSignal, onCleanup } from 'solid-js';
import {
  openaecUser, openaecBusy, openaecError,
  openaecSignIn, openaecSignOut,
} from '../stores/openaecStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

function initial(u) {
  const source = (u?.name || u?.email || '').trim();
  return (source.charAt(0) || '?').toUpperCase();
}

export default function OpenAecAccount() {
  const { t } = useTranslation('common');
  const [open, setOpen] = createSignal(false);
  let wrapRef;

  function handleClickOutside(e) {
    if (wrapRef && !wrapRef.contains(e.target)) setOpen(false);
  }

  async function toggle(e) {
    e.stopPropagation();
    if (!openaecUser()) {
      await openaecSignIn();
      return;
    }
    const next = !open();
    setOpen(next);
    if (next) setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    else document.removeEventListener('mousedown', handleClickOutside);
  }

  onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));

  const tooltip = () => {
    if (openaecError()) return openaecError();
    if (openaecBusy()) return t('openaecSigningIn') || 'Signing in via the browser…';
    const u = openaecUser();
    return u ? `OpenAEC — ${u.name || u.email}` : (t('openaecSignIn') || 'Sign in with OpenAEC');
  };

  return (
    <div class="account-dropdown-wrapper" ref={wrapRef}>
      <button
        class="account-btn openaec-account-btn"
        classList={{ 'openaec-busy': openaecBusy() }}
        title={tooltip()}
        onClick={toggle}
        disabled={openaecBusy()}
      >
        <Show when={openaecUser()} fallback={
          /* OpenAEC hexagon mark, outline while signed out */
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
            <path d="M8 1.5 13.5 4.75v6.5L8 14.5 2.5 11.25v-6.5z"/>
            <path d="M8 8v6.5M2.5 4.75 8 8l5.5-3.25"/>
          </svg>
        }>
          <span class="account-avatar openaec-avatar">{initial(openaecUser())}</span>
        </Show>
      </button>

      <Show when={open() && openaecUser()}>
        <div class="account-dropdown">
          <div class="account-dropdown-header">
            <div class="account-avatar-large openaec-avatar">{initial(openaecUser())}</div>
            <div class="account-info">
              <div class="account-name">{openaecUser().name || openaecUser().email}</div>
              <Show when={openaecUser().email && openaecUser().email !== openaecUser().name}>
                <div class="account-email">{openaecUser().email}</div>
              </Show>
              <div class="account-email">OpenAEC</div>
            </div>
          </div>

          <div class="account-dropdown-divider" />

          <button class="account-dropdown-item account-signout"
            onClick={() => { setOpen(false); openaecSignOut(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {t('openaecSignOut') || 'Sign out'}
          </button>
        </div>
      </Show>
    </div>
  );
}
