import { groupWords, groupSegments } from './layout.js';
export { groupWords };
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

async function recognizeNative(canvas, onProgress) {
  if (onProgress) onProgress({ status: 'recognizing text', progress: 0.3 });
  const id = Math.random().toString(36).slice(2);
  const res = await new Promise((resolve, reject) => {
    pendingNative.set(id, { resolve, reject });
    window.AndroidBridge.ocr(id, canvas.toDataURL('image/jpeg', 0.95));
  });
  if (onProgress) onProgress({ status: 'recognizing text', progress: 1 });
  let csum = 0, cn = 0;
  for (const l of res.lines || []) if (l.c > 0) { csum += l.c * (l.t || '').length; cn += (l.t || '').length; }
  const text = groupSegments(res.lines || []) || res.text || '';
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
