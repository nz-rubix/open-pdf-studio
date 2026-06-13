// Background print job: render the selected pages to a temp PDF and spool it
// to the printer, reporting progress through printProgressStore so the print
// dialog can close immediately and the user keeps working.

import { PDFDocument } from 'pdf-lib';
import { getActiveDocument, getPageRotation } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { renderPageOffscreen, canvasToBytes } from './exporter.js';
import {
  startPrintProgress, updatePrintProgress, finishPrintProgress, failPrintProgress,
} from '../solid/stores/printProgressStore.js';

/**
 * Run a print job in the background. Fire-and-forget: the caller closes the
 * dialog first, this drives the floating progress bar.
 * @param {{ pages:number[], copies:number, printer:string }} opts
 */
export async function runPrintJob({ pages, copies, printer }) {
  startPrintProgress('Afdrukken voorbereiden…');
  try {
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) throw new Error('geen document');
    const exportScale = 300 / 72;
    const newPdf = await PDFDocument.create();
    // Reserve the last slice of the bar for the spool step.
    const total = pages.length + 1;

    for (let i = 0; i < pages.length; i++) {
      const pageNum = pages[i];
      updatePrintProgress(`Pagina ${pageNum} renderen… (${i + 1}/${pages.length})`, i / total);
      const canvas = await renderPageOffscreen(pageNum, exportScale);
      const jpegBytes = await canvasToBytes(canvas, 'jpeg', 0.92);
      const jpegImage = await newPdf.embedJpg(jpegBytes);

      const origPage = await doc.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const origViewportOpts = { scale: 1 };
      if (extraRotation) origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
      const origViewport = origPage.getViewport(origViewportOpts);

      const pdfPage = newPdf.addPage([origViewport.width, origViewport.height]);
      pdfPage.drawImage(jpegImage, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
    }

    updatePrintProgress('Afdrukgegevens opslaan…', pages.length / total);
    const pdfBytes = await newPdf.save();
    const tempPath = await invoke('write_temp_pdf', { data: Array.from(pdfBytes) });
    if (!tempPath) throw new Error('kon tijdelijk bestand niet maken');

    const numCopies = Math.max(1, copies);
    for (let c = 0; c < numCopies; c++) {
      updatePrintProgress(
        numCopies > 1 ? `Kopie ${c + 1} van ${numCopies} verzenden…` : 'Verzenden naar printer…',
        (pages.length + c / numCopies) / total
      );
      await invoke('print_pdf', { path: tempPath, printer });
    }

    finishPrintProgress('Afdruktaak verzonden');
    // delete_file (not delete_temp_file — that command does not exist).
    setTimeout(async () => { try { await invoke('delete_file', { path: tempPath }); } catch (_) {} }, 30000);
  } catch (e) {
    console.error('Print job failed:', e);
    failPrintProgress('Afdrukken mislukt: ' + (e?.message ?? e));
  }
}
