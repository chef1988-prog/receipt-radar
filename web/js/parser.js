// Receipt text parser for German / Italian (and Austrian) supermarket receipts.
// Input: raw OCR text. Output: { store, date, total, items[], warnings[] }

export const CHAINS = [
  // Germany / Austria
  ['Lidl', ['lidl']], ['Aldi Süd', ['aldi sud', 'aldi süd', 'aldisud']], ['Aldi Nord', ['aldi nord', 'aldinord']],
  ['Aldi', ['aldi']], ['REWE', ['rewe']], ['EDEKA', ['edeka', 'e center', 'e-center', 'marktkauf']],
  ['Penny', ['penny']], ['Netto', ['netto marken', 'netto-online', 'netto city', 'netto']], ['Kaufland', ['kaufland']],
  ['Norma', ['norma']], ['Globus', ['globus']], ['real', ['real gmbh', 'real,-']], ['dm', ['dm-drogerie', 'dm drogerie', 'dm.de']],
  ['Rossmann', ['rossmann']], ['Müller', ['muller drogerie', 'müller drogerie', 'mueller.de']], ['tegut', ['tegut']],
  ['Alnatura', ['alnatura']], ['denn\'s', ['denns', "denn's"]], ['BioCompany', ['bio company', 'biocompany']],
  ['Hit', ['hit markt', 'hit handelsgruppe']], ['famila', ['famila']], ['Budni', ['budni', 'budnikowsky']],
  ['Billa', ['billa']], ['Hofer', ['hofer']], ['Spar', ['interspar', 'eurospar', 'spar']], ['MPreis', ['mpreis', 'm-preis']],
  ['Metro', ['metro']], ['Nahkauf', ['nahkauf']], ['Edeka', []],
  // Italy
  ['Esselunga', ['esselunga']], ['Coop', ['ipercoop', 'coop']], ['Conad', ['conad']], ['Carrefour', ['carrefour']],
  ['Eurospin', ['eurospin']], ['Despar', ['despar', 'aspiag']], ['Pam', ['pam panorama', 'pam local', 'pam']],
  ['Iper', ['iper la grande', 'iper']], ['Il Gigante', ['il gigante']], ['Tigre', ['tigre']], ['Todis', ['todis']],
  ['Bennet', ['bennet']], ['Unes', ['unes']], ['Crai', ['crai']], ['Sigma', ['sigma']], ['Simply', ['simply']],
  ['Auchan', ['auchan']], ['NaturaSì', ['naturasi', 'natura si']], ['Prix', ['prix quality', 'prix']], ['Tuodì', ['tuodi']],
  ['Decò', ['deco']], ['Basko', ['basko']], ['Iperal', ['iperal']], ['Tosano', ['tosano']], ['Alì', ['alisupermercati', 'ali spa', 'alì']],
  ['Poli', ['supermercati poli', 'poli']], ['MD', ['md spa', 'md discount']], ['In\'s Mercato', ['in\'s mercato', 'ins mercato']],
  ['Penny', []], ['Migross', ['migross']], ['A&O', ['a&o']], ['Famila', []], ['Tigros', ['tigros']], ['Gros', ['gros']],
  ['Sole 365', ['sole 365', 'sole365']], ['Dok', ['dok']], ['Elite', ['elite supermercati']], ['Mercatò', ['mercato']],
];

const TOTAL_KW = ['summe', 'zu zahlen', 'zuzahlen', 'gesamt', 'gesamtbetrag', 'gesamtsumme', 'endsumme', 'total', 'totale',
  'totale complessivo', 'importo pagato', 'totale euro', 'tot complessivo', 'totale eur', 'betrag', 'gesamtpreis'];
