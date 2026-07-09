// Font selection for text edits (and other drawn text like watermarks).
//
// pdf-lib's 14 standard fonts are WinAnsi-encoded: any character outside
// Latin-1 (checkboxes, arrows, CJK, curly quotes from some sources, ...)
// throws `WinAnsi cannot encode` and aborts the whole save. For text that
// isn't plain ASCII we embed a subset of a bundled Unicode font (DejaVu,
// free licence, wide coverage) via fontkit instead. ASCII-only runs keep
// using the standard fonts so typical documents don't grow.

import { StandardFonts } from 'pdf-lib';

// Resolved through import.meta.url rather than Vite's `?url` suffix so the
// module also loads under plain Node (the saver unit tests import it).
const dejavuSansUrl = new URL('../../assets/fonts/DejaVuSans.ttf', import.meta.url).href;
const dejavuSansBoldUrl = new URL('../../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url).href;
const dejavuSansObliqueUrl = new URL('../../assets/fonts/DejaVuSans-Oblique.ttf', import.meta.url).href;
const dejavuSerifUrl = new URL('../../assets/fonts/DejaVuSerif.ttf', import.meta.url).href;
const dejavuMonoUrl = new URL('../../assets/fonts/DejaVuSansMono.ttf', import.meta.url).href;

const STANDARD_MAP = {
  'Courier': StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
  'Courier-Oblique': StandardFonts.CourierOblique,
  'Courier-BoldOblique': StandardFonts.CourierBoldOblique,
  'TimesRoman': StandardFonts.TimesRoman,
  'TimesRoman-Bold': StandardFonts.TimesRomanBold,
  'TimesRoman-Italic': StandardFonts.TimesRomanItalic,
  'TimesRoman-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  'Helvetica': StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Helvetica-Oblique': StandardFonts.HelveticaOblique,
  'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
};

// Closest DejaVu face for a standard-font family name.
function unicodeUrlFor(fontFamily = '') {
  const f = fontFamily.toLowerCase();
  if (f.startsWith('courier')) return dejavuMonoUrl;
  if (f.startsWith('times')) return dejavuSerifUrl;
  if (f.includes('bold')) return dejavuSansBoldUrl;
  if (f.includes('oblique') || f.includes('italic')) return dejavuSansObliqueUrl;
  return dejavuSansUrl;
}

// WinAnsi covers printable Latin-1 (plus a few extras we don't rely on).
// Treat anything outside ASCII/Latin-1 as needing the embedded font.
export function isWinAnsiSafe(text) {
  return /^[\x00-\xFF]*$/.test(text);
}

const ttfCache = new Map(); // url -> Promise<ArrayBuffer>
function fetchTtf(url) {
  if (!ttfCache.has(url)) {
    ttfCache.set(url, fetch(url).then((r) => r.arrayBuffer()));
  }
  return ttfCache.get(url);
}

// Per-document font provider. getFont(fontFamily, text) returns a pdf-lib
// font able to encode `text`: a standard font for WinAnsi-safe runs, an
// embedded DejaVu subset otherwise.
export function createEditFontProvider(pdfDocLib) {
  const stdCache = new Map();
  const embeddedCache = new Map();
  let fontkitRegistered = false;

  async function embedUnicode(fontFamily) {
    const url = unicodeUrlFor(fontFamily);
    if (!embeddedCache.has(url)) {
      if (!fontkitRegistered) {
        // Loaded on demand: fontkit is ~0.7 MB and only needed for saves
        // containing non-WinAnsi text — keep it out of the startup bundle.
        const { default: fontkit } = await import('@pdf-lib/fontkit');
        pdfDocLib.registerFontkit(fontkit);
        fontkitRegistered = true;
      }
      embeddedCache.set(url, fetchTtf(url).then((bytes) =>
        pdfDocLib.embedFont(bytes, { subset: true })));
    }
    return embeddedCache.get(url);
  }

  async function embedStandard(fontFamily) {
    if (!stdCache.has(fontFamily)) {
      const std = STANDARD_MAP[fontFamily] || StandardFonts.Helvetica;
      stdCache.set(fontFamily, pdfDocLib.embedFont(std));
    }
    return stdCache.get(fontFamily);
  }

  return {
    async getFont(fontFamily, text) {
      if (isWinAnsiSafe(text)) return embedStandard(fontFamily);
      return embedUnicode(fontFamily);
    },
    // Last-resort text sanitiser: replace anything the chosen font still
    // can't encode so one glyph can never abort a save.
    sanitise(font, text) {
      let out = '';
      for (const ch of text) {
        try {
          font.encodeText(ch);
          out += ch;
        } catch (_) {
          out += '?';
        }
      }
      return out;
    },
  };
}
