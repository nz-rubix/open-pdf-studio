// LRU cache for whole-page ImageBitmaps used by the unified render loop.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}`
// Values: { bitmap: ImageBitmap, w, h, zoomBucket }

const CACHE = new Map();
const MAX = 16;

function makeKey(filePath, pageNum, zoomBucket, rotation) {
  return `${filePath}|p${pageNum}|z${Math.round(zoomBucket * 10000)}|r${rotation || 0}`;
}

export function bitmapCacheGet(filePath, pageNum, zoomBucket, rotation) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation);
  const entry = CACHE.get(key);
  if (entry) {
    // LRU touch
    CACHE.delete(key);
    CACHE.set(key, entry);
  }
  return entry || null;
}

export async function bitmapCacheSet(filePath, pageNum, zoomBucket, rotation, imageData) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation);
  while (CACHE.size >= MAX) {
    const firstKey = CACHE.keys().next().value;
    if (!firstKey) break;
    const old = CACHE.get(firstKey);
    try { old?.bitmap?.close?.(); } catch {}
    CACHE.delete(firstKey);
  }
  try {
    const bitmap = await createImageBitmap(imageData);
    CACHE.set(key, { bitmap, w: imageData.width, h: imageData.height, zoomBucket });
  } catch (e) {
    console.warn('[bitmap-cache] createImageBitmap failed:', e);
  }
}

export function bitmapCacheClearForFile(filePath) {
  for (const k of Array.from(CACHE.keys())) {
    if (k.startsWith(filePath + '|')) {
      const e = CACHE.get(k);
      try { e?.bitmap?.close?.(); } catch {}
      CACHE.delete(k);
    }
  }
}

export function bitmapCacheClearAll() {
  for (const e of CACHE.values()) {
    try { e?.bitmap?.close?.(); } catch {}
  }
  CACHE.clear();
}
