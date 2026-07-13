// Store voor de online symboolbibliotheek.
//
// Verantwoordelijk voor: (1) de wereld-index ophalen (één index.json) met
// cache in preferences + offline-fallback naar de statische lijst,
// (2) de Industrie/Land-lijsten voor de Settings-dialoog, en (3) het
// on-demand downloaden van collecties → palette-groepen die via het
// bestaande custom-groups-mechanisme persist worden.
//
// De pure parse/convert-functies leven in data/symbolLibraryOnline.js
// (node-testbaar); hier zit alleen netwerk + Solid + preferences.
//
// Fetch gaat rechtstreeks via fetch(): de CSP staat `connect-src … https:`
// toe (zelfde patroon als de feedback-dialoog).

import { createSignal, createMemo } from 'solid-js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import { language } from '../../i18n/useTranslation.js';
import { INDUSTRIES, COUNTRIES } from '../data/symbolLocales.js';
import { getCustomGroups, upsertCustomGroup, addGroupLocaleTag } from './symbolStore.js';
import {
  LIBRARY_INDEX_URL,
  parseLibraryIndex, pickLocalized, sectorLabel,
  collectionJsonUrl, symbolsListApiUrl, symbolRawUrl, stampsJsonUrl,
  parametricJsonUrl, collectionToGroup,
} from '../data/symbolLibraryOnline.js';
import { parseSteelSectionCatalog, steelCatalogToGroup } from '../../symbols/steel-catalog.js';
import { registerSteelCatalog } from '../../symbols/steel-catalog-store.js';

const INDEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 dag; daarna stille refresh
const FETCH_TIMEOUT_MS = 20000;
const PARALLEL_FETCHES = 6;

// --- State ---
const [indexData, setIndexData] = createSignal(null); // geparste index of null
// 'idle' | 'loading' | 'ready' | 'offline' (fetch faalde én geen cache)
const [indexStatus, setIndexStatus] = createSignal('idle');
const [downloadBusy, setDownloadBusy] = createSignal(false);
const [downloadProgress, setDownloadProgress] = createSignal(null); // {done,total,label}
const [downloadError, setDownloadError] = createSignal('');

