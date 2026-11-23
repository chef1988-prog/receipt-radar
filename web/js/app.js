import { parseReceipt, toNumber, CHAINS } from './parser.js';
import * as IP from './imageproc.js';
import * as OCR from './ocr.js';
import * as DB from './db.js';
import * as C from './catalog.js';

const VERSION = '1.2.0';
let state = DB.emptyState();
let tab = 'home';
const pages = [];          // overlay page stack: {render, mount?, onBack?}
let scan = null;           // current scan session

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locale = () => state.settings.locale || 'de-DE';
const eur = (v) => (v == null || isNaN(v)) ? '–' : new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(v);
const num = (v, d = 2) => (v == null || isNaN(v)) ? '' : new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const qtyFmt = (q, unit) => unit === 'kg' ? `${num(q, 3)} kg` : (q === 1 ? '' : `${num(q, Number.isInteger(+q) ? 0 : 2)}×`);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) => d ? new Date(d + 'T12:00:00').toLocaleDateString(locale(), opts) : '–';
const perUnit = (unit) => unit === 'kg' ? '/kg' : '';
const catOf = (id) => C.CAT[id] || C.CAT.other;
const STORE_COLORS = ['#0f766e', '#c2410c', '#4338ca', '#a16207', '#be185d', '#15803d', '#6d28d9', '#0369a1', '#b91c1c', '#4d7c0f'];
function storeColor(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return STORE_COLORS[h % STORE_COLORS.length]; }
const r2 = (v) => Math.round(v * 100) / 100;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function modal(html, { onMount } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-bg"></div><div class="modal-card">${html}</div>`;
  m.classList.add('open');
  const close = () => { m.classList.remove('open'); m.innerHTML = ''; modal.close = null; };
  modal.close = close;
  $('.modal-bg', m).onclick = close;
  if (onMount) onMount(m, close);
  return close;
}
function confirmDlg(text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    modal(`<p class="modal-text">${text}</p><div class="row end gap"><button class="btn ghost" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button></div>`, {
      onMount: (m, close) => {
        $('[data-a=no]', m).onclick = () => { close(); res(false); };
        $('[data-a=yes]', m).onclick = () => { close(); res(true); };
      },
    });
  });
}
function promptDlg(title, value = '') {
  return new Promise(res => {
    modal(`<h3>${esc(title)}</h3><input class="input" id="pd-in" value="${esc(value)}"><div class="row end gap mt"><button class="btn ghost" data-a="no">Cancel</button><button class="btn primary" data-a="yes">Save</button></div>`, {
      onMount: (m, close) => {
        const i = $('#pd-in', m); setTimeout(() => i.focus(), 50);
        $('[data-a=no]', m).onclick = () => { close(); res(null); };
        $('[data-a=yes]', m).onclick = () => { close(); res(i.value.trim()); };
      },
    });
  });
}

function persist() { return DB.saveState(state); }

// ---------- navigation ----------
function setTab(t) {
  tab = t;
  $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  renderMain();
  $('#main').scrollTop = 0;
}
function renderMain() {
  const main = $('#main');
  $('#title').textContent = { home: 'Receipt Radar', receipts: 'Receipts', prices: 'Prices', spending: 'Spending' }[tab];
  main.innerHTML = ({ home: viewHome, receipts: viewReceipts, prices: viewPrices, spending: viewSpending })[tab]();
  ({ home: bindHome, receipts: bindReceipts, prices: bindPrices, spending: bindSpending })[tab](main);
}
function pushPage(page) {
  pages.push(page);
  renderTop();
}
function popPage() {
  const p = pages.pop();
  if (p && p.onClose) p.onClose();
  renderTop();
  if (!pages.length) renderMain();
}
function renderTop() {
  const ov = $('#overlay');
  if (!pages.length) { ov.classList.remove('open'); ov.innerHTML = ''; return; }
  const p = pages[pages.length - 1];
  ov.classList.add('open');
  ov.innerHTML = `<div class="page">
    <header class="page-head"><button class="icon-btn" data-back aria-label="Back"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg></button><h2>${esc(p.title || '')}</h2><div class="head-actions">${p.actions || ''}</div></header>
    <div class="page-body">${p.render()}</div></div>`;
  $('[data-back]', ov).onclick = () => back();
  if (p.mount) p.mount(ov);
}
function refreshTop() { if (pages.length) { const sc = $('.page-body', $('#overlay'))?.scrollTop || 0; renderTop(); const b = $('.page-body', $('#overlay')); if (b) b.scrollTop = sc; } }

function back() {
  if (modal.close) { modal.close(); return true; }
  if (pages.length) {
    const p = pages[pages.length - 1];
    if (p.onBack) { p.onBack(); return true; }
    popPage(); return true;
  }
  if (tab !== 'home') { setTab('home'); return true; }
  return false;
}
window.appBack = back;

