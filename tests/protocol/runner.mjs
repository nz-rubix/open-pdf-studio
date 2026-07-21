#!/usr/bin/env node
// MCP-driven test runner for Open PDF Studio.
//
// Reads scenario JSON files from ./scenarios, drives the running Tauri app
// via the MCP server on http://127.0.0.1:9223/mcp, captures state probes +
// screenshots, evaluates assertions, and writes a per-run report under
// ./results/<timestamp>/.
//
// Usage (from repo root):
//   node tests/protocol/runner.mjs                 # run all scenarios
//   node tests/protocol/runner.mjs 02-zoom-anchor  # run scenarios whose
//                                                  # filename contains the
//                                                  # given substring
//
// Requirements:
//   - Tauri binary running with --mcp-server --mcp-port 9223
//   - Node 18+ (for built-in fetch)
//
// Scenario JSON schema (see ./scenarios/*.json for examples):
//   {
//     "name": "short-id",
//     "description": "what this scenario validates",
//     "setup": { "pdfPath": "...", "page": 1, "scale": 1.0 },
//     "steps": [ { "action": "...", ...params } ],
//     "assertions": [ { "type": "...", ...params } ],
//     "captureScreenshots": ["pre", "post"]
//   }

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:9223/mcp';
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCENARIO_DIR = join(__dirname, 'scenarios');
const RESULTS_BASE = join(__dirname, 'results');

let _rpcId = 1;
async function mcp(method, params = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params });
  const res = await fetch(MCP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (j.error) throw new Error(`MCP error: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
}

async function tool(name, args = {}) {
  const r = await mcp('tools/call', { name, arguments: args });
  // Tool responses wrap their JSON-as-string inside content[0].text.
  if (r?.content?.[0]?.text) {
    try { return JSON.parse(r.content[0].text); } catch { return { _raw: r.content[0].text }; }
  }
  return r;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Resolve a dotted-path on a probe object: "container.scrollLeft" -> obj.container.scrollLeft
function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Resolve `={expression}` strings against the scenario's stored probes.
// This lets scenarios reference live DOM measurements without hardcoding
// coords that break under different window/panel layouts. Trusted input
// (scenarios are repo-committed JSON), so `new Function` is acceptable.
//
// Example:
//   { "action": "wheel_zoom",
//     "x": "={pre.container.left + pre.container.width - 30}",
//     "y": 500 }
function resolveValue(v, ctx) {
  if (typeof v !== 'string' || !v.startsWith('=')) return v;
  const expr = v.slice(1).replace(/^\{|\}$/g, '');
  try {
    return Function('probes', `with(probes){ return (${expr}); }`)(ctx.probes);
  } catch (e) {
    throw new Error(`expression failed: "${v}" — ${e.message}`);
  }
}
function resolveDeep(v, ctx) {
  if (typeof v === 'string' && v.startsWith('=')) return resolveValue(v, ctx);
  if (Array.isArray(v)) return v.map(x => resolveDeep(x, ctx));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = resolveDeep(val, ctx);
    return out;
  }
  return v;
}
function resolveStep(step, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(step)) {
    out[k] = resolveDeep(v, ctx);
  }
  return out;
}

// ── Step executors ──────────────────────────────────────────────────────

async function runStep(ctx, rawStep) {
  const step = resolveStep(rawStep, ctx);
  switch (step.action) {
    case 'open_pdf': {
      const absPath = step.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(step.path)
        ? step.path : join(REPO_ROOT, step.path);
      const r = await tool('app_open_pdf', { path: absPath });
      ctx.lastResult = r;
      if (!r.ok) throw new Error(`open_pdf failed: ${r.error}`);
      return;
    }
    case 'set_zoom':       return void (ctx.lastResult = await tool('app_set_zoom', { scale: step.scale }));
    case 'go_to_page':     return void (ctx.lastResult = await tool('app_go_to_page', { page: step.page }));
    case 'wheel_zoom':     return void (ctx.lastResult = await tool('app_wheel_zoom', { x: step.x, y: step.y, deltaY: step.deltaY ?? -120, ctrlKey: step.ctrlKey ?? true }));
    case 'mouse_click':    return void (ctx.lastResult = await tool('app_mouse_click', { x: step.x, y: step.y, button: step.button ?? 'left' }));
    case 'mouse_drag':     return void (ctx.lastResult = await tool('app_mouse_drag', { x1: step.x1, y1: step.y1, x2: step.x2, y2: step.y2, steps: step.steps ?? 15 }));
    case 'key':            return void (ctx.lastResult = await tool('app_key', { key: step.key, ctrl: step.ctrl, shift: step.shift, alt: step.alt }));
    case 'set_tool':       return void (ctx.lastResult = await tool('app_set_tool', { tool: step.tool }));
    case 'wait':           return sleep(step.ms ?? 500);
    case 'probe': {
      const r = await tool('app_get_viewport_state', {});
      ctx.probes[step.store || 'last'] = r;
      return;
    }
    // ── Button-sweep actions (Fase A testprotocol) ────────────────────
    case 'clickButton': {
      // Click a ribbon/UI element by id (or raw CSS selector). Records the
      // id for the coverage report. Fails the scenario when the element is
      // missing; a disabled element only fails when allowDisabled !== true.
      const selector = step.selector || `#${step.id}`;
      if (step.id) ctx.testedIds.add(step.id);
      const r = await tool('app_click_element', {
        selector,
        ...(step.searchTabs === false ? { searchTabs: false } : {}),
      });
      ctx.lastResult = r;
      if (step.store) ctx.probes[step.store] = r;
      if (!r.found) throw new Error(`clickButton ${selector}: element not found (${r.error ?? 'no match'})`);
      if (r.disabled && step.allowDisabled !== true) {
        throw new Error(`clickButton ${selector}: element is disabled (click skipped)`);
      }
      return;
    }
    case 'uiState': {
      // Probe {found, visible, disabled, active, text} of an element and
      // store it for assertions. Also counts as coverage for step.id.
      const selector = step.selector || `#${step.id}`;
      if (step.id) ctx.testedIds.add(step.id);
      const r = await tool('app_ui_state', {
        selector,
        ...(step.searchTabs === false ? { searchTabs: false } : {}),
      });
      ctx.probes[step.store || 'ui'] = r;
      ctx.lastResult = r;
      return;
    }
    case 'escape': {
      // Convenience: Escape + settle time (close dialogs/popups/tools).
      await tool('app_key', { key: 'Escape' });
      return sleep(step.ms ?? 250);
    }
    case 'tool': {
      // Generic MCP tool escape-hatch: { action:'tool', name, args, store }.
      // Throws when the tool reports ok:false unless expectOk === false.
      const r = await tool(step.name, step.args || {});
      ctx.lastResult = r;
      if (step.store) ctx.probes[step.store] = r;
      if (step.expectOk !== false && r && r.ok === false) {
        throw new Error(`tool ${step.name}: ${r.error ?? 'ok=false'}`);
      }
      return;
    }
    case 'screenshot': {
      const r = await tool('app_screenshot_view', { width: step.width ?? 2000 });
      if (r.png_base64) {
        const name = `${ctx.scenarioName}_${step.label || 'shot'}.png`;
        await writeFile(join(ctx.outDir, name), Buffer.from(r.png_base64, 'base64'));
        ctx.screenshots.push(name);
      }
      return;
    }
    default:
      throw new Error(`unknown step action: ${step.action}`);
  }
}

