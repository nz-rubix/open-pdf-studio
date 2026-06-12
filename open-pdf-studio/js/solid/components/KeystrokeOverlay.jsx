import { createSignal, For, Show, onCleanup } from 'solid-js';

// Screencast keystroke overlay — shows pressed keys/shortcuts as large chips
// in the bottom-left corner, so viewers of a recorded video can follow along
// with what is being typed. Toggled from the Beeld (View) ribbon tab.
//
// Display rules:
//   * outside input fields: every key is shown ("G", "X", "Esc", "Ctrl+S");
//   * inside input fields: only modifier combos (Ctrl/Alt+…) are shown, so
//     typed text content doesn't flood the overlay;
//   * a repeat of the same key bumps a ×N counter instead of adding a chip;
//   * chips fade out automatically after a short delay.

const [visible, setVisible] = createSignal(false);
const [keys, setKeys] = createSignal([]); // [{ id, label, count }]

let _nextId = 1;
const CHIP_TTL_MS = 2200;
const MAX_CHIPS = 5;

export function keystrokeOverlayVisible() { return visible(); }

export function toggleKeystrokeOverlay() {
  setVisible(!visible());
  if (!visible()) setKeys([]);
}

// Pretty-print a KeyboardEvent as a compact chip label.
function formatKey(e) {
  const special = {
    ' ': 'Space', 'Escape': 'Esc', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'ArrowLeft': '←', 'ArrowRight': '→', 'Enter': 'Enter', 'Tab': 'Tab',
    'Backspace': '⌫', 'Delete': 'Del', 'Home': 'Home', 'End': 'End',
    'PageUp': 'PgUp', 'PageDown': 'PgDn', 'CapsLock': 'Caps',
  };
  let k = e.key;
  // Bare modifier presses show as the modifier itself
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null;
  k = special[k] ?? (k.length === 1 ? k.toUpperCase() : k);

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && k.length > 1) parts.push('Shift'); // letters already show case via Shift
  parts.push(k);
  return parts.join('+');
}

function pushKey(label) {
  setKeys(prev => {
    const now = [...prev];
    const last = now[now.length - 1];
    if (last && last.label === label) {
      // Same key again → bump the counter on the existing chip
      last.count += 1;
      last.id = _nextId++; // refresh identity so its TTL restarts
      scheduleExpiry(last.id);
      return [...now.slice(0, -1), { ...last }];
    }
    const chip = { id: _nextId++, label, count: 1 };
    now.push(chip);
    scheduleExpiry(chip.id);
    return now.slice(-MAX_CHIPS);
  });
}

function scheduleExpiry(id) {
  setTimeout(() => {
    setKeys(prev => prev.filter(c => c.id !== id));
  }, CHIP_TTL_MS);
}

function onKeyDown(e) {
  if (!visible()) return;
  const label = formatKey(e);
  if (!label) return;
  const inInput = e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA'
    || e.target?.isContentEditable;
  // In text inputs only surface real shortcuts, not typed content.
  if (inInput && !(e.ctrlKey || e.metaKey || e.altKey)) return;
  pushKey(label);
}

export default function KeystrokeOverlay() {
  document.addEventListener('keydown', onKeyDown, true);
  onCleanup(() => document.removeEventListener('keydown', onKeyDown, true));

  return (
    <Show when={visible()}>
      <div style={{
        position: 'fixed',
        left: '16px',
        bottom: '40px',
        'z-index': 4000,
        display: 'flex',
        gap: '8px',
        'align-items': 'flex-end',
        'pointer-events': 'none',
      }}>
        <For each={keys()}>
          {(chip) => (
            <div style={{
              background: 'rgba(20, 20, 20, 0.85)',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.25)',
              padding: '8px 14px',
              'font-size': '20px',
              'font-weight': 600,
              'font-family': 'Segoe UI, Arial, sans-serif',
              'box-shadow': '0 2px 8px rgba(0,0,0,0.4)',
              'white-space': 'nowrap',
            }}>
              {chip.label}{chip.count > 1 ? ` ×${chip.count}` : ''}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
