// Passieve weergave-engine-indicator voor de statusbalk: de render-paden
// melden hier welke engine de huidige weergave daadwerkelijk levert. Geen
// keuze-UI (PDFium blijft de vaste basis-engine); puur zichtbaarheid.
import { createSignal } from 'solid-js';

// 'pdfium' | 'scene' | 'vector' | ''
const [activeEngine, setActiveEngineSignal] = createSignal('');

export { activeEngine };

/** Gemeld door de render-paden zodra ze daadwerkelijk pixels leveren. */
export function reportActiveEngine(engine) {
  if (engine !== activeEngine()) setActiveEngineSignal(engine);
}