// ── Assertion evaluators ────────────────────────────────────────────────

function evalAssertion(ctx, a) {
  const probes = ctx.probes;
  switch (a.type) {
    case 'stateEqualField': {
      const v1 = dig(probes[a.preProbe || 'pre'], a.field);
      const v2 = dig(probes[a.postProbe || 'post'], a.field);
      const tol = a.tolerance ?? 0;
      const ok = Math.abs((v1 ?? 0) - (v2 ?? 0)) <= tol;
      return { ok, label: a.label || `${a.field} pre==post (±${tol})`, detail: `pre=${v1} post=${v2}` };
    }
    case 'stateChanged': {
      const v1 = dig(probes[a.preProbe || 'pre'], a.field);
      const v2 = dig(probes[a.postProbe || 'post'], a.field);
      const ok = v1 !== v2;
      return { ok, label: a.label || `${a.field} changed`, detail: `pre=${v1} post=${v2}` };
    }
    case 'stateInRange': {
      const v = dig(probes[a.probe || 'last'], a.field);
      const ok = typeof v === 'number' && v >= a.min && v <= a.max;
      return { ok, label: a.label || `${a.field} in [${a.min}, ${a.max}]`, detail: `got=${v}` };
    }
    case 'stateEquals': {
      const v = dig(probes[a.probe || 'last'], a.field);
      const ok = v === a.value;
      return { ok, label: a.label || `${a.field} === ${JSON.stringify(a.value)}`, detail: `got=${JSON.stringify(v)}` };
    }
    case 'elementEnabled': {
      // Assert an element (captured via a uiState step) is enabled/disabled.
      const p = probes[a.probe || 'ui'];
      const wantEnabled = a.enabled !== false;
      const ok = p?.found === true && p.disabled === !wantEnabled;
      return {
        ok,
        label: a.label || `${a.probe || 'ui'} ${wantEnabled ? 'enabled' : 'disabled'}`,
        detail: `found=${p?.found} disabled=${p?.disabled}`,
      };
    }
    case 'elementActive': {
      // Assert the 'active' class / aria-pressed state captured via uiState.
      const p = probes[a.probe || 'ui'];
      const wantActive = a.active !== false;
      const ok = p?.found === true && p.active === wantActive;
      return {
        ok,
        label: a.label || `${a.probe || 'ui'} ${wantActive ? 'active' : 'not active'}`,
        detail: `found=${p?.found} active=${p?.active}`,
      };
    }
    case 'elementFound': {
      const p = probes[a.probe || 'ui'];
      const wantFound = a.found !== false;
      const ok = (p?.found === true) === wantFound;
      return {
        ok,
        label: a.label || `${a.probe || 'ui'} ${wantFound ? 'found' : 'absent'}`,
        detail: `found=${p?.found}`,
      };
    }
    case 'dialogOpen': {
      // Assert a visible dialog was captured via a uiState step (typically
      // selector '.modal-overlay .modal-dialog', searchTabs:false). Optional
      // `title` requires the captured text to contain the substring.
      const p = probes[a.probe || 'ui'];
      const wantOpen = a.open !== false;
      const isOpen = p?.found === true && p.visible === true &&
        (a.title == null || String(p.text || '').toLowerCase().includes(String(a.title).toLowerCase()));
      const ok = isOpen === wantOpen;
      return {
        ok,
        label: a.label || `dialog ${a.title ? `"${a.title}" ` : ''}${wantOpen ? 'open' : 'closed'} (${a.probe || 'ui'})`,
        detail: `found=${p?.found} visible=${p?.visible} text=${JSON.stringify((p?.text || '').slice(0, 80))}`,
      };
    }
    case 'annotationCountEquals': {
      const v = dig(probes[a.probe || 'last'], 'annotationCount');
      const ok = v === a.value;
      return { ok, label: a.label || `annotationCount === ${a.value}`, detail: `got=${v}` };
    }
    case 'annotationCountDelta': {
      const v1 = dig(probes[a.preProbe || 'pre'], 'annotationCount') ?? 0;
      const v2 = dig(probes[a.postProbe || 'post'], 'annotationCount') ?? 0;
      const delta = v2 - v1;
      const ok = delta === a.delta;
      return { ok, label: a.label || `annotationCount delta === ${a.delta}`, detail: `pre=${v1} post=${v2} delta=${delta}` };
    }
    default:
      return { ok: false, label: `unknown assertion type: ${a.type}`, detail: '' };
  }
}

