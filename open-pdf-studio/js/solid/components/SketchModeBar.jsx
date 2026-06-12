import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import { state } from '../../core/state.js';
import { filledAreaSketch } from '../../tools/tools/filled-area-tool.js';

// Floating sketch toolbar for the filled-area (arcering) tool — makes the
// existing sketch machinery VISIBLE: line/arc segments, close-contour with
// the >=3-points check, donut openings (holes phase) and an explicit
// "Gereed" that commits and leaves the mode. Mirrors the keyboard flow
// ('A' = boog, klik bij beginpunt = sluiten, Enter = gereed, Esc = annuleren).

const BTN = 'padding:3px 10px;font-size:11px;font-family:inherit;border:1px solid var(--theme-border,#888);background:var(--theme-surface,#fff);color:var(--theme-text,#333);cursor:pointer;border-radius:0';
const BTN_ACTIVE = BTN + ';background:var(--theme-accent-soft,#cce4f7);box-shadow:inset 0 0 0 1px var(--theme-active,#0078d7)';

export default function SketchModeBar() {
  const [snap, setSnap] = createSignal({ visible: false });

  // Poll tool state (same pattern as BoxSizeOverlay) — the drawing state
  // lives in plain module state, not a Solid store.
  let timer = null;
  onMount(() => {
    timer = setInterval(() => {
      const visible = state.currentTool === 'filledArea' && filledAreaSketch.isActive();
      setSnap(visible ? { visible: true, ...filledAreaSketch.status() } : { visible: false });
    }, 150);
  });
  onCleanup(() => { if (timer) clearInterval(timer); });

  const s = () => snap();
  const closeEnabled = () => (s().points || 0) >= 3;
  const finishEnabled = () => s().outerClosed || (s().points || 0) >= 3;
  const statusText = () => {
    const st = s();
    if (st.phase === 'holes') {
      const cur = st.points > 0 ? ` · bezig met opening (${st.points} ${st.points === 1 ? 'punt' : 'punten'})` : '';
      return `Buitenrand gesloten ✓ · openingen: ${st.holes}${cur}`;
    }
    return st.points >= 3
      ? `Buitenrand open — ${st.points} punten (sluitbaar)`
      : `Buitenrand open — ${st.points} ${st.points === 1 ? 'punt' : 'punten'}`;
  };

  return (
    <Show when={s().visible}>
      <div style={{
        position: 'fixed',
        left: '50%',
        bottom: '46px',
        transform: 'translateX(-50%)',
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        padding: '5px 8px',
        background: 'var(--theme-surface, #f5f5f5)',
        color: 'var(--theme-text, #333)',
        border: '1px solid var(--theme-border, #7a7a7a)',
        'box-shadow': '2px 2px 6px rgba(0,0,0,0.3)',
        'z-index': 1500,
        'font-size': '11px',
        'user-select': 'none',
      }}>
        <span style={{ opacity: 0.8, 'margin-right': '4px', 'white-space': 'nowrap' }}>{statusText()}</span>
        <button style={!s().arcMode ? BTN_ACTIVE : BTN} title="Recht segment"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => filledAreaSketch.setArcMode(false)}>Lijn</button>
        <button style={s().arcMode ? BTN_ACTIVE : BTN} title="Boogsegment (sneltoets A, muiswiel = bolling)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => filledAreaSketch.setArcMode(true)}>Boog</button>
        <button style={BTN + (closeEnabled() ? '' : ';opacity:0.45;cursor:default')}
          title={s().phase === 'holes' ? 'Opening sluiten (≥ 3 punten)' : 'Buitenrand sluiten (≥ 3 punten) — daarna kun je openingen (donut) tekenen'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => closeEnabled() && filledAreaSketch.closeLoop()}>
          {s().phase === 'holes' ? 'Opening sluiten' : 'Sluit contour'}
        </button>
        <button style={BTN + (finishEnabled() ? ';font-weight:600' : ';opacity:0.45;cursor:default')}
          title="Controleert of de contouren gesloten zijn, tekent de arcering en verlaat de modus (Enter)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => finishEnabled() && filledAreaSketch.finish()}>✓ Gereed</button>
        <button style={BTN} title="Annuleren (Esc)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => filledAreaSketch.cancel()}>✕</button>
      </div>
    </Show>
  );
}
