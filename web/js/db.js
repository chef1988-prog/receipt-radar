// Persistence: Android bridge (app-private files) when running in the APK, IndexedDB in a normal browser.
/* global AndroidBridge */
const bridge = typeof window !== 'undefined' && window.AndroidBridge ? window.AndroidBridge : null;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('receiptradar', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result ?? null); t.onerror = () => rej(t.error); }); }
async function idbSet(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => rej(t.error); }); }
async function idbDel(k) { const d = await idb(); return new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); }

export async function read(name) {
  if (bridge) { const v = bridge.readFile(name); return v === null || v === undefined || v === '' ? null : v; }
  return idbGet(name);
}
export async function write(name, content) {
  if (bridge) { if (!bridge.writeFile(name, content)) throw new Error('Could not save ' + name); return true; }
  return idbSet(name, content);
}
export async function remove(name) {
  if (bridge) return bridge.deleteFile(name);
  return idbDel(name);
}

export const emptyState = () => ({ version: 1, receipts: [], products: {}, settings: { langs: 'deu+ita', enhance: 'auto', locale: 'de-DE' } });

export async function loadState() {
  const raw = await read('state.json');
  if (!raw) return emptyState();
  try {
    const s = JSON.parse(raw);
    const e = emptyState();
    return { ...e, ...s, settings: { ...e.settings, ...(s.settings || {}) } };
  } catch (e) {
    console.error('state corrupt', e);
    const bak = await read('state.backup.json');
    return bak ? JSON.parse(bak) : emptyState();
  }
}

let saveTimer = null, pending = null;
export function saveState(state, immediate = false) {
  pending = state;
  clearTimeout(saveTimer);
  const doSave = async () => {
    const json = JSON.stringify(pending);
    await write('state.json', json);
    if (!saveState._bakAt || Date.now() - saveState._bakAt > 6 * 3600e3) { await write('state.backup.json', json); saveState._bakAt = Date.now(); }
  };
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 250);
  return Promise.resolve();
}

export const saveImage = (id, dataUrl) => write(`img_${id}.txt`, dataUrl);
export const loadImage = (id) => read(`img_${id}.txt`);
export const deleteImage = (id) => remove(`img_${id}.txt`);

// Save a file for the user (Android: system "save as" dialog; browser: download)
export function exportFile(filename, mime, content) {
  if (bridge) { bridge.exportFile(filename, mime, content); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
export const isApp = !!bridge;