// ── Scenario runner ─────────────────────────────────────────────────────

async function runScenario(file, runDir) {
  const json = JSON.parse(await readFile(file, 'utf8'));
  const scenarioName = json.name || file.split(/[\\/]/).pop().replace(/\.json$/, '');
  const outDir = join(runDir, scenarioName);
  await mkdir(outDir, { recursive: true });

  const ctx = { scenarioName, outDir, probes: {}, screenshots: [], lastResult: null, testedIds: new Set() };

  // Apply setup as implicit leading steps so scenarios stay concise.
  const setupSteps = [];
  if (json.setup?.pdfPath) setupSteps.push({ action: 'open_pdf', path: json.setup.pdfPath });
  if (json.setup?.scale != null) setupSteps.push({ action: 'set_zoom', scale: json.setup.scale });
  if (json.setup?.page != null) setupSteps.push({ action: 'go_to_page', page: json.setup.page });
  setupSteps.push({ action: 'wait', ms: 800 });

  const allSteps = [...setupSteps, ...(json.steps || [])];

  try {
    for (const step of allSteps) {
      await runStep(ctx, step);
    }
  } catch (e) {
    return {
      name: scenarioName, ok: false, error: `step failure: ${e?.message ?? e}`,
      assertions: [], outDir,
      testedIds: [...ctx.testedIds], skippedButtons: json.skippedButtons || [],
    };
  }

  const results = (json.assertions || []).map(a => evalAssertion(ctx, a));
  const ok = results.every(r => r.ok);

  // Write per-scenario report
  await writeFile(join(outDir, 'report.json'), JSON.stringify({
    name: scenarioName,
    description: json.description,
    ok,
    assertions: results,
    probes: ctx.probes,
    screenshots: ctx.screenshots,
  }, null, 2));

  return {
    name: scenarioName, ok, assertions: results, outDir,
    testedIds: [...ctx.testedIds], skippedButtons: json.skippedButtons || [],
  };
}

// ── Coverage report ─────────────────────────────────────────────────────
//
// Compares the button-ids exercised by clickButton/uiState steps against
// every literal id="…" in the ribbon tab components, so a newly added
// (untested) button automatically shows up as a GAP. Scenarios document
// deliberately untestable buttons via a top-level "skippedButtons":
// [{ "id": "...", "reason": "..." }] — those are listed separately.

const RIBBON_DIR = join(REPO_ROOT, 'open-pdf-studio', 'js', 'solid', 'components', 'ribbon');