// --- Fetch-helpers met timeout ---
async function fetchWithTimeout(url, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: accept } });
    if (!res.ok) throw new Error(`HTTP ${res.status} bij ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  return (await fetchWithTimeout(url, 'application/json')).json();
}

async function fetchText(url) {
  return (await fetchWithTimeout(url, 'image/svg+xml, text/plain, */*')).text();
}

// --- Index laden: cache-first, daarna (stille) refresh ---
let indexFetchPromise = null;

async function refreshIndexFromNetwork() {
  const raw = await fetchJson(LIBRARY_INDEX_URL);
  const parsed = parseLibraryIndex(raw);
  setIndexData(parsed);
  setIndexStatus('ready');
  state.preferences.symbolLibraryIndexCache = { fetchedAt: Date.now(), index: parsed };
  savePreferences();
  return parsed;
}

// Aanroepen wanneer de Settings-dialoog opent. Toont direct de gecachte
// index (ook offline) en ververst op de achtergrond als de cache oud is.
// Zonder cache én zonder netwerk valt de UI terug op de statische
// INDUSTRIES/COUNTRIES-lijst (status 'offline').
export function ensureLibraryIndex() {
  if (indexData() && indexStatus() === 'ready') return;
  const cache = state.preferences.symbolLibraryIndexCache;
  if (cache && cache.index && Array.isArray(cache.index.countries) && cache.index.countries.length) {
    setIndexData(cache.index);
    setIndexStatus('ready');
    if (Date.now() - (cache.fetchedAt || 0) < INDEX_CACHE_TTL_MS) return;
    // Cache is oud: stil verversen, cache blijft staan bij falen.
    if (!indexFetchPromise) {
      indexFetchPromise = refreshIndexFromNetwork()
        .catch(() => {})
        .finally(() => { indexFetchPromise = null; });
    }
    return;
  }
  if (indexFetchPromise) return;
  setIndexStatus('loading');
  indexFetchPromise = refreshIndexFromNetwork()
    .catch((e) => {
      console.warn('Symboolbibliotheek-index niet bereikbaar:', e);
      setIndexStatus('offline');
    })
    .finally(() => { indexFetchPromise = null; });
}

// --- Dropdown-lijsten (fallback: statische lijst zolang er geen index is) ---
export const libraryIndustries = createMemo(() => {
  const idx = indexData();
  if (!idx || !idx.sectors.length) return INDUSTRIES;
  return idx.sectors.map(id => ({ id, name: sectorLabel(id) }));
});

export const libraryCountries = createMemo(() => {
  const idx = indexData();
  const lang = language();
  if (!idx || !idx.countries.length) return COUNTRIES;
  return idx.countries
    .map(c => ({ id: c.id, name: pickLocalized(c.names, lang), flag: c.flag }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
});

// --- Downloadstatus per land+sector ---
function availableCollectionsFor(countryId, sectorId) {
  const idx = indexData();
  if (!idx) return [];
  const country = idx.countries.find(c => c.id === countryId);
  const ids = (country && country.sectors && country.sectors[sectorId]) || [];
  return ids
    .map(id => ({ id, meta: idx.collections[id] }))
    .filter(x => x.meta && x.meta.status === 'available');
}

// Reactief overzicht voor de Download-knop: wat is er online voor het
// gekozen land+sector, wat staat er al lokaal, en wat valt er te halen?
// `tagOnly` = collecties die al gedownload zijn (voor een ander land) maar
// nog niet aan dit land/deze sector gekoppeld — dat kost geen netwerk.
export function downloadInfoFor(countryId, sectorId) {
  const all = availableCollectionsFor(countryId, sectorId);
  const groups = getCustomGroups();
  const have = new Set(groups.filter(g => g.collectionId).map(g => g.collectionId));
  const haveTagged = new Set(
    groups
      .filter(g => g.collectionId
        && (Array.isArray(g.industry) ? g.industry.includes(sectorId) : g.industry === sectorId)
        && (Array.isArray(g.country) ? g.country.includes(countryId) : g.country === countryId))
      .map(g => g.collectionId)
  );
  const toFetch = all.filter(x => !have.has(x.id));
  const tagOnly = all.filter(x => have.has(x.id) && !haveTagged.has(x.id));
  const symbolCount = toFetch.reduce((n, x) => n + (x.meta.symbolCount || 0), 0);
  return { total: all.length, toFetch, tagOnly, symbolCount };
}

// --- Eén collectie downloaden → palette-groep ---
async function downloadCollection(collectionId, indexMeta, lang) {
  // collection.json is leidend; de index-metadata is de fallback.
  let meta = indexMeta;
  try {
    meta = await fetchJson(collectionJsonUrl(collectionId));
  } catch (e) {
    console.warn(`collection.json van ${collectionId} niet bereikbaar, index-metadata gebruikt`, e);
  }
  const types = (meta && meta.types) || (indexMeta && indexMeta.types) || [];

  // Parametrische catalogus (bv. staalprofielen): NIET als platte SVG-groep,
  // maar als geregistreerde catalogus — de families worden parametrische
  // templates (identiek aan de NL staalprofielen: doorsnede/boven/zij,
  // real-size via de meetschaal, maat-keuze in het eigenschappen-paneel).
  // De catalogus persist in preferences (steelSectionCatalogs) zodat de
  // templates na herstart terugkomen; de palette-groep persist via het
  // custom-groups-mechanisme. De platte SVG's van zo'n collectie worden
  // bewust overgeslagen (anders staat elk profiel er dubbel in).
  if (types.includes('parametric')) {
    try {
      const raw = await fetchJson(parametricJsonUrl(collectionId));
      const catalog = parseSteelSectionCatalog(raw);
      if (catalog) {
        registerSteelCatalog(collectionId, catalog);
        return steelCatalogToGroup(collectionId, meta, catalog, lang);
      }
    } catch (e) {
      // Onbekend/kapot parametrisch formaat → val terug op de SVG-symbolen.
      console.warn(`parametric.json van ${collectionId} niet bruikbaar, SVG-fallback gebruikt`, e);
    }
  }

  const contents = { svgFiles: [], stamps: [] };

  if (types.includes('symbols')) {
    // De index kent geen bestandsnamen; de listing komt uit de GitHub
    // contents-API, de bestanden zelf via raw-URLs.
    const listing = await fetchJson(symbolsListApiUrl(collectionId));
    const files = (Array.isArray(listing) ? listing : [])
      .filter(f => f && f.type === 'file' && /\.svg$/i.test(f.name));
    for (let i = 0; i < files.length; i += PARALLEL_FETCHES) {
      const batch = files.slice(i, i + PARALLEL_FETCHES);
      const svgs = await Promise.all(
        batch.map(f => fetchText(f.download_url || symbolRawUrl(collectionId, f.name)))
      );
      batch.forEach((f, j) => contents.svgFiles.push({ name: f.name, svg: svgs[j] }));
    }
  }
  if (types.includes('stamps')) {
    const st = await fetchJson(stampsJsonUrl(collectionId));
    contents.stamps = (st && st.stamps) || [];
  }
  // Overige typen (hatches/legends) hebben (nog) geen palette-representatie
  // en worden bewust overgeslagen.

  return collectionToGroup(collectionId, meta, contents, lang);
}

// --- Alles voor land+sector downloaden ---
export async function downloadCountrySector(countryId, sectorId) {
  if (downloadBusy()) return;
  const info = downloadInfoFor(countryId, sectorId);
  setDownloadError('');
  setDownloadBusy(true);
  const lang = language();
  try {
    // Al aanwezige collecties alleen bij-taggen voor dit land/sector.
    for (const { id } of info.tagOnly) {
      addGroupLocaleTag(`lib-${id}`, sectorId, countryId);
    }
    let done = 0;
    for (const { id, meta } of info.toFetch) {
      setDownloadProgress({
        done,
        total: info.toFetch.length,
        label: pickLocalized(meta.name, lang) || id,
      });
      const group = await downloadCollection(id, meta, lang);
      group.industry = [sectorId];
      group.country = [countryId];
      // Per collectie persist — een afgebroken download houdt wat al binnen is.
      upsertCustomGroup(group);
      done++;
    }
    setDownloadProgress(null);
  } catch (e) {
    console.error('Download symboolbibliotheek mislukt:', e);
    setDownloadProgress(null);
    setDownloadError(String((e && e.message) || e));
  } finally {
    setDownloadBusy(false);
  }
}

export { indexStatus, downloadBusy, downloadProgress, downloadError };