const SKIP_RE = /\b(mwst|ust|steuer|netto|brutto|zwischensumme|subtotale|subtotal|sub totale|gegeben|geg|ruckgeld|rueckgeld|zuruck|zurueck|wechselgeld|bar|ec[- ]?cash|ec[- ]?karte|girocard|kartenzahlung|kreditkarte|visa|mastercard|maestro|vpay|v pay|kontaktlos|iva|imponibile|contanti|contante|resto|bancomat|pagamento|elettronico|arrotondamento|punti|payback|bonuspunkte|saldo|tse|signatur|seriennummer|terminal|beleg|bon[- ]?nr|uid|p ?iva|partita|telefon|tel|documento|scontrino|cassa|operatore|kasse|kunde|kundenkarte|carta fedelta|transaktion|trace|autorizzazione|non riscosso|change|cash)\b/;
const DISCOUNT_RE = /\b(rabatt|preisvorteil|nachlass|coupon|gutschein|aktion|ersparnis|sconto|sconti|promo|promozione|risparmio|abzug|preisreduzierung|reduziert|offerta)\b/;
const DEPOSIT_RE = /\b(pfand|leergut|einwegpfand|mehrwegpfand|vuoto|cauzione|vuoti)\b/;

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
export function norm(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9%&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function lev(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i; let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp; if (prev[j] < rowMin) rowMin = prev[j];
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

function hasKeyword(n, kws) {
  const words = n.split(' ');
  for (const kw of kws) {
    if (kw.includes(' ')) {
      if (n.includes(kw)) return true;
      const k = kw.split(' ');
      for (let i = 0; i + k.length <= words.length; i++) {
        let ok = true;
        for (let j = 0; j < k.length && ok; j++) ok = fuzzyEq(words[i + j], k[j]);
        if (ok) return true;
      }
    } else if (words.some(w => fuzzyEq(w, kw))) return true;
  }
  return false;
}
function fuzzyEq(w, kw) {
  if (w === kw) return true;
  if (kw.length >= 5 && w.length >= 4) return lev(w, kw, 1) <= 1;
  return false;
}

// Fix common OCR confusions inside a numeric token
function fixNum(tok) {
  return tok.replace(/[Oo]/g, '0').replace(/[lI|!]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
}

export function toNumber(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/\s/g, '');
  let neg = false;
  if (/^-|-$/.test(t)) { neg = true; t = t.replace(/-/g, ''); }
  t = t.replace(/[€]|eur/gi, '');
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const v = parseFloat(t);
  if (isNaN(v)) return null;
  return neg ? -v : v;
}

const r2 = v => Math.round(v * 100) / 100;

function cleanLine(raw) {
  let s = raw.replace(/[‐-―−]/g, '-').replace(/[„“”"]/g, '').replace(/\t/g, ' ');
  // normalise numeric tokens near the end (prices) e.g. "1,9O" -> "1,90", "l,29" -> "1,29"
  s = s.replace(/([0-9OolI|!SB]{1,4})\s?([.,])\s?([0-9OolI|!SB]{2})(?=[^0-9]|$)/g, (m, a, sep, b) => {
    const fa = fixNum(a), fb = fixNum(b);
    if (/^\d+$/.test(fa) && /^\d\d$/.test(fb) && /\d/.test(a + b)) return fa + sep + fb;
    return m;
  });
  return s.replace(/\s+/g, ' ').trim();
}

// Price at end of line, optionally followed by currency / tax class / VAT%.
const PRICE_TAIL = /^(.*?)(-?)\s*(?<![\d.,])(\d{1,4})[.,](\d{2})\s*(-?)\s*(?:€|eur|euro)?\s*(?:\*?\s*[a-dw1-9]\s*\*?|\d{1,2}\s?%)?\s*[*#]?\s*$/i;
const QTY_RE = /(?:^|\s)(\d{1,3})\s*(?:stk\.?|st\.?|pz\.?|pezzi|pcs)?\s*[x×*]\s*(\d{1,4}[.,]\d{2})(?![\d])/i;
const WEIGHT_RE1 = /(\d{1,3}[.,]\d{1,3})\s*kg\s*[x×*]\s*(\d{1,4}[.,]\d{2})/i;
const WEIGHT_RE2 = /kg\s*(\d{1,3}[.,]\d{1,3})\s*[x×*]\s*(\d{1,4}[.,]\d{2})/i;

function letters(s) { return (s.match(/[a-zA-ZÀ-ÿ]/g) || []).length; }

function cleanName(name) {
  let n = name;
  n = n.replace(/\s+(?:eur|€|x)\s*$/i, '');
  n = n.replace(/^\s*[*#>]+\s*/, '');
  n = n.replace(/^\d{5,}\s+/, '');                     // article codes / EAN
  n = n.replace(/\s+(?:4|5|10|22)(?:[.,]0{1,2})?\s?%\s*$/, ''); // Italian VAT column (4/5/10/22 %), keeps e.g. "3,5%" fat
  n = n.replace(/[\s.,:;_\-|]+$/, '').replace(/^[\s.,:;_\-|]+/, '');
  return n.replace(/\s+/g, ' ').trim();
}

function parseLine(raw) {
  const text = cleanLine(raw);
  const info = { raw, text, n: norm(text), price: null, name: text };
  const m = text.match(PRICE_TAIL);
  if (m) {
    const neg = m[2] === '-' || m[5] === '-';
    info.price = (neg ? -1 : 1) * parseFloat(`${m[3]}.${m[4]}`);
    info.name = cleanName(m[1]);
    info.priceStart = m[1].length;
  }
  // quantity / weight
  let q = text.match(WEIGHT_RE1) || text.match(WEIGHT_RE2);
  let unit = 'kg';
  if (!q) { q = text.match(QTY_RE); unit = 'pc'; }
  if (q) {
    const rest = text.replace(q[0], ' ').replace(/\b(stk|st|pz|pezzi|kg|eur|euro|x|€|\/|pcs|preis|prezzo)\b/gi, ' ');
    const restBeforePrice = m ? rest.replace(/-?\d{1,4}[.,]\d{2}\s*[a-d]?\s*$/i, '') : rest;
    if (letters(restBeforePrice) < 4) {
      info.qty = { q: toNumber(q[1]), u: toNumber(q[2]), unit };
      const qEnd = text.indexOf(q[0]) + q[0].length;
      // a separate line total after the "q x u" part?
      if (m && info.priceStart >= qEnd - 1 && info.priceStart > text.indexOf(q[0])) {
        const after = text.slice(qEnd);
        if (/\d[.,]\d{2}/.test(after)) info.qty.lineTotal = Math.abs(info.price);
      }
    }
  }
  // embedded "2 x NAME"
  const pre = info.name.match(/^(\d{1,2})\s*[x×]\s+(.{3,})$/i);
  if (pre && !info.qty) { info.embeddedQty = parseInt(pre[1], 10); info.name = pre[2]; }
  return info;
}

export function detectStore(lines) {
  const head = lines.slice(0, 10).map(norm);
  const all = lines.map(norm);
  const tryIn = (arr) => {
    for (const [name, keys] of CHAINS) {
      const kws = keys.length ? keys : [norm(name)];
      for (const kw of kws) {
        const k = norm(kw);
        for (const l of arr) {
          const words = l.split(' ');
          if (k.includes(' ')) { if (l.includes(k)) return name; continue; }
          if (words.includes(k)) return name;
          if (k.length >= 5 && words.some(w => w.length >= 4 && lev(w, k, 1) <= 1)) return name;
          if (k.length >= 4 && l.replace(/ /g, '').includes(k) && l.length < 40 && words.some(w => w.startsWith(k) || w.endsWith(k))) return name;
        }
      }
    }
    return null;
  };
  const hit = tryIn(head) || tryIn(all.filter(l => /www|\.de|\.it|\.at|gmbh|s ?p ?a|s ?r ?l/.test(l)));
  if (hit) return hit;
  for (const l of lines.slice(0, 6)) {
    const t = l.trim();
    if (letters(t) >= 3 && !/\d{3,}/.test(t) && !/(willkommen|benvenut|kassenbon|documento|commerciale|vendita|prestazione|descrizione|beleg|rechnung|quittung|scontrino)/i.test(t)) {
      return t.replace(/[^\p{L}\p{N}&' .-]/gu, '').trim().slice(0, 40);
    }
  }
  return '';
}

export function detectDate(lines, now = new Date()) {
  const cands = [];
  const re = /(?<!\d)(\d{1,2})\s?[.\/\-]\s?(\d{1,2})\s?[.\/\-]\s?(\d{4}|\d{2})(?!\d)/g;
  const iso = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g;
  lines.forEach((raw, idx) => {
    const l = raw.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
    let m;
    while ((m = iso.exec(l))) cands.push({ y: +m[1], mo: +m[2], d: +m[3], idx, full: true, time: /\d{1,2}:\d{2}/.test(l) });
    while ((m = re.exec(l))) {
      let y = +m[3]; const full = m[3].length === 4; if (!full) y += 2000;
      cands.push({ y, mo: +m[2], d: +m[1], idx, full, time: /\d{1,2}:\d{2}/.test(l) || /datum|data|date/i.test(l) });
    }
  });
  const max = new Date(now.getTime() + 36 * 3600 * 1000);
  const valid = cands.filter(c => c.mo >= 1 && c.mo <= 12 && c.d >= 1 && c.d <= 31 && c.y >= 2000 && c.y <= max.getFullYear())
    .filter(c => new Date(c.y, c.mo - 1, c.d) <= max);
  if (!valid.length) return null;
  valid.sort((a, b) => (b.time - a.time) || (b.full - a.full) || (a.idx - b.idx));
  const c = valid[0];
  return `${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export function parseReceipt(text, opts = {}) {
  const rawLines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const store = detectStore(rawLines);
  const date = detectDate(rawLines, opts.now);
  const events = [];
  let total = null, totalIdx = -1;

  for (let i = 0; i < rawLines.length; i++) {
    const info = parseLine(rawLines[i]);
    const n = info.n;
    if (!n) continue;
    if (/^[-=_*. ]+$/.test(info.text)) continue;
    const isTotal = hasKeyword(n, TOTAL_KW) && !/zwischen|subtot|sub tot/.test(n);
    if (isTotal) {
      if (info.price != null && events.some(e => e.type === 'item')) { total = Math.abs(info.price); totalIdx = i; break; }
      // total keyword without price: price may be on next line
      if (info.price == null && events.some(e => e.type === 'item')) {
        const nx = rawLines[i + 1] ? parseLine(rawLines[i + 1]) : null;
        if (nx && nx.price != null && letters(nx.name) < 4) { total = Math.abs(nx.price); totalIdx = i; break; }
      }
      continue;
    }
    if (info.qty) { events.push({ type: 'qty', ...info.qty, i }); continue; }
    if (info.price != null) {
      const nn = norm(info.name);
      if (DEPOSIT_RE.test(nn)) { events.push({ type: 'item', name: info.name || 'Pfand', price: info.price, deposit: true, i }); continue; }
      if (info.price < 0 || DISCOUNT_RE.test(nn)) {
        events.push({ type: 'discount', name: info.name, amount: -Math.abs(info.price), i }); continue;
      }
      if (SKIP_RE.test(nn)) continue;
      if (letters(info.name) < 2) {
        const prev = events[events.length - 1];
        if (prev && prev.type === 'name' && prev.i === i - 1) {
          events.pop();
          events.push({ type: 'item', name: prev.text, price: info.price, i });
        }
        continue;
      }
      events.push({ type: 'item', name: info.name, price: info.price, qty: info.embeddedQty, i });
    } else {
      if (SKIP_RE.test(n) || letters(info.text) < 3) continue;
      if (/^(eur|euro|€|descrizione.*|artikel.*|bezeichnung.*|preis.*|prezzo.*)$/.test(n)) continue;
      events.push({ type: 'name', text: cleanName(info.text), i });
    }
  }

  // Resolve quantity lines, discounts, multi-line names
  const items = [];
  const near = (a, b) => Math.abs(a - b) <= 0.021;
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    if (e.type === 'item') {
      items.push({ name: e.name, price: r2(e.price), qty: e.qty || 1, unit: 'pc', unitPrice: null, discount: 0, deposit: !!e.deposit, _i: e.i });
    } else if (e.type === 'discount') {
      // attach to the item it names (e.g. "Rabatt Gouda"), else the previous regular item
      const dw = norm(e.name).split(' ').filter(w => w.length >= 4 && !DISCOUNT_RE.test(w));
      let last = dw.length ? [...items].reverse().find(it => norm(it.name).split(' ').some(w => dw.includes(w))) : null;
      if (!last) last = [...items].reverse().find(it => !it.deposit) || items[items.length - 1];
      if (last) last.discount = r2(last.discount + e.amount);
      else items.push({ name: e.name || 'Rabatt', price: r2(e.amount), qty: 1, unit: 'pc', discount: 0, _i: e.i });
    }
  }
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    if (e.type !== 'qty') continue;
    const expected = r2(e.q * e.u);
    const prevItem = [...items].reverse().find(it => it._i < e.i);
    const nextItem = items.find(it => it._i > e.i);
    const apply = (it) => { it.qty = e.q; it.unit = e.unit; it.unitPrice = e.u; it._q = true; };
    if (e.lineTotal != null) {
      const prevEv = events[k - 1];
      if (prevEv && prevEv.type === 'name' && (!prevItem || prevItem._i < prevEv.i)) {
        const it = { name: prevEv.text, price: r2(e.lineTotal), qty: e.q, unit: e.unit, unitPrice: e.u, discount: 0, _i: prevEv.i, _q: true };
        const pos = items.findIndex(x => x._i > prevEv.i);
        if (pos < 0) items.push(it); else items.splice(pos, 0, it);
        continue;
      }
    }
    const target = e.lineTotal ?? expected;
    if (prevItem && !prevItem._q && near(prevItem.price, target)) apply(prevItem);
    else if (nextItem && !nextItem._q && near(nextItem.price, target)) apply(nextItem);
    else if (prevItem && !prevItem._q && events[k - 1] && events[k - 1].type === 'item') apply(prevItem);
    else if (nextItem && !nextItem._q) apply(nextItem);
  }

  // If no total keyword was recognised, detect a line equal to the running sum
  if (total == null) {
    let run = 0;
    for (let k = 0; k < items.length; k++) {
      const repeat = k >= 1 && norm(items[k].name) === norm(items[k - 1].name);
      const totalish = /tot|summ|zahl|import|betrag|pagat/.test(norm(items[k].name));
      if (k >= 1 && near(items[k].price, r2(run)) && !repeat && (k >= 2 || totalish || letters(items[k].name) <= 4)) {
        total = items[k].price; items.splice(k); break;
      }
      run += items[k].price + items[k].discount;
    }
  }

  const out = items.map(it => ({
    name: it.name,
    qty: it.qty,
    unit: it.unit,
    price: it.price,
    discount: it.discount || 0,
    unitPrice: it.unitPrice != null ? it.unitPrice : (it.qty > 0 ? r2(it.price / it.qty) : it.price),
    deposit: !!it.deposit,
  }));
  const sum = r2(out.reduce((a, it) => a + it.price + it.discount, 0));
  const warnings = [];
  if (total != null && !near(sum, total)) warnings.push(`Items add up to ${sum.toFixed(2)} but receipt total is ${total.toFixed(2)}`);
  if (!out.length) warnings.push('No items recognised');
  return { store, date, total: total != null ? r2(total) : null, sum, items: out, warnings };
}
