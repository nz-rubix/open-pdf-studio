// pocs/shared/bench-harness.mjs — CDP-based render perf measurement
//
// Connects to a running Tauri dev app on CDP port 9222 and times pure
// `invoke('render_pdf_page', ...)` calls. No reliance on loader.js/state —
// we measure the Rust render path + IPC, not the full app load.
//
// Setup:
//   1. WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//   2. npm run tauri:dev (from open-pdf-studio/)
//   3. App window open
//
// Usage:
//   node pocs/shared/bench-harness.mjs --fixture barn --scenario cold_open_p1
//
// Output: JSON on stdout with per-run timing + median/p95 stats.

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));

const args = parseArgs(process.argv.slice(2));
if (!args.fixture || !args.scenario) {
  console.error('Usage: bench-harness.mjs --fixture <name> --scenario <name> [--runs <n>]');
  console.error(`Fixtures: ${corpus.fixtures.map(f => f.name).join(', ')}`);
  console.error(`Scenarios: ${corpus.scenarios.map(s => s.name).join(', ')}`);
  process.exit(2);
}

const fixture = corpus.fixtures.find(f => f.name === args.fixture);
const scenario = corpus.scenarios.find(s => s.name === args.scenario);
if (!fixture) { console.error(`Unknown fixture: ${args.fixture}`); process.exit(2); }
if (!scenario) { console.error(`Unknown scenario: ${args.scenario}`); process.exit(2); }

const pdfPath = join(PROJECT_ROOT, corpus.fixture_root, fixture.path);
const measuredRuns = args.runs ? parseInt(args.runs) : scenario.measured_runs;
const warmupRuns = scenario.warmup_runs;

async function main() {
  let browser;
  try {
    browser = await playwright.chromium.connectOverCDP('http://localhost:9222', { timeout: 10000 });
  } catch (e) {
    console.error(`FATAL: cannot connect to CDP on localhost:9222.`);
    console.error(`Underlying error: ${e.message}`);
    process.exit(3);
  }

  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { console.error('No page in CDP context'); process.exit(3); }

  // Grant FS scope — bypass loader.js stack to avoid WIP-related conflicts.
  const fsOk = await page.evaluate(async (p) => {
    try { await window.__TAURI__.core.invoke('allow_fs_scope', { path: p }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }, pdfPath);

  if (!fsOk.ok) {
    console.error(`Failed to grant fs scope: ${JSON.stringify(fsOk)}`);
    process.exit(4);
  }

  let runs;
  switch (scenario.name) {
    case 'cold_open_p1':       runs = await scenarioColdOpenP1(page, fixture, pdfPath, warmupRuns, measuredRuns); break;
    case 'scroll_p1_to_p7':    runs = await scenarioScrollAll(page, fixture, pdfPath, warmupRuns, measuredRuns); break;
    case 'zoom_in_revisit':    runs = await scenarioZoomRevisit(page, fixture, pdfPath, warmupRuns, measuredRuns); break;
    case 'scroll_back_revisit':runs = await scenarioScrollBackRevisit(page, fixture, pdfPath, warmupRuns, measuredRuns); break;
    default:                    console.error(`Unknown scenario: ${scenario.name}`); process.exit(2);
  }

  await browser.close();

  const measured = runs.slice(warmupRuns).map(r => r.totalMs);
  const sorted = [...measured].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const mean = measured.reduce((a, b) => a + b, 0) / measured.length;

  const result = {
    fixture: fixture.name,
    scenario: scenario.name,
    pdfPath: pdfPath.replace(PROJECT_ROOT + '\\', ''),
    runs: runs.map((r, i) => ({ run: i, warmup: i < warmupRuns, ...r })),
    stats: {
      n: measured.length,
      median_ms: round1(median),
      mean_ms: round1(mean),
      p95_ms: round1(p95),
      min_ms: round1(Math.min(...measured)),
      max_ms: round1(Math.max(...measured)),
    },
    expected_baseline_ms: fixture.expected_baseline_ms,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

// ─── scenarios ────────────────────────────────────────────

async function scenarioColdOpenP1(page, fixture, pdfPath, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    // Clear Rust-side cache between runs for true cold measurements
    await page.evaluate(async (p) => {
      try { await window.__TAURI__.core.invoke('clear_pdf_cache', { path: p }); }
      catch (e) { /* command may not exist on all builds */ }
    }, pdfPath);
    await sleep(200);

    const t = await page.evaluate(async (p) => {
      const t0 = performance.now();
      const buf = await window.__TAURI__.core.invoke('render_pdf_page', {
        path: p, pageIndex: 0, scale: 1.0, rotation: 0,
      });
      const dt = performance.now() - t0;
      const view = new DataView(buf.buffer || buf);
      return { totalMs: dt, width: view.getUint32(0, true), height: view.getUint32(4, true) };
    }, pdfPath);
    runs.push(t);
  }
  return runs;
}

async function scenarioScrollAll(page, fixture, pdfPath, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    const t = await page.evaluate(async ({ p, numPages }) => {
      const t0 = performance.now();
      for (let pn = 0; pn < numPages; pn++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path: p, pageIndex: pn, scale: 1.0, rotation: 0 });
      }
      return { totalMs: performance.now() - t0 };
    }, { p: pdfPath, numPages: fixture.pages });
    runs.push(t);
  }
  return runs;
}

async function scenarioZoomRevisit(page, fixture, pdfPath, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    const t = await page.evaluate(async (p) => {
      await window.__TAURI__.core.invoke('render_pdf_page', { path: p, pageIndex: 0, scale: 1.0, rotation: 0 });
      const t1 = performance.now();
      await window.__TAURI__.core.invoke('render_pdf_page', { path: p, pageIndex: 0, scale: 1.5, rotation: 0 });
      const zoomIn = performance.now() - t1;
      const t2 = performance.now();
      await window.__TAURI__.core.invoke('render_pdf_page', { path: p, pageIndex: 0, scale: 1.0, rotation: 0 });
      const zoomBack = performance.now() - t2;
      return { totalMs: zoomIn + zoomBack, zoomIn_ms: zoomIn, zoomBack_ms: zoomBack };
    }, pdfPath);
    runs.push(t);
  }
  return runs;
}

async function scenarioScrollBackRevisit(page, fixture, pdfPath, warmup, measured) {
  const runs = [];
  for (let i = 0; i < warmup + measured; i++) {
    const t = await page.evaluate(async ({ p, numPages }) => {
      // Cold pass to prime caches
      for (let pn = 0; pn < numPages; pn++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path: p, pageIndex: pn, scale: 1.0, rotation: 0 });
      }
      // Warm pass — measure this
      const t0 = performance.now();
      for (let pn = 0; pn < numPages; pn++) {
        await window.__TAURI__.core.invoke('render_pdf_page', { path: p, pageIndex: pn, scale: 1.0, rotation: 0 });
      }
      return { totalMs: performance.now() - t0 };
    }, { p: pdfPath, numPages: fixture.pages });
    runs.push(t);
  }
  return runs;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function round1(n) { return Math.round(n * 10) / 10; }

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
