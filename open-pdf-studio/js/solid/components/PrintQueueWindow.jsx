// STANDALONE "PDF-opvang" window — its OWN Tauri window beside Open PDF
// Studio (rendered when main.js sees ?view=printqueue), NOT an in-app dialog.
//
// Catches PDFs printed to "Open PDF Printer" from ANY program: lists the
// captured jobs, lets the user reorder, open in Studio, save individually,
// or merge a selection into one PDF. Polls the spool itself so new prints
// appear while the window is open.
import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { printQueueJobs as queueJobs, refreshPrintQueue, deletePrintJob } from '../stores/printQueueStore.js';
import { isTauri, invoke, readBinaryFile, writeBinaryFile, saveFileDialog } from '../../core/platform.js';

const POLL_MS = 2500;

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtSize(b) {
  return b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
}

export default function PrintQueueWindow() {
  const [order, setOrder] = createSignal([]);
  const [checked, setChecked] = createSignal(new Set());
  const [busyMsg, setBusyMsg] = createSignal('');
  let seen = new Set();

  // Keep local order/selection in sync as jobs arrive/leave.
  createEffect(() => {
    const files = queueJobs().map(j => j.file);
    setOrder(prev => {
      const kept = prev.filter(f => files.includes(f));
      const added = files.filter(f => !kept.includes(f));
      return [...kept, ...added];
    });
    setChecked(prev => {
      const next = new Set([...prev].filter(f => files.includes(f)));
      for (const f of files) if (!seen.has(f)) next.add(f); // auto-check new arrivals
      seen = new Set(files);
      return next;
    });
  });

  // This window polls the spool itself (collect + list) so new prints show
  // up live, independent of the main app.
  let timer = null;
  async function tick() {
    try { await invoke('virtual_printer_collect'); } catch (_) {}
    await refreshPrintQueue();
  }
  onMount(() => { tick(); timer = setInterval(tick, POLL_MS); });
  onCleanup(() => { if (timer) clearInterval(timer); });

  const jobByFile = (f) => queueJobs().find(j => j.file === f);
  const ordered = () => order().map(jobByFile).filter(Boolean);
  const checkedJobs = () => ordered().filter(j => checked().has(j.file));

  function toggle(f) {
    setChecked(prev => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
  }
  function move(f, dir) {
    setOrder(prev => {
      const i = prev.indexOf(f), j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const n = prev.slice(); [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }

  async function openInStudio(job) {
    if (!isTauri()) return;
    try { await invoke('spawn_window_with_pdf', { pdfPath: job.path }); } catch (e) { setBusyMsg(String(e?.message ?? e)); }
  }

  async function saveJob(job) {
    if (!isTauri()) return;
    setBusyMsg('Opslaan…');
    try {
      const dest = await saveFileDialog(job.file, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!dest) { setBusyMsg(''); return; }
      try { await invoke('allow_fs_scope', { path: job.path }); } catch {}
      const bytes = await readBinaryFile(job.path);
      await writeBinaryFile(dest, new Uint8Array(bytes));
      await deletePrintJob(job.file);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }

  async function mergeAndSave() {
    const targets = checkedJobs();
    if (targets.length === 0) return;
    setBusyMsg('Samenvoegen…');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const job of targets) {
        try { await invoke('allow_fs_scope', { path: job.path }); } catch {}
        const bytes = await readBinaryFile(job.path);
        const src = await PDFDocument.load(new Uint8Array(bytes));
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      }
      const merged = await out.save();
      const dest = await saveFileDialog('Samengevoegd.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!dest) { setBusyMsg(''); return; }
      await writeBinaryFile(dest, new Uint8Array(merged));
      for (const job of targets) await deletePrintJob(job.file);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }

  async function mergeOpen() {
    const targets = checkedJobs();
    if (targets.length === 0) return;
    setBusyMsg('Samenvoegen…');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const job of targets) {
        try { await invoke('allow_fs_scope', { path: job.path }); } catch {}
        const bytes = await readBinaryFile(job.path);
        const src = await PDFDocument.load(new Uint8Array(bytes));
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      }
      const merged = await out.save();
      const tempPath = await invoke('write_temp_pdf', { data: Array.from(merged) });
      await invoke('spawn_window_with_pdf', { pdfPath: tempPath });
      for (const job of targets) await deletePrintJob(job.file);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }

  function closeWindow() {
    try { window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow()?.close(); } catch (_) {}
  }

  return (
    <div class="pq-window">
      <div class="pq-titlebar" data-tauri-drag-region>
        <span class="pq-title">PDF-opvang — Open PDF Studio</span>
      </div>
      <div class="pq-body">
        <Show when={ordered().length > 0} fallback={
          <div class="pq-empty">
            Nog geen afdrukopdrachten.<br/>
            Print vanuit een programma naar <b>"Open PDF Printer"</b> en de opdracht verschijnt hier.
          </div>
        }>
          <div class="pq-list">
            <For each={ordered()}>
              {(job) => (
                <div class="pq-row">
                  <input type="checkbox" checked={checked().has(job.file)} onChange={() => toggle(job.file)} />
                  <div class="pq-info">
                    <div class="pq-name">{job.file}</div>
                    <div class="pq-meta">Bladzijden: {job.pages || '?'} · {fmtSize(job.size)} · {fmtTime(job.modifiedMs)}</div>
                  </div>
                  <div class="pq-actions">
                    <button class="pref-btn" title="Omhoog" onClick={() => move(job.file, -1)}>▲</button>
                    <button class="pref-btn" title="Omlaag" onClick={() => move(job.file, 1)}>▼</button>
                    <button class="pref-btn" onClick={() => openInStudio(job)}>Openen</button>
                    <button class="pref-btn" onClick={() => saveJob(job)}>Opslaan</button>
                    <button class="pref-btn" title="Verwijderen" onClick={() => deletePrintJob(job.file)}>🗑</button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="pq-footer">
        <span class="pq-status">{busyMsg()}</span>
        <div class="pq-footer-btns">
          <button class="pref-btn" disabled={checkedJobs().length === 0} onClick={mergeOpen}>
            Samenvoegen &amp; openen
          </button>
          <button class="pref-btn pref-btn-primary" disabled={checkedJobs().length === 0} onClick={mergeAndSave}>
            Samenvoegen &amp; opslaan{checkedJobs().length > 1 ? ` (${checkedJobs().length})` : ''}
          </button>
          <button class="pref-btn pref-btn-secondary" onClick={closeWindow}>Sluiten</button>
        </div>
      </div>
    </div>
  );
}