// ---------- charts ----------
function barChart(data, { h = 140, color = '#0f766e', fmt = eur } = {}) {
  const W = 340, pad = 18, max = Math.max(1, ...data.map(d => d.value));
  const bw = (W - pad) / data.length;
  const bars = data.map((d, i) => {
    const bh = (d.value / max) * (h - 34);
    const x = pad / 2 + i * bw + bw * 0.15, y = h - 18 - bh;
    return `<g><rect x="${x}" y="${y}" width="${bw * 0.7}" height="${Math.max(bh, d.value > 0 ? 2 : 0)}" rx="3" fill="${d.highlight ? color : color + '99'}"/>
      <text x="${x + bw * 0.35}" y="${h - 4}" text-anchor="middle" class="ax">${esc(d.label)}</text>
      ${d.highlight || data.length <= 6 ? `<text x="${x + bw * 0.35}" y="${y - 4}" text-anchor="middle" class="vl">${d.value ? esc(fmt(d.value).replace(/\s?€/, '')) : ''}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}
function lineChart(series, { h = 170 } = {}) {
  const W = 340, L = 38, R = 10, T = 10, B = 22;
  const pts = series.flatMap(s => s.points);
  if (!pts.length) return '';
  let x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
  if (x1 - x0 < 86400e3) { x0 -= 3 * 86400e3; x1 += 3 * 86400e3; }
  let y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const span = Math.max(y1 - y0, y1 * 0.1, 0.1); y0 = Math.max(0, y0 - span * 0.25); y1 = y1 + span * 0.25;
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (h - T - B);
  const grid = [0, 0.5, 1].map(f => { const v = y0 + (y1 - y0) * f; return `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" class="ax">${num(v)}</text>`; }).join('');
  const lines = series.map(s => {
    const P = s.points.slice().sort((a, b) => a.x - b.x);
    const d = P.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>` + P.map(p => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.2" fill="${s.color}"/>`).join('');
  }).join('');
  const lab = [x0, x1].map((x, i) => `<text x="${i ? W - R : L}" y="${h - 6}" text-anchor="${i ? 'end' : 'start'}" class="ax">${new Date(x).toLocaleDateString(locale(), { day: '2-digit', month: 'short' })}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}">${grid}${lines}${lab}</svg>`;
}
function hbars(entries, { fmtLabel = (k) => k, color = () => '#0f766e', onclick = null, total = null } = {}) {
  const max = Math.max(1e-9, ...entries.map(e => e[1]));
  const tot = total ?? entries.reduce((a, e) => a + e[1], 0);
  return `<div class="hbars">${entries.map(([k, v]) => `<div class="hbar ${onclick ? 'tap' : ''}" ${onclick ? `data-${onclick}="${esc(k)}"` : ''}>
    <div class="hbar-top"><span>${fmtLabel(k)}</span><span class="mono">${eur(v)} <small>${tot ? Math.round(v / tot * 100) : 0}%</small></span></div>
    <div class="hbar-track"><div style="width:${(v / max * 100).toFixed(1)}%;background:${color(k)}"></div></div></div>`).join('')}</div>`;
}

// ---------- HOME ----------
function monthRange(offset = 0) {
  const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() + offset, 1), b = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const f = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return [f(a), f(b)];
}
function viewHome() {
  const [a, b] = monthRange(0), [pa, pb] = monthRange(-1);
  const cur = C.spending(state, a, b), prev = C.spending(state, pa, pb);
  const ov = C.productOverview(state);
  const sav = C.savings(ov).slice(0, 4);
  const recent = [...state.receipts].sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.createdAt - x.createdAt).slice(0, 5);
  const delta = prev.total ? (cur.total - prev.total) / prev.total : null;
  return `
  <section class="hero card">
    <div class="muted small">${new Date().toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</div>
    <div class="big mono">${eur(cur.total)}</div>
    <div class="muted small">${cur.receipts} receipt${cur.receipts === 1 ? '' : 's'}${delta != null ? ` · <span class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta * 100))}% vs last month</span>` : ''}</div>
    <div class="scan-row">
      <button class="btn primary grow" data-scan="camera"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg> Scan receipt</button>
      <button class="btn ghost" data-scan="gallery" aria-label="From gallery"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4"/></svg></button>
      <button class="btn ghost" data-scan="manual" aria-label="Enter manually"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>
    </div>
  </section>
  ${state.receipts.length === 0 ? `<section class="card empty">
    <h3>How it works</h3>
    <ol class="steps"><li><b>Scan</b> a receipt: lay it flat, good light, fill the frame. Long receipts can be shot in parts.</li>
    <li><b>Check</b> the recognised items. The app compares them with the printed total and flags mismatches.</li>
    <li><b>Compare</b>: the same product bought at different stores shows up side by side under <i>Prices</i>. Link items with different receipt names to one product with <i>Merge</i>.</li></ol>
  </section>` : ''}
  ${sav.length ? `<section class="card"><h3>Cheaper elsewhere</h3>${sav.map(s => `<div class="list-row tap" data-product="${s.o.product.id}">
    <div class="grow"><div class="name">${esc(s.o.product.name)}</div><div class="muted small">Last at ${esc(s.o.lastStore)} ${eur(s.lastPrice)}${perUnit(s.o.unit)} → <b>${esc(s.bestStore)} ${eur(s.bestPrice)}${perUnit(s.o.unit)}</b></div></div>
    <div class="pill good">−${Math.round(s.pct * 100)}%</div></div>`).join('')}</section>` : ''}
  ${recent.length ? `<section class="card"><div class="row between"><h3>Recent receipts</h3><button class="link" data-goto="receipts">All</button></div>${recent.map(receiptRow).join('')}</section>` : ''}`;
}
function receiptRow(r) {
  return `<div class="list-row tap" data-receipt="${r.id}"><div class="store-dot" style="background:${storeColor(r.store)}">${esc((r.store || '?').slice(0, 1).toUpperCase())}</div>
  <div class="grow"><div class="name">${esc(r.store || 'Unknown store')}</div><div class="muted small">${fmtDate(r.date)} · ${r.items.length} item${r.items.length === 1 ? '' : 's'}</div></div>
  <div class="mono">${eur(r.total != null && r.total !== '' ? +r.total : r.items.reduce((a, it) => a + C.paid(it), 0))}</div></div>`;
}
function bindCommon(root) {
  $$('[data-scan]', root).forEach(b => b.onclick = () => startScan(b.dataset.scan));
  $$('[data-receipt]', root).forEach(b => b.onclick = () => openReceipt(b.dataset.receipt));
  $$('[data-product]', root).forEach(b => b.onclick = () => openProduct(b.dataset.product));
  $$('[data-goto]', root).forEach(b => b.onclick = () => setTab(b.dataset.goto));
}
const bindHome = bindCommon;