async function collectRibbonIds() {
  const ids = new Map(); // id -> file
  let files = [];
  try {
    files = (await readdir(RIBBON_DIR)).filter(n => n.endsWith('Tab.jsx'));
  } catch {
    return ids;
  }
  for (const f of files) {
    const src = await readFile(join(RIBBON_DIR, f), 'utf8');
    for (const m of src.matchAll(/id="([^"]+)"/g)) {
      if (!ids.has(m[1])) ids.set(m[1], f);
    }
  }
  return ids;
}

async function buildCoverageReport(summary, { partial }) {
  const ribbonIds = await collectRibbonIds();
  const tested = new Set();
  const skipped = new Map(); // id -> reason
  for (const s of summary) {
    for (const id of s.testedIds || []) tested.add(id);
    for (const sk of s.skippedButtons || []) {
      if (sk?.id) skipped.set(sk.id, sk.reason || sk.skipReason || 'skipped (no reason given)');
    }
  }
  const gaps = [];
  const skippedList = [];
  let covered = 0;
  for (const [id, file] of ribbonIds) {
    if (tested.has(id)) { covered++; continue; }
    if (skipped.has(id)) { skippedList.push({ id, file, reason: skipped.get(id) }); continue; }
    gaps.push({ id, file });
  }
  return {
    partial,
    ribbonIdCount: ribbonIds.size,
    testedRibbonIds: covered,
    testedIdsTotal: tested.size,
    skipped: skippedList.sort((a, b) => a.id.localeCompare(b.id)),
    gaps: gaps.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ── Entrypoint ──────────────────────────────────────────────────────────

async function main() {
  const filter = process.argv[2] || '';
  if (!existsSync(SCENARIO_DIR)) {
    console.error(`scenario dir missing: ${SCENARIO_DIR}`);
    process.exit(2);
  }
  const all = (await readdir(SCENARIO_DIR)).filter(n => n.endsWith('.json')).sort();
  const scenarios = filter ? all.filter(n => n.includes(filter)) : all;
  if (!scenarios.length) {
    console.error(`no scenarios match filter "${filter}"`);
    process.exit(2);
  }

  // Ping MCP up-front so we fail fast with a clear message.
  try {
    await mcp('tools/list', {});
  } catch (e) {
    console.error(`MCP not reachable at ${MCP_URL}: ${e.message}`);
    console.error('Start the Tauri binary with: --mcp-server --mcp-port 9223');
    process.exit(3);
  }

  // Deterministic window size: fit-scale, white-margin geometry and ribbon
  // overflow all depend on it. Best-effort — older binaries lack the tool.
  try {
    const r = await tool('app_set_window_size', { width: 1400, height: 900 });
    if (r?.ok) console.log('▸ venster op 1400x900 gezet');
  } catch { /* older binary — scenarios fall back to probe-relative coords */ }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(RESULTS_BASE, ts);
  await mkdir(runDir, { recursive: true });

  console.log(`▶ Running ${scenarios.length} scenario(s) → ${runDir}`);

  const summary = [];
  for (const file of scenarios) {
    process.stdout.write(`  ${file} … `);
    const r = await runScenario(join(SCENARIO_DIR, file), runDir);
    summary.push(r);
    if (r.ok) {
      console.log('PASS');
    } else if (r.error) {
      console.log(`ERROR (${r.error})`);
    } else {
      const failed = r.assertions.filter(a => !a.ok);
      console.log(`FAIL (${failed.length}/${r.assertions.length} assertions)`);
      for (const a of failed) console.log(`    × ${a.label} — ${a.detail}`);
    }
  }

  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // Coverage: tested button-ids vs every id="…" in the ribbon components.
  const coverage = await buildCoverageReport(summary, { partial: !!filter });
  await writeFile(join(runDir, 'coverage.json'), JSON.stringify(coverage, null, 2));
  console.log(`\n■ Dekking ribbon-knoppen: ${coverage.testedRibbonIds}/${coverage.ribbonIdCount} ids getest` +
    (coverage.partial ? ' (deelrun — dekking onvolledig per definitie)' : ''));
  if (coverage.skipped.length) {
    console.log(`  Bewust overgeslagen (${coverage.skipped.length}):`);
    for (const s of coverage.skipped) console.log(`    ~ ${s.id} — ${s.reason}`);
  }
  if (coverage.gaps.length) {
    console.log(`  GATEN (${coverage.gaps.length}) — niet getest, niet gedocumenteerd:`);
    for (const g of coverage.gaps) console.log(`    × ${g.id} (${g.file})`);
  } else {
    console.log('  Geen gaten — alle ribbon-ids getest of gedocumenteerd overgeslagen.');
  }

  const passed = summary.filter(s => s.ok).length;
  console.log(`\n${passed}/${summary.length} scenarios passed`);
  process.exit(passed === summary.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(99); });
