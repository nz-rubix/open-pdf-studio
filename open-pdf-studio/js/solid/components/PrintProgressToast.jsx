// Floating, non-modal print progress bar (bottom-right). Shown while a
// background print job runs so the user can keep working.
import { Show } from 'solid-js';
import {
  printProgressActive, printProgressLabel, printProgressValue, printProgressError,
} from '../stores/printProgressStore.js';

export default function PrintProgressToast() {
  return (
    <Show when={printProgressActive()}>
      <div class="print-progress-toast" classList={{ 'print-progress-error': printProgressError() }}>
        <div class="print-progress-label">{printProgressLabel()}</div>
        <div class="print-progress-track">
          <div class="print-progress-fill" style={{ width: Math.round((printProgressValue() || 0) * 100) + '%' }} />
        </div>
      </div>
    </Show>
  );
}
