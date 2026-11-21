// OCR: Google ML Kit (native, inside the Android app) or tesseract.js (desktop browser testing only).
/* global Tesseract */

export const hasNative = () => !!(window.AndroidBridge && window.AndroidBridge.hasNativeOcr && window.AndroidBridge.hasNativeOcr());
export const engineName = () => hasNative() ? 'Google ML Kit (on-device)' : 'Tesseract';

const pendingNative = new Map();
window.__nativeOcrDone = (id, res, err) => {
  const p = pendingNative.get(id); if (!p) return;
  pendingNative.delete(id);
  if (err || !res) p.reject(new Error(err || 'OCR failed')); else p.resolve(res);
};

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = base() + 'vendor/tesseract.min.js';
    s.onload = res; s.onerror = () => rej(new Error('OCR engine missing')); document.head.appendChild(s);
  });
}

let worker = null, workerLangs = null, progressCb = null, creating = null;

function base() { return new URL('.', location.href).href; }

async function getWorker(langs) {
  if (worker && workerLangs === langs) return worker;
  if (creating) { await creating.catch(() => {}); if (worker && workerLangs === langs) return worker; }
  if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
  creating = (async () => {
    await loadTesseract();
    const w = await Tesseract.createWorker(langs.split('+'), 1, {
      workerPath: base() + 'vendor/worker.min.js',
      corePath: base() + 'vendor/core',
      langPath: base() + 'tessdata',
      cacheMethod: 'none',
      gzip: false,
      logger: (m) => { if (progressCb) progressCb(m); },
    });
    await w.setParameters({
      tessedit_pageseg_mode: '4',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    worker = w; workerLangs = langs;
    return w;
  })();
  try { return await creating; } finally { creating = null; }
}

export async function warmUp(langs) { if (hasNative()) return; try { await getWorker(langs); } catch (e) { console.warn('OCR warm-up failed', e); } }

// Rebuild text lines from word boxes so that a far-right price column stays on the same line as its item.
function linesFromWords(data) {
  const words = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    if (!w.text || !w.text.trim()) continue;
    words.push({ t: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, c: w.confidence });
  }
  return groupWords(words);
}

export function groupWords(words) {
  if (!words.length) return null;
  const hs = words.map(w => w.y1 - w.y0).sort((a, b) => a - b);
  const mh = hs[Math.floor(hs.length / 2)] || 20;
  words.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines = [];
  for (const w of words) {
    const cy = (w.y0 + w.y1) / 2;
    let best = null, bd = 1e9;
    for (let i = Math.max(0, lines.length - 4); i < lines.length; i++) {
      const L = lines[i]; const d = Math.abs(L.cy - cy);
      if (d < mh * 0.55 && d < bd && !L.words.some(o => o.x0 < w.x1 && w.x0 < o.x1)) { best = L; bd = d; }
    }
    if (best) { best.words.push(w); best.cy = (best.cy * (best.words.length - 1) + cy) / best.words.length; }
    else lines.push({ cy, words: [w] });
  }
  lines.sort((a, b) => a.cy - b.cy);
  const cw = mh * 0.55;
  return lines.map(L => {
    L.words.sort((a, b) => a.x0 - b.x0);
    let s = '', prev = null;
    for (const w of L.words) {
      if (prev) { const gap = w.x0 - prev.x1; s += gap > cw * 3 ? '     ' : ' '; }
      s += w.t; prev = w;
    }
    return s;
  }).join('\n');
}

async function recognizeNative(canvas, onProgress) {
  if (onProgress) onProgress({ status: 'recognizing text', progress: 0.3 });
  const id = Math.random().toString(36).slice(2);
  const res = await new Promise((resolve, reject) => {
    pendingNative.set(id, { resolve, reject });
    window.AndroidBridge.ocr(id, canvas.toDataURL('image/jpeg', 0.95));
  });
  if (onProgress) onProgress({ status: 'recognizing text', progress: 1 });
  const words = [];
  let csum = 0, cn = 0;
  for (const l of res.lines || []) {
    if (l.c > 0) { csum += l.c * (l.t || '').length; cn += (l.t || '').length; }
    const ws = (l.w && l.w.length) ? l.w : [{ t: l.t, b: l.b, c: l.c }];
    for (const w of ws) if (w.t && w.t.trim()) words.push({ t: w.t, x0: w.b[0], y0: w.b[1], x1: w.b[2], y1: w.b[3], c: w.c });
  }
  const text = groupWords(words) || res.text || '';
  return { text, rawText: res.text || '', confidence: cn ? (csum / cn) * 100 : null };
}

export async function recognize(canvas, langs, onProgress) {
  if (hasNative()) return recognizeNative(canvas, onProgress);
  progressCb = onProgress;
  const w = await getWorker(langs);
  const res = await w.recognize(canvas, {}, { text: true, blocks: true });
  progressCb = null;
  const rebuilt = linesFromWords(res.data);
  return { text: rebuilt || res.data.text, rawText: res.data.text, confidence: res.data.confidence };
}