// ---------- RECEIPTS ----------
let receiptQuery = '';
function viewReceipts() {
  const q = receiptQuery.toLowerCase();
  const list = [...state.receipts].filter(r => !q || (r.store || '').toLowerCase().includes(q) || r.items.some(it => (it.name || '').toLowerCase().includes(q) || (state.products[it.productId]?.name || '').toLowerCase().includes(q)))
    .sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.createdAt - x.createdAt);
  const groups = new Map();
  for (const r of list) { const k = (r.date || '').slice(0, 7) || 'unknown'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return `<div class="searchbar"><input class="input" type="search" id="rq" placeholder="Search store or item" value="${esc(receiptQuery)}"></div>
  ${list.length ? [...groups.entries()].map(([k, rs]) => `<section class="card"><div class="row between"><h3>${k === 'unknown' ? 'No date' : new Date(k + '-15').toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</h3><span class="mono muted">${eur(rs.reduce((a, r) => a + (r.total != null && r.total !== '' ? +r.total : r.items.reduce((s, it) => s + C.paid(it), 0)), 0))}</span></div>${rs.map(receiptRow).join('')}</section>`).join('')
    : `<div class="empty-state">${state.receipts.length ? 'No matches.' : 'No receipts yet. Tap the scan button to add your first one.'}</div>`}`;
}
function bindReceipts(root) {
  bindCommon(root);
  const i = $('#rq', root);
  i.oninput = () => { receiptQuery = i.value; const pos = i.selectionStart; renderMain(); const n = $('#rq'); n.focus(); n.setSelectionRange(pos, pos); };
}

// ---------- PRICES ----------
let priceQuery = '', priceFilter = 'all';
function viewPrices() {
  const ov = C.productOverview(state).filter(o => o.count > 0);
  const idx = C.storeIndex(ov);
  const q = priceQuery.toLowerCase();
  let list = ov.filter(o => !q || o.product.name.toLowerCase().includes(q) || o.product.aliases.some(a => a.toLowerCase().includes(q)));
  if (priceFilter === 'multi') list = list.filter(o => o.stores >= 2);
  else if (priceFilter !== 'all') list = list.filter(o => o.product.category === priceFilter);
  list.sort((a, b) => (b.stores >= 2) - (a.stores >= 2) || (b.lastDate || '').localeCompare(a.lastDate || ''));
  const cats = C.CATEGORIES.filter(c => ov.some(o => o.product.category === c.id));
  const dups = !q && priceFilter === 'all' ? C.duplicateSuggestions(state, ov, 4) : [];
  return `<div class="searchbar"><input class="input" type="search" id="pq" placeholder="Search products" value="${esc(priceQuery)}"></div>
  <div class="chips">${[['all', 'All'], ['multi', 'Compared']].concat(cats.map(c => [c.id, c.label])).map(([id, l]) => `<button class="chip ${priceFilter === id ? 'on' : ''}" data-pf="${id}">${esc(l)}</button>`).join('')}</div>
  ${dups.length ? `<section class="card dup"><h3>Same product, different store?</h3><p class="muted small">Link them to compare prices. You can rename the merged product afterwards.</p>
    ${dups.map(d => `<div class="dup-row"><div class="dup-names"><div><span class="store-tag">${esc(d.a.rows.map(r => r.store).join(', '))}</span> ${esc(d.a.product.name)} <span class="mono muted small">${eur(d.a.lastPrice)}${perUnit(d.a.unit)}</span></div>
      <div><span class="store-tag">${esc(d.b.rows.map(r => r.store).join(', '))}</span> ${esc(d.b.product.name)} <span class="mono muted small">${eur(d.b.lastPrice)}${perUnit(d.b.unit)}</span></div></div>
      <div class="dup-btns"><button class="btn sm" data-dupm="${d.a.product.id}|${d.b.product.id}">Same</button><button class="btn ghost sm" data-dupx="${d.key}">No</button></div></div>`).join('')}</section>` : ''}
  ${idx.length >= 2 && !q && priceFilter === 'all' ? `<section class="card"><h3>Store price index</h3><p class="muted small">100 = cheapest. Based on ${new Set(ov.filter(o => o.rows.length >= 2).map(o => o.product.id)).size} products you bought at more than one store.</p>
    ${idx.map((s, i) => `<div class="idx-row"><span class="store-dot sm" style="background:${storeColor(s.store)}">${esc(s.store.slice(0, 1).toUpperCase())}</span><span class="grow">${esc(s.store)} <small class="muted">· cheapest for ${s.cheapest}/${s.n}</small></span><span class="mono ${i === 0 ? 'good-t' : ''}">${s.index}</span></div>`).join('')}</section>` : ''}
  ${list.length ? `<section class="card flush">${list.map(productRow).join('')}</section>` : `<div class="empty-state">${ov.length ? 'No products match.' : 'Products appear here after you save your first receipt.'}</div>`}`;
}
function productRow(o) {
  const c = catOf(o.product.category);
  const range = o.rows.length >= 2 ? `<div class="range"><span class="good-t">${esc(o.best.store)} ${eur(o.best.last)}</span> … <span>${esc(o.worst.store)} ${eur(o.worst.last)}</span></div>` : `<div class="muted small">${esc(o.lastStore)} · ${eur(o.lastPrice)}${perUnit(o.unit)}</div>`;
  return `<div class="list-row tap" data-product="${o.product.id}"><span class="cat-dot" style="background:${c.color}"></span>
  <div class="grow"><div class="name">${esc(o.product.name)}</div>${range}</div>
  <div class="right"><div class="mono">${eur(o.best ? o.best.last : o.lastPrice)}<small>${perUnit(o.unit)}</small></div><div class="muted small">${o.stores} store${o.stores === 1 ? '' : 's'} · ${o.count}×</div></div></div>`;
}
function bindPrices(root) {
  bindCommon(root);
  const i = $('#pq', root);
  i.oninput = () => { priceQuery = i.value; const pos = i.selectionStart; renderMain(); const n = $('#pq'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('[data-pf]', root).forEach(b => b.onclick = () => { priceFilter = b.dataset.pf; renderMain(); });
  $$('[data-dupm]', root).forEach(b => b.onclick = () => {
    const [x, y] = b.dataset.dupm.split('|');
    const nx = C.observations(state, x).length, ny = C.observations(state, y).length;
    const [from, into] = nx > ny ? [y, x] : [x, y];
    C.mergeProducts(state, from, into); persist(); renderMain(); toast(`Linked as “${state.products[into].name}”`);
  });
  $$('[data-dupx]', root).forEach(b => b.onclick = () => { (state.settings.dismissedPairs ||= []).push(b.dataset.dupx); persist(); renderMain(); });
}

function openProduct(id) {
  const page = {
    title: 'Product',
    actions: `<button class="icon-btn" data-pmenu aria-label="More"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg></button>`,
    render() {
      const p = state.products[id];
      if (!p) return '<div class="empty-state">Product deleted.</div>';
      const obs = C.observations(state, id);
      const { unit, rows } = C.storeSummary(obs);
      const spent = obs.reduce((a, o) => a + o.paid, 0);
      const series = rows.map(r => ({ color: storeColor(r.store), points: obs.filter(o => o.store === r.store && o.unit === unit).map(o => ({ x: new Date(o.date + 'T12:00:00').getTime(), y: o.unitPrice })) }));
      const key = C.productKey(p.name);
      const myStems = C.stems(p.name);
      const similar = Object.values(state.products).filter(x => x.id !== id && x.category !== 'deposit').map(x => ({ x, s: Math.max(C.similarity(C.productKey(x.name), key), ...x.aliases.map(a => Math.max(...p.aliases.map(b => C.similarity(a, b)), 0)), [...C.stems(x.name)].some(t => myStems.has(t)) ? 0.6 : 0) }))
        .filter(o => o.s >= 0.45).sort((a, b) => b.s - a.s).slice(0, 5);
      return `
      <section class="card">
        <div class="row between top"><div><h2 class="pname">${esc(p.name)}</h2>
        <button class="chip on cat" data-cat style="--c:${catOf(p.category).color}">${esc(catOf(p.category).label)} ▾</button></div>
        <button class="btn ghost sm" data-rename>Rename</button></div>
        <div class="stats3"><div><div class="muted small">Spent</div><div class="mono">${eur(spent)}</div></div><div><div class="muted small">Bought</div><div class="mono">${obs.length}×</div></div><div><div class="muted small">Price per</div><div class="mono">${unit === 'kg' ? 'kg' : 'item'}</div></div></div>
      </section>
      ${rows.length ? `<section class="card"><h3>By store</h3>
        <table class="tbl"><thead><tr><th>Store</th><th>Last</th><th>Min</th><th>Avg</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr class="${i === 0 && rows.length > 1 ? 'best' : ''}"><td><span class="store-dot xs" style="background:${storeColor(r.store)}"></span>${esc(r.store)}<div class="muted tiny">${fmtDate(r.lastDate, { day: '2-digit', month: 'short' })} · ${r.count}×</div></td><td class="mono">${eur(r.last)}</td><td class="mono">${eur(r.min)}</td><td class="mono">${eur(r.avg)}</td></tr>`).join('')}
        </tbody></table>
        ${rows.length > 1 ? `<p class="small good-t">${esc(rows[0].store)} is ${Math.round((1 - rows[0].last / rows[rows.length - 1].last) * 100)}% cheaper than ${esc(rows[rows.length - 1].store)}.</p>` : `<p class="muted small">Bought at one store so far. If you bought this elsewhere under a different name, merge it below.</p>`}
      </section>
      ${obs.length > 1 ? `<section class="card"><h3>Price history${unit === 'kg' ? ' (€/kg)' : ''}</h3>${lineChart(series)}<div class="legend">${rows.map(r => `<span><i style="background:${storeColor(r.store)}"></i>${esc(r.store)}</span>`).join('')}</div></section>` : ''}` : ''}
      ${similar.length ? `<section class="card"><h3>Same product?</h3><p class="muted small">Merge items that are the same thing under a different receipt name (e.g. at another store).</p>
        ${similar.map(o => `<div class="list-row"><div class="grow"><div class="name">${esc(o.x.name)}</div><div class="muted small">${C.observations(state, o.x.id).map(b => b.store).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'no purchases'}</div></div><button class="btn sm" data-merge="${o.x.id}">Merge</button></div>`).join('')}</section>` : ''}
      <section class="card"><h3>Purchases</h3>${obs.slice().reverse().map(o => `<div class="list-row tap" data-receipt="${o.receiptId}"><div class="grow"><div class="name small">${esc(o.store)} <span class="muted">· ${fmtDate(o.date)}</span></div><div class="muted tiny">${esc(o.name)}</div></div>
        <div class="right"><div class="mono">${eur(o.paid)}</div><div class="muted tiny">${o.unit === 'kg' ? `${num(o.qty, 3)} kg · ${eur(o.unitPrice)}/kg` : (o.qty !== 1 ? `${num(o.qty, 0)} × ${eur(o.unitPrice)}` : '')}</div></div></div>`).join('') || '<p class="muted">None</p>'}</section>
      ${p.aliases.length ? `<p class="muted tiny pad">Receipt names: ${p.aliases.map(esc).join(' · ')}</p>` : ''}`;
    },
    mount(ov) {
      bindCommon(ov);
      const p = state.products[id]; if (!p) return;
      $('[data-rename]', ov).onclick = async () => { const n = await promptDlg('Product name', p.name); if (n) { p.name = n; persist(); refreshTop(); } };
      $('[data-cat]', ov).onclick = () => pickCategory(p.category, (c) => { p.category = c; persist(); refreshTop(); });
      $$('[data-merge]', ov).forEach(b => b.onclick = async () => {
        const other = state.products[b.dataset.merge];
        if (await confirmDlg(`Merge <b>${esc(other.name)}</b> into <b>${esc(p.name)}</b>? All its purchases and receipt names move here.`, 'Merge')) {
          C.mergeProducts(state, other.id, id); persist(); refreshTop(); toast('Merged');
        }
      });
      $('[data-pmenu]', ov).onclick = () => {
        modal(`<h3>${esc(p.name)}</h3><div class="menu">
          <button data-m="into">Merge into another product…</button>
          <button data-m="del" class="danger-t">Delete product</button></div>`, {
          onMount: (m, close) => {
            $('[data-m=into]', m).onclick = () => { close(); pickProduct(p.name, async (target) => {
              if (!target || target === id) return;
              if (await confirmDlg(`Merge <b>${esc(p.name)}</b> into <b>${esc(state.products[target].name)}</b>?`, 'Merge')) { C.mergeProducts(state, id, target); persist(); popPage(); openProduct(target); toast('Merged'); }
            }, { allowNew: false, exclude: id }); };
            $('[data-m=del]', m).onclick = async () => {
              close();
              const n = C.observations(state, id).length;
              if (await confirmDlg(`Delete <b>${esc(p.name)}</b>?${n ? ` Its ${n} purchase${n === 1 ? '' : 's'} stay on the receipts but won't be linked to a product.` : ''}`, 'Delete', true)) {
                for (const r of state.receipts) for (const it of r.items) if (it.productId === id) it.productId = null;
                delete state.products[id]; persist(); popPage();
              }
            };
          },
        });
      };
    },
  };
  pushPage(page);
}

function pickCategory(cur, cb) {
  modal(`<h3>Category</h3><div class="menu">${C.CATEGORIES.map(c => `<button data-c="${c.id}" class="${c.id === cur ? 'sel' : ''}"><span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</button>`).join('')}</div>`, {
    onMount: (m, close) => $$('[data-c]', m).forEach(b => b.onclick = () => { close(); cb(b.dataset.c); }),
  });
}

function pickProduct(seedName, cb, { allowNew = true, exclude = null } = {}) {
  let q = '';
  const key = C.productKey(seedName);
  const page = {
    title: 'Choose product',
    render() {
      const all = Object.values(state.products).filter(p => p.id !== exclude);
      const ql = q.toLowerCase();
      const list = all.map(p => ({ p, s: ql ? (p.name.toLowerCase().includes(ql) || p.aliases.some(a => a.toLowerCase().includes(ql)) ? 1 : 0) : Math.max(C.similarity(C.productKey(p.name), key), ...p.aliases.map(a => C.similarity(a, key)), 0) }))
        .filter(o => !ql || o.s > 0).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, 60);
      return `<div class="searchbar"><input class="input" id="ppq" type="search" placeholder="Search products" value="${esc(q)}"></div>
      ${allowNew ? `<div class="card flush"><div class="list-row tap" data-new><span class="cat-dot" style="background:#0f766e"></span><div class="grow"><div class="name">+ New product</div><div class="muted small">“${esc(C.prettyName(seedName))}”</div></div></div></div>` : ''}
      <div class="card flush">${list.map(o => `<div class="list-row tap" data-pick="${o.p.id}"><span class="cat-dot" style="background:${catOf(o.p.category).color}"></span><div class="grow"><div class="name">${esc(o.p.name)}</div><div class="muted tiny">${esc(o.p.aliases.slice(0, 3).join(' · '))}</div></div></div>`).join('') || '<p class="muted pad">No products yet.</p>'}</div>`;
    },
    mount(ov) {
      const i = $('#ppq', ov);
      i.oninput = () => { q = i.value; const pos = i.selectionStart; refreshTop(); const n = $('#ppq'); n.focus(); n.setSelectionRange(pos, pos); };
      $$('[data-pick]', ov).forEach(b => b.onclick = () => { popPage(); cb(b.dataset.pick); });
      const nb = $('[data-new]', ov); if (nb) nb.onclick = () => { popPage(); cb(null); };
    },
  };
  pushPage(page);
}

// ---------- SPENDING ----------
let period = 'month';
function periodRange(p) {
  const d = new Date(); const f = x => x.toISOString().slice(0, 10);
  if (p === 'month') return monthRange(0);
  if (p === 'last') return monthRange(-1);
  if (p === '3m') return [monthRange(-2)[0], monthRange(0)[1]];
  if (p === 'year') return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
  return [null, null];
}
function viewSpending() {
  const [a, b] = periodRange(period);
  const s = C.spending(state, a, b);
  const mon = C.monthly(state, 12);
  const curKey = new Date().toISOString().slice(0, 7);
  return `<div class="chips">${[['month', 'This month'], ['last', 'Last month'], ['3m', '3 months'], ['year', 'This year'], ['all', 'All time']].map(([id, l]) => `<button class="chip ${period === id ? 'on' : ''}" data-per="${id}">${l}</button>`).join('')}</div>
  <section class="card hero"><div class="muted small">Spent</div><div class="big mono">${eur(s.total)}</div><div class="muted small">${s.receipts} receipt${s.receipts === 1 ? '' : 's'}${s.receipts ? ` · avg ${eur(s.total / s.receipts)}` : ''}</div></section>
  <section class="card"><h3>Last 12 months</h3>${barChart(mon.map(m => ({ label: m.label.slice(0, 3), value: m.total, highlight: m.key === curKey })))}</section>
  ${s.byCat.length ? `<section class="card"><h3>By category</h3>${hbars(s.byCat, { fmtLabel: k => `<span class="cat-dot" style="background:${catOf(k).color}"></span>${esc(catOf(k).label)}`, color: k => catOf(k).color, onclick: 'catsel' })}</section>` : ''}
  ${s.byStore.length ? `<section class="card"><h3>By store</h3>${hbars(s.byStore, { fmtLabel: k => esc(k), color: k => storeColor(k) })}</section>` : ''}
  ${s.byProduct.length ? `<section class="card"><h3>Top products</h3>${s.byProduct.slice(0, 12).map(([pid, v]) => `<div class="list-row tap" data-product="${pid}"><span class="cat-dot" style="background:${catOf(state.products[pid]?.category).color}"></span><div class="grow name">${esc(state.products[pid]?.name || '?')}</div><div class="mono">${eur(v)}</div></div>`).join('')}</section>` : ''}
  ${!s.receipts ? '<div class="empty-state">No receipts in this period.</div>' : ''}`;
}
function bindSpending(root) {
  bindCommon(root);
  $$('[data-per]', root).forEach(b => b.onclick = () => { period = b.dataset.per; renderMain(); });
  $$('[data-catsel]', root).forEach(b => b.onclick = () => openCategory(b.dataset.catsel));
}
function openCategory(cat) {
  const [a, b] = periodRange(period);
  pushPage({
    title: catOf(cat).label,
    render() {
      const m = new Map();
      for (const r of state.receipts) { if (!C.inPeriod(r.date, a, b)) continue; for (const it of r.items) { const p = state.products[it.productId]; if ((p?.category || 'other') !== cat) continue; const k = p ? p.id : '?'; m.set(k, (m.get(k) || 0) + C.paid(it)); } }
      const e = [...m.entries()].sort((x, y) => y[1] - x[1]);
      return `<section class="card flush">${e.map(([pid, v]) => `<div class="list-row tap" data-product="${pid}"><div class="grow name">${esc(state.products[pid]?.name || 'Unlinked items')}</div><div class="mono">${eur(v)}</div></div>`).join('')}</section>`;
    },
    mount: bindCommon,
  });
}

// ---------- SCAN ----------
function startScan(kind) {
  if (kind === 'manual') { openEditor(newDraft()); return; }
  const input = kind === 'camera' ? $('#in-camera') : $('#in-gallery');
  input.value = '';
  input.onchange = () => { const f = input.files && input.files[0]; if (f) handleImage(f); };
  input.click();
}

async function handleImage(f) {
    try {
      const canvas = await IP.loadImageToCanvas(f);
      const part = { canvas, quad: IP.detectQuad(canvas) };
      if (scan && scan.adding) { scan.parts.push(part); scan.adding = false; scan.cur = scan.parts.length - 1; refreshTop(); }
      else { scan = { parts: [part], cur: 0 }; openCrop(); }
      OCR.warmUp(state.settings.langs);
    } catch (e) { console.error(e); toast('Could not open image'); }
}

function openCrop() {
  pushPage({
    title: 'Adjust edges',
    render() {
      const n = scan.parts.length;
      return `<div class="crop-wrap"><div class="crop-stage" id="stage"></div></div>
      <p class="muted small center">Drag the corners to the receipt's edges.${n > 1 ? ` Part ${scan.cur + 1} of ${n}.` : ''}</p>
      <div class="crop-tools">
        <button class="btn ghost sm" data-rot="-1">⟲ Rotate</button><button class="btn ghost sm" data-rot="1">⟳ Rotate</button>
        <button class="btn ghost sm" data-auto>Auto</button><button class="btn ghost sm" data-full>Full</button>
        ${n > 1 ? `<button class="btn ghost sm" data-prev>‹ Part</button><button class="btn ghost sm" data-next>Part ›</button><button class="btn ghost sm danger-t" data-delpart>Remove part</button>` : ''}
      </div>
      <div class="bottom-bar"><button class="btn ghost" data-addpart>+ Add part</button><button class="btn primary grow" data-go>Read receipt</button></div>`;
    },
    mount(ov) {
      const part = scan.parts[scan.cur];
      mountCropper($('#stage', ov), part);
      $$('[data-rot]', ov).forEach(b => b.onclick = () => { part.canvas = IP.rotateCanvas(part.canvas, +b.dataset.rot); part.quad = IP.detectQuad(part.canvas); refreshTop(); });
      $('[data-auto]', ov).onclick = () => { part.quad = IP.detectQuad(part.canvas); refreshTop(); };
      $('[data-full]', ov).onclick = () => { const W = part.canvas.width, H = part.canvas.height; part.quad = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]; refreshTop(); };
      const pv = $('[data-prev]', ov); if (pv) pv.onclick = () => { scan.cur = (scan.cur + scan.parts.length - 1) % scan.parts.length; refreshTop(); };
      const nx = $('[data-next]', ov); if (nx) nx.onclick = () => { scan.cur = (scan.cur + 1) % scan.parts.length; refreshTop(); };
      const dp = $('[data-delpart]', ov); if (dp) dp.onclick = () => { scan.parts.splice(scan.cur, 1); scan.cur = Math.max(0, scan.cur - 1); refreshTop(); };
      $('[data-addpart]', ov).onclick = () => {
        modal(`<h3>Add next part</h3><p class="muted small">Photograph the next section of a long receipt. Parts are read top to bottom in order.</p><div class="row gap mt"><button class="btn primary grow" data-k="camera">Camera</button><button class="btn ghost grow" data-k="gallery">Gallery</button></div>`, {
          onMount: (m, close) => $$('[data-k]', m).forEach(b => b.onclick = () => { close(); scan.adding = true; startScan(b.dataset.k); }),
        });
      };
      $('[data-go]', ov).onclick = () => runScan();
    },
    onClose() { scan = null; },
  });
}

function mountCropper(stage, part) {
  const c = part.canvas;
  const maxW = stage.parentElement.clientWidth - 8, maxH = Math.max(260, window.innerHeight - 290);
  const s = Math.min(maxW / c.width, maxH / c.height);
  const w = Math.round(c.width * s), h = Math.round(c.height * s);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  const view = document.createElement('canvas'); view.width = w * (window.devicePixelRatio || 1); view.height = h * (window.devicePixelRatio || 1);
  view.style.width = w + 'px'; view.style.height = h + 'px';
  view.getContext('2d').drawImage(c, 0, 0, view.width, view.height);
  stage.appendChild(view);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.classList.add('crop-svg');
  const shade = document.createElementNS(svgNS, 'path'); shade.setAttribute('fill-rule', 'evenodd'); shade.setAttribute('class', 'crop-shade');
  const poly = document.createElementNS(svgNS, 'polygon'); poly.setAttribute('class', 'crop-poly');
  svg.append(shade, poly); stage.appendChild(svg);
  const handles = part.quad.map((p, i) => { const d = document.createElement('div'); d.className = 'handle'; d.dataset.i = i; stage.appendChild(d); return d; });
  const draw = () => {
    const pts = part.quad.map(p => [p.x * s, p.y * s]);
    poly.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    shade.setAttribute('d', `M0,0H${w}V${h}H0Z M${pts.map(p => p.join(',')).join(' L')}Z`);
    handles.forEach((hd, i) => { hd.style.left = pts[i][0] + 'px'; hd.style.top = pts[i][1] + 'px'; });
  };
  draw();
  let drag = null;
  const loupe = document.createElement('canvas'); loupe.className = 'loupe'; loupe.width = loupe.height = 110; stage.appendChild(loupe);
  const showLoupe = (p) => {
    const lc = loupe.getContext('2d'); const z = 2.2 / s; const r = 55;
    lc.fillStyle = '#000'; lc.fillRect(0, 0, 110, 110);
    lc.drawImage(c, p.x - r / (s * 2.2), p.y - r / (s * 2.2), 110 / (s * 2.2), 110 / (s * 2.2), 0, 0, 110, 110);
    lc.strokeStyle = '#14b8a6'; lc.lineWidth = 1.5; lc.beginPath(); lc.moveTo(55, 40); lc.lineTo(55, 70); lc.moveTo(40, 55); lc.lineTo(70, 55); lc.stroke();
    loupe.style.display = 'block'; loupe.style.left = (p.x * s < w / 2 ? w - 120 : 10) + 'px'; loupe.style.top = '10px'; void z;
  };
  stage.addEventListener('pointerdown', (e) => {
    const rect = stage.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = -1, bd = 1e9;
    part.quad.forEach((p, i) => { const d = Math.hypot(p.x * s - x, p.y * s - y); if (d < bd) { bd = d; best = i; } });
    if (bd < 60) { drag = { i: best, rect }; stage.setPointerCapture(e.pointerId); handles[best].classList.add('active'); showLoupe(part.quad[best]); e.preventDefault(); }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(w, e.clientX - drag.rect.left)), y = Math.max(0, Math.min(h, e.clientY - drag.rect.top));
    part.quad[drag.i] = { x: x / s, y: y / s }; draw(); showLoupe(part.quad[drag.i]);
  });
  const end = () => { if (drag) handles[drag.i].classList.remove('active'); drag = null; loupe.style.display = 'none'; };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
}

async function runScan() {
  const parts = scan.parts.slice();
  let cancelled = false;
  const setProg = (label, p) => {
    const l = $('#ocr-label'), b = $('#ocr-bar');
    if (l) l.textContent = label; if (b && p != null) b.style.width = Math.round(p * 100) + '%';
  };
  pushPage({
    title: 'Reading receipt',
    render: () => `<div class="ocr-wait"><div class="spinner"></div><div id="ocr-label" class="muted">Preparing image…</div><div class="progress"><div id="ocr-bar"></div></div>
      <p class="muted small center">Everything runs on your phone. No data leaves the device.</p></div>`,
    onBack() { cancelled = true; popPage(); },
  });
  await new Promise(r => setTimeout(r, 60));
  const langs = state.settings.langs || 'deu+ita';
  const pass = async (mode, label) => {
    const canv = IP.stackCanvases(parts.map(p => IP.enhance(IP.warpGray(p.canvas, p.quad, 1500), mode)));
    const res = await OCR.recognize(canv, langs, (m) => {
      if (m.status === 'recognizing text') setProg(`${label} ${Math.round(m.progress * 100)}%`, m.progress);
      else if (/load/.test(m.status)) setProg('Loading OCR engine…', null);
    });
    const parsed = parseReceipt(res.text);
    const ok = parsed.total != null && Math.abs(parsed.sum - parsed.total) < 0.015;
    return { canv, res, parsed, ok, score: (ok ? 100 : 0) + (parsed.total != null ? 10 : 0) + parsed.items.length * 2 + (res.confidence || 50) / 10 };
  };
  try {
    const native = OCR.hasNative();
    const mode = native ? 'none' : (state.settings.enhance || 'auto');
    let best = await pass(mode, 'Reading text');
    if (cancelled) return;
    if (!best.ok) {
      setProg('Double-checking with enhanced contrast…', 0);
      const alt = await pass(native ? 'auto' : (mode === 'bw' ? 'auto' : 'bw'), 'Second pass');
      if (cancelled) return;
      if (alt.score > best.score) best = alt;
    }
    const draft = newDraft();
    const p = best.parsed;
    draft.store = matchKnownStore(p.store);
    draft.date = p.date || today();
    draft.total = p.total;
    draft.ocrText = best.res.text;
    draft.ocrConf = best.res.confidence;
    draft.img = IP.thumbnail(best.canv, 640, 0.6);
    draft.items = p.items.map(it => itemFromParsed(it));
    if (!best.ok && p.total != null) {
      const fix = C.reconcileWithTotal(draft.items, p.total);
      if (fix) { draft.items[fix.idx].flag = `Auto-corrected from ${num(draft.items[fix.idx].price)} so items match the total. Please check.`; draft.items[fix.idx].price = fix.price; }
    }
    popPage(); // progress
    popPage(); // crop
    scan = null;
    openEditor(draft, true);
  } catch (e) {
    console.error(e);
    popPage();
    toast('OCR failed: ' + (e && e.message ? e.message : e), 5000);
  }
}

function matchKnownStore(name) {
  if (!name) return '';
  const known = [...new Set(state.receipts.map(r => r.store).filter(Boolean))];
  const k = C.productKey(name);
  let best = null, bs = 0;
  for (const s of known) { const v = C.similarity(C.productKey(s), k); if (v > bs) { bs = v; best = s; } }
  return bs >= 0.8 ? best : name;
}

function itemFromParsed(it) {
  const m = C.matchProduct(state, it.name);
  const name = C.fixName(it.name);
  return { id: C.uid(), name, qty: it.qty, unit: it.unit, price: it.price, unitPrice: it.unitPrice, discount: it.discount || 0, productId: m.productId, match: m.confidence, category: m.productId ? state.products[m.productId].category : C.guessCategory(it.deposit ? 'pfand' : name) };
}

function newDraft() {
  return { id: null, store: '', date: today(), total: null, items: [], img: null, ocrText: '', createdAt: Date.now() };
}

// ---------- RECEIPT EDITOR ----------
async function openReceipt(id) {
  const r = state.receipts.find(x => x.id === id);
  if (!r) return;
  const draft = JSON.parse(JSON.stringify(r));
  draft.items.forEach(it => { it.category = state.products[it.productId]?.category || it.category || C.guessCategory(it.name); it.match = it.productId ? 'linked' : null; });
  draft.img = null;
  openEditor(draft, false);
  try { const img = await DB.loadImage(id); if (img) { draft.img = img; const el = $('#rimg'); if (el) { el.src = img; el.closest('details').hidden = false; } } } catch (e) { /* no image */ }
}

function draftSum(d) { return r2(d.items.reduce((a, it) => a + C.paid(it), 0)); }

function openEditor(draft, isNew) {
  let dirty = !!isNew;
  const stores = [...new Set(state.receipts.map(r => r.store).filter(Boolean).concat(CHAINS.map(c => c[0])))].sort((a, b) => a.localeCompare(b));
  const page = {
    title: draft.id ? 'Edit receipt' : 'New receipt',
    actions: draft.id ? `<button class="icon-btn danger-t" data-delr aria-label="Delete receipt"><svg viewBox="0 0 24 24" width="21" height="21"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>` : '',
    render() {
      return `
      <section class="card">
        <label class="lbl">Store</label>
        <input class="input" id="e-store" list="dl-stores" value="${esc(draft.store)}" placeholder="e.g. Lidl">
        <datalist id="dl-stores">${stores.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <div class="row gap mt">
          <div class="grow"><label class="lbl">Date</label><input class="input" type="date" id="e-date" value="${esc(draft.date || '')}"></div>
          <div class="grow"><label class="lbl">Total on receipt</label><input class="input mono" id="e-total" inputmode="decimal" value="${draft.total != null ? esc(num(draft.total)) : ''}" placeholder="0,00"></div>
        </div>
        <div id="e-check" class="check"></div>
        ${draft.ocrConf != null && draft.ocrConf < (OCR.hasNative() ? 60 : 65) ? `<div class="check bad">⚠ The photo looks blurry or unclear (text recognition ${Math.round(draft.ocrConf)}% sure), so these items are probably wrong. Retake it: hold the phone still, tap the screen to focus, use good light.<div class="mt8"><button class="btn sm" data-retake>Retake photo</button></div></div>` : ''}
      </section>
      <details class="card" ${draft.img ? '' : 'hidden'}><summary>Receipt image</summary><img id="rimg" class="rimg" src="${draft.img || ''}" alt=""></details>
      <section class="items">${draft.items.map((it, i) => itemCard(it, i)).join('')}</section>
      <button class="btn ghost wide" data-additem>+ Add item</button>
      ${draft.ocrText ? `<details class="card"><summary>Recognised text</summary><pre class="ocr-text">${esc(draft.ocrText)}</pre></details>` : ''}
      <div class="spacer"></div>
      <div class="bottom-bar"><button class="btn primary grow" data-save>Save receipt</button></div>`;
    },
    mount(ov) {
      const updateCheck = () => {
        const sum = draftSum(draft), el = $('#e-check', ov);
        if (!el) return;
        if (draft.total == null || draft.total === '') { el.className = 'check'; el.innerHTML = `Items: <b class="mono">${eur(sum)}</b>`; return; }
        const ok = Math.abs(sum - draft.total) < 0.015;
        el.className = 'check ' + (ok ? 'ok' : 'bad');
        el.innerHTML = ok ? `✓ Items add up to the total (${eur(sum)})` : `⚠ Items add up to <b class="mono">${eur(sum)}</b>, ${sum > draft.total ? 'over' : 'under'} by <b class="mono">${eur(Math.abs(sum - draft.total))}</b>. Check the highlighted lines against the receipt.`;
      };
      updateCheck();
      $('#e-store', ov).oninput = (e) => { draft.store = e.target.value; dirty = true; };
      $('#e-date', ov).oninput = (e) => { draft.date = e.target.value; dirty = true; };
      $('#e-total', ov).oninput = (e) => { const v = toNumber(e.target.value); draft.total = e.target.value.trim() === '' ? null : v; dirty = true; updateCheck(); };
      $$('.item', ov).forEach(card => {
        const i = +card.dataset.i, it = draft.items[i];
        $$('[data-f]', card).forEach(inp => inp.oninput = () => {
          const f = inp.dataset.f; dirty = true;
          if (f === 'name') it.name = inp.value;
          else {
            if (f === 'qty' || f === 'price') it.unitPrice = null; const v = toNumber(inp.value); it[f] = inp.value.trim() === '' ? (f === 'qty' ? 1 : 0) : (v ?? it[f]); }
          if (f === 'discount' && it.discount > 0) it.discount = -it.discount;
          const up = $('[data-up]', card); if (up) up.textContent = unitLine(it);
          updateCheck();
        });
        $('[data-unit]', card).onclick = () => { it.unit = it.unit === 'kg' ? 'pc' : 'kg'; it.unitPrice = null; dirty = true; refreshTop(); };
        $('[data-del]', card).onclick = () => { draft.items.splice(i, 1); dirty = true; refreshTop(); };
        $('[data-shift]', card).onclick = () => {
          modal(`<h3>Prices on the wrong lines?</h3><p class="muted small">Moves the price of “${esc(it.name || 'this item')}” and of every item below it by one line. Names stay where they are.</p>
            <div class="menu"><button data-dir="up">↑ Move prices up one line</button><button data-dir="down">↓ Move prices down one line</button></div>`, {
            onMount: (m, close) => $$('[data-dir]', m).forEach(b => b.onclick = () => { close(); shiftPrices(draft, i, b.dataset.dir === 'up' ? -1 : 1); dirty = true; refreshTop(); }),
          });
        };
        $('[data-link]', card).onclick = () => pickProduct(it.name, (pid) => { it.productId = pid; it.match = pid ? 'linked' : null; if (pid) it.category = state.products[pid].category; dirty = true; refreshTop(); });
        $('[data-icat]', card).onclick = () => pickCategory(it.category, (c) => { it.category = c; dirty = true; refreshTop(); });
        const disc = $('[data-showdisc]', card); if (disc) disc.onclick = () => { it.discount = it.discount || 0; it._showDisc = true; refreshTop(); };
      });
      $('[data-additem]', ov).onclick = () => { draft.items.push({ id: C.uid(), name: '', qty: 1, unit: 'pc', price: 0, discount: 0, productId: null, category: 'other', _focus: true }); dirty = true; refreshTop(); const last = $$('.item [data-f=name]', $('#overlay')).pop(); if (last) last.focus(); };
      $('[data-save]', ov).onclick = () => saveDraft(draft);
      const rt = $('[data-retake]', ov); if (rt) rt.onclick = () => { dirty = false; popPage(); startScan('camera'); };
      const del = $('[data-delr]', ov);
      if (del) del.onclick = async () => {
        if (await confirmDlg('Delete this receipt? This cannot be undone.', 'Delete', true)) {
          state.receipts = state.receipts.filter(r => r.id !== draft.id); DB.deleteImage(draft.id).catch(() => {});
          gcProducts(); await DB.saveState(state, true); dirty = false; popPage(); toast('Receipt deleted');
        }
      };
    },
    async onBack() {
      if (dirty && !(await confirmDlg('Discard changes to this receipt?', 'Discard', true))) return;
      popPage();
    },
  };
  pushPage(page);
}

function unitLine(it) {
  const q = +it.qty || 1, u = C.unitPriceOf(it);
  if (it.unit === 'kg') return `${num(q, 3)} kg × ${eur(u)}/kg`;
  return q !== 1 ? `${num(q, Number.isInteger(q) ? 0 : 2)} × ${eur(u)}` : '';
}

function itemCard(it, i) {
  const p = it.productId ? state.products[it.productId] : null;
  const linkLabel = p ? `${it.match === 'fuzzy' ? '≈ ' : '↔ '}${esc(p.name)}` : '+ New product';
  const c = catOf(it.category);
  return `<div class="item card ${it.flag ? 'flag' : ''}" data-i="${i}">
    <div class="row gap"><input class="input grow name-in" data-f="name" value="${esc(it.name)}" placeholder="Item name"><button class="icon-btn sm" data-shift aria-label="Fix price alignment" title="Prices on wrong lines?">⇅</button><button class="icon-btn sm" data-del aria-label="Remove item">✕</button></div>
    <div class="row gap mt8 nums">
      <div class="qty"><label class="lbl">${it.unit === 'kg' ? 'Weight' : 'Qty'}</label><div class="row"><input class="input mono" data-f="qty" inputmode="decimal" value="${esc(it.unit === 'kg' ? num(it.qty, 3) : num(it.qty, Number.isInteger(+it.qty) ? 0 : 2))}"><button class="unit-btn" data-unit>${it.unit === 'kg' ? 'kg' : 'pc'}</button></div></div>
      <div class="grow"><label class="lbl">Price</label><input class="input mono" data-f="price" inputmode="decimal" value="${esc(num(it.price))}"></div>
      ${it.discount || it._showDisc ? `<div class="grow"><label class="lbl">Discount</label><input class="input mono" data-f="discount" inputmode="decimal" value="${esc(num(it.discount))}"></div>` : `<button class="link sm self-end" data-showdisc>+ discount</button>`}
    </div>
    <div class="row between mt8 meta"><span class="muted tiny" data-up>${unitLine(it)}</span></div>
    <div class="row gap mt8 wrap">
      <button class="chip link-chip ${p ? (it.match === 'fuzzy' ? 'fuzzy' : 'on') : ''}" data-link>${linkLabel}</button>
      <button class="chip cat" data-icat style="--c:${c.color}"><span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</button>
    </div>
    ${it.flag ? `<div class="flag-note">${esc(it.flag)}</div>` : ''}
  </div>`;
}

// Move price data (price, qty, unit, discount) of items[from..] one line up (dir -1) or down (dir 1)
function shiftPrices(draft, from, dir) {
  const F = ['price', 'qty', 'unit', 'unitPrice', 'discount'];
  const its = draft.items, n = its.length;
  const take = (it) => Object.fromEntries(F.map(f => [f, it[f]]));
  const empty = { price: 0, qty: 1, unit: 'pc', unitPrice: null, discount: 0 };
  if (dir < 0) {
    if (from === 0) return;
    for (let k = from; k < n; k++) Object.assign(its[k - 1], take(its[k]));
    Object.assign(its[n - 1], empty); its[n - 1].flag = 'Price missing after moving prices. Enter it or remove this line.';
  } else {
    for (let k = n - 1; k > from; k--) Object.assign(its[k], take(its[k - 1]));
    Object.assign(its[from], empty); its[from].flag = 'Price missing after moving prices. Enter it or remove this line.';
  }
}

function gcProducts() {
  const used = new Set();
  for (const r of state.receipts) for (const it of r.items) if (it.productId) used.add(it.productId);
  for (const id of Object.keys(state.products)) if (!used.has(id)) delete state.products[id];
}

async function saveDraft(draft) {
  draft.items = draft.items.filter(it => (it.name || '').trim() || +it.price);
  if (!draft.items.length) { toast('Add at least one item'); return; }
  if (!draft.store.trim()) { toast('Please enter the store'); $('#e-store')?.focus(); return; }
  const isNew = !draft.id;
  const rec = {
    id: draft.id || C.uid(), store: draft.store.trim(), date: draft.date || today(),
    total: draft.total != null && draft.total !== '' && !isNaN(draft.total) ? r2(+draft.total) : null,
    items: [], createdAt: draft.createdAt || Date.now(), updatedAt: Date.now(), ocrText: draft.ocrText || '',
  };
  for (const it of draft.items) {
    const item = { id: it.id || C.uid(), name: (it.name || '').trim() || 'Item', qty: +it.qty || 1, unit: it.unit || 'pc', price: r2(+it.price || 0), discount: r2(+it.discount || 0), productId: it.productId || null };
    if (it.unitPrice > 0 && Math.abs(it.unitPrice * item.qty - item.price) <= 0.011) item.unitPrice = +it.unitPrice;
    const p = C.ensureProduct(state, { ...item, category: it.category });
    item.productId = p.id;
    if (it.category && p.category !== it.category) p.category = it.category;
    rec.items.push(item);
  }
  if (isNew) state.receipts.push(rec);
  else state.receipts = state.receipts.map(r => r.id === rec.id ? rec : r);
  gcProducts();
  try {
    await DB.saveState(state, true);
    if (draft.img && isNew) await DB.saveImage(rec.id, draft.img);
  } catch (e) { toast('Saving failed: ' + e.message, 5000); return; }
  pages.length = 0; renderTop();
  setTab(isNew ? 'home' : tab);
  toast(isNew ? `Saved · ${rec.items.length} items` : 'Receipt updated');
}

// ---------- SETTINGS ----------
function openSettings() {
  pushPage({
    title: 'Settings',
    render() {
      const s = state.settings;
      const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
      const native = OCR.hasNative();
      return `<section class="card"><h3>Text recognition</h3>
        <p class="muted small">Engine: ${esc(OCR.engineName())}. Works offline.</p>
        ${native ? '' : `<label class="lbl">Receipt languages</label>
        <select class="input" id="s-langs">${opt('deu+ita', 'German + Italian', s.langs)}${opt('deu', 'German only (faster)', s.langs)}${opt('ita', 'Italian only (faster)', s.langs)}${opt('deu+ita+eng', 'German + Italian + English', s.langs)}</select>
        <label class="lbl mt">Image enhancement</label>
        <select class="input" id="s-enh">${opt('auto', 'Auto (even out lighting)', s.enhance)}${opt('bw', 'High contrast black & white', s.enhance)}${opt('none', 'Off', s.enhance)}</select>`}
        <label class="lbl mt">Number & date format</label>
        <select class="input" id="s-loc">${opt('de-DE', 'German (1.234,56 €)', s.locale)}${opt('it-IT', 'Italian (1.234,56 €)', s.locale)}${opt('de-AT', 'Austrian', s.locale)}${opt('en-IE', 'English (€1,234.56)', s.locale)}</select>
      </section>
      <section class="card"><h3>Your data</h3>
        <p class="muted small">${state.receipts.length} receipts · ${Object.keys(state.products).length} products. Stored only on this phone.</p>
        <div class="menu flat">
          <button data-x="csv">Export all items as CSV (Excel)</button>
          <button data-x="backup">Back up everything (JSON)</button>
          <button data-x="restore">Restore from backup…</button>
          <button data-x="wipe" class="danger-t">Delete all data</button>
        </div></section>
      <section class="card"><h3>About</h3><p class="muted small">Receipt Radar ${VERSION}. Text recognition runs on the phone (${esc(OCR.engineName())}). No account needed and no data leaves the device.</p></section>`;
    },
    mount(ov) {
      const s = state.settings;
      if ($('#s-langs', ov)) $('#s-langs', ov).onchange = (e) => { s.langs = e.target.value; persist(); };
      if ($('#s-enh', ov)) $('#s-enh', ov).onchange = (e) => { s.enhance = e.target.value; persist(); };
      $('#s-loc', ov).onchange = (e) => { s.locale = e.target.value; persist(); refreshTop(); };
      $('[data-x=csv]', ov).onclick = exportCsv;
      $('[data-x=backup]', ov).onclick = exportBackup;
      $('[data-x=restore]', ov).onclick = () => { const i = $('#in-restore'); i.value = ''; i.onchange = () => restoreBackup(i.files[0]); i.click(); };
      $('[data-x=wipe]', ov).onclick = async () => {
        if (await confirmDlg('Delete <b>all</b> receipts, products and images? Make a backup first if unsure.', 'Delete everything', true)) {
          for (const r of state.receipts) DB.deleteImage(r.id).catch(() => {});
          state = { ...DB.emptyState(), settings: state.settings }; await DB.saveState(state, true); refreshTop(); toast('All data deleted');
        }
      };
    },
  });
}

function csvCell(v) { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCsv() {
  const head = ['Date', 'Store', 'Product', 'Category', 'Receipt text', 'Qty', 'Unit', 'Unit price', 'Price', 'Discount', 'Paid', 'Receipt total'];
  const rows = [head];
  const n = (v, d = 2) => (v == null || isNaN(v)) ? '' : Number(v).toFixed(d).replace('.', ',');
  for (const r of [...state.receipts].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) for (const it of r.items) {
    const p = state.products[it.productId];
    rows.push([r.date, r.store, p?.name || '', catOf(p?.category).label, it.name, n(it.qty, it.unit === 'kg' ? 3 : 0), it.unit, n(C.unitPriceOf(it)), n(it.price), n(it.discount), n(C.paid(it)), n(r.total)]);
  }
  DB.exportFile(`receipts-${today()}.csv`, 'text/csv', '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'));
}
async function exportBackup() {
  const images = {};
  for (const r of state.receipts) { try { const im = await DB.loadImage(r.id); if (im) images[r.id] = im; } catch (e) { /* skip */ } }
  DB.exportFile(`receipt-radar-backup-${today()}.json`, 'application/json', JSON.stringify({ app: 'receipt-radar', exported: new Date().toISOString(), state, images }));
}
async function restoreBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const st = data.state || data;
    if (!Array.isArray(st.receipts) || typeof st.products !== 'object') throw new Error('Not a Receipt Radar backup');
    if (!(await confirmDlg(`Replace current data with the backup (${st.receipts.length} receipts)?`, 'Restore', true))) return;
    state = { ...DB.emptyState(), ...st, settings: { ...DB.emptyState().settings, ...(st.settings || {}) } };
    for (const [id, im] of Object.entries(data.images || {})) await DB.saveImage(id, im);
    await DB.saveState(state, true);
    pages.length = 0; renderTop(); setTab('home'); toast('Backup restored');
  } catch (e) { toast('Restore failed: ' + e.message, 5000); }
}

// ---------- boot ----------
async function boot() {
  state = await DB.loadState();
  $$('#tabs button[data-tab]').forEach(b => b.onclick = () => { pages.length = 0; renderTop(); setTab(b.dataset.tab); });
  $('#tab-scan').onclick = () => {
    modal(`<h3>Add a receipt</h3><div class="menu">
      <button data-k="camera">📷  Take a photo</button><button data-k="gallery">🖼  Choose from gallery</button><button data-k="manual">✎  Enter manually</button></div>`, {
      onMount: (m, close) => $$('[data-k]', m).forEach(b => b.onclick = () => { close(); startScan(b.dataset.k); }),
    });
  };
  $('#btn-settings').onclick = openSettings;
  setTab('home');
  try {
    if (window.AndroidBridge && AndroidBridge.hasPendingPhoto && AndroidBridge.hasPendingPhoto()) {
      const blob = await (await fetch('__pending/photo.jpg?t=' + Date.now())).blob();
      handleImage(blob);
    }
  } catch (e) { console.warn(e); }
  window.__rr = { get state() { return state; }, back, openProduct, openReceipt };
}
boot();
