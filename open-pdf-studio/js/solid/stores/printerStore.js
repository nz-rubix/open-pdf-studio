// Printer enumeration cache. Filled lazily at app startup (see main.js) so
// the print dialog can show the OS default printer INSTANTLY instead of
// waiting on PowerShell/lpstat each time it opens.

import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';

const [printers, setPrinters] = createSignal([]);
const [defaultPrinter, setDefaultPrinter] = createSignal('');
const [loaded, setLoaded] = createSignal(false);

export { printers as printerList, defaultPrinter as defaultPrinterName, loaded as printersLoaded };

/** Enumerate printers (cached). Pass force=true to re-query. Safe to call
 *  repeatedly; concurrent calls share the in-flight promise. */
let _inflight = null;
export function loadPrinters(force = false) {
  if (loaded() && !force) return Promise.resolve(printers());
  if (_inflight) return _inflight;
  if (!isTauri()) return Promise.resolve([]);
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.resolve([]);
  _inflight = (async () => {
    try {
      const json = await inv('get_printers');
      const parsed = JSON.parse(json);
      const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      setPrinters(list);
      const def = list.find(p => p.Default === true || p.Default === 'True');
      setDefaultPrinter(def?.Name || list[0]?.Name || '');
      setLoaded(true);
      return list;
    } catch (e) {
      console.warn('[printers] enumeration failed:', e);
      return [];
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}
