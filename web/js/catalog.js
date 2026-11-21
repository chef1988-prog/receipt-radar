// Products, matching, categories and statistics.
import { norm, stripAccents } from './parser.js';

export const CATEGORIES = [
  { id: 'produce', label: 'Fruit & Veg', color: '#3f9b4f' },
  { id: 'dairy', label: 'Dairy & Eggs', color: '#4a7fd4' },
  { id: 'meat', label: 'Meat & Fish', color: '#c4503d' },
  { id: 'bakery', label: 'Bakery', color: '#c98a2e' },
  { id: 'pantry', label: 'Pantry', color: '#8a6b4e' },
  { id: 'frozen', label: 'Frozen', color: '#3fa7b5' },
  { id: 'drinks', label: 'Drinks', color: '#7a5cc4' },
  { id: 'snacks', label: 'Snacks & Sweets', color: '#d45f9a' },
  { id: 'household', label: 'Household & Care', color: '#6b7a8a' },
  { id: 'deposit', label: 'Deposit (Pfand)', color: '#a3a3a3' },
  { id: 'other', label: 'Other', color: '#9a8f7a' },
];
export const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const KW = {
  produce: 'banane bananen apfel aepfel apfel mela mele tomate tomaten pomodor datterin ciliegin gurke gurken cetriol salat insalata kartoffel kartoffeln patate zwiebel zwiebeln cipoll karotte karotten moehre mohre carot zucchin paprika peperon zitrone zitronen limon orange orangen arance arancia trauben uva avocado broccoli brokkoli spinat spinaci pilze funghi champignon beeren fragol erdbeer himbeer heidelbeer mirtill kiwi birne birnen pere obst gemuse gemuese frutta verdur aglio knoblauch ingwer zenzero mandarin clementin melone ananas basilikum basilico rucola finocch lauch porree sellerie sedano kohl cavol radieschen ravanell mango lime limette pfirsich pesca pesche aprikose albicocch rispen kirsch zwetsch pflaum prugn melanzan aubergine kurbis zucca mais',
  dairy: 'milch h-milch vollmilch latte joghurt jogurt yogurt yoghurt kase kaese formaggi formaggio mozzarella parmigian parmigiano grana ricotta butter burro sahne panna quark frischkase gouda emmentaler edamer eier ei uova uovo skyr kefir mascarpone pecorino gorgonzola stracchino schmand creme fraiche buttermilch mascarpone feta halloumi scamorza provolone fontina asiago taleggio burrata camembert brie',
  meat: 'hahnchen haehnchen huhn pollo rind rinder manzo schwein schweine maiale hack hackfleisch macinato wurst salami schinken prosciutto speck pancetta mortadella bresaola salame lachs salmone thunfisch tonno fisch pesce garnelen gamberi wurstchen wiener salsiccia carne fleisch filet tacchino pute puten bratwurst aufschnitt kotelett schnitzel bistecca hamburger burger leberkase merluzzo kabeljau forelle trota dorade orata sgombro makrele cotto crudo nuggets',
  bakery: 'brot brotchen broetchen pane panino panini baguette croissant cornetto cornetti toast brezel breze laugen focaccia grissini fette biscottate kuchen torta ciabatta semmel krapfen berliner pizzette piadina tramezzin vollkornbrot roggen dinkel',
  pantry: 'nudeln pasta spaghetti penne fusilli rigatoni farfalle tagliatelle lasagne gnocchi reis riso mehl farina zucker zucchero salz sale ol oel olio essig aceto sugo passata pelati tomatenmark konserve muesli musli cornflakes honig miele marmelad konfiture confettur linsen lenticch bohnen fagioli ceci kichererbsen gewurz pfeffer pepe bruhe brodo dado haferflocken avena ketchup mayo mayonnaise senf senape pesto ragu couscous quinoa polenta tortellini ravioli muesli granola erdnussbutter mais-konserve thunfischdose cereali fiocchi',
  frozen: 'tk tiefkuhl tiefkuehl surgel surgelati surgelato frozen pizza eis-tk eiswurfel bastoncini fischstabchen pommes',
  drinks: 'wasser mineralwasser acqua saft succo cola coca pepsi fanta sprite bier birra wein vino sprudel limo limonade tee te kaffee caffe espresso energy mineral prosecco spumante aperol gin vodka wodka whisky eistee smoothie apfelschorle schorle radler lemonsoda chinotto aranciata spezi club-mate mate bitter campari martini rum likor',
  snacks: 'schoko schokolade cioccolat cioccolato chips keks kekse biscott biscotti gummi haribo nutella eis gelato bonbon caramell riegel snack waffel wafer croccant pralin pralinen merendin merendine nusse nuesse noci mandeln mandorle pistaz chips patatine popcorn kinder ritter milka lindt ferrero oreo crackers salzstangen brezeln knabber tarall',
  household: 'shampoo dusch duschgel doccia seife sapone zahnpasta dentifricio zahnburste spazzolino toilettenpapier klopapier carta igienica kuchenrolle scottex taschentucher fazzoletti waschmittel detersivo spulmittel piatti deo deodorante creme crema windel windeln pannolini rasier rasoio mullbeutel sacchetti alufolie folie schwamm spugna putz reiniger candeggina ammorbident weichspuler tampons assorbenti watte cotone batterie batterien zewa tempo spulmaschinentabs tabs lavastoviglie pellicola bagnoschiuma balsamo pflaster kerze',
  deposit: 'pfand leergut einwegpfand mehrwegpfand vuoto cauzione',
};
const KW_LIST = [];
for (const [cat, s] of Object.entries(KW)) for (const k of s.split(' ')) if (k) KW_LIST.push([k, cat]);
KW_LIST.sort((a, b) => b[0].length - a[0].length);

export function guessCategory(name) {
  const words = norm(name).replace(/-/g, ' ').split(' ').filter(Boolean);
  const joined = norm(name);
  let best = null, bestLen = 0;
  for (const [k, cat] of KW_LIST) {
    if (k.length <= bestLen) break;
    if (k.includes(' ') || k.includes('-')) { if (joined.includes(k.replace('-', ' '))) { best = cat; bestLen = k.length; } continue; }
    for (const w of words) {
      // match at word start (or compound word end for German: "Vollkornbrot", "Hackfleisch")
      if (w.startsWith(k) || (k.length >= 4 && w.endsWith(k))) { best = cat; bestLen = k.length; break; }
    }
  }
  return best || 'other';
}

export function productKey(name) {
  return stripAccents(String(name || '').toUpperCase()).replace(/[^A-Z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// fix a few frequent OCR confusions in product names
export function fixName(name) {
  return String(name || '')
    .replace(/\b[Il|]L\b/g, '1L')
    .replace(/\b(100|125|150|200|250|300|400|500|750)6\b/g, '$1G')
    .replace(/^\|\s*/, '')
    .replace(/\s+/g, ' ').trim();
}

export function prettyName(name) {
  const n = fixName(name);
  const letters = n.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters && letters === letters.toUpperCase();
  if (!upper) return n;
  return n.split(' ').map(w => {
    if (/\d/.test(w) || w.length <= 2 && /^[A-Z!&]+$/.test(w) && !/^(DI|DA|AL|IN|E|UND|MIT|DEL|LA|IL)$/.test(w)) return w;
    return w.split('-').map(x => x.charAt(0) + x.slice(1).toLowerCase()).join('-');
  }).join(' ').replace(/(\d)(G|KG|ML|L|CL)\b/g, (m, d, u) => d + u.toLowerCase());
}

function bigrams(s) {
  const t = ` ${s} `; const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const b = t.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
  return m;
}
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b); let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) if (B.has(k)) inter += Math.min(v, B.get(k));
  return (2 * inter) / (na + nb);
}

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export function buildAliasIndex(state) {
  const idx = new Map();
  for (const p of Object.values(state.products)) for (const a of p.aliases || []) idx.set(a, p.id);
  return idx;
}

// Suggest a product for a raw receipt name: {productId, confidence: 'exact'|'fuzzy'|null, score}
export function matchProduct(state, rawName, aliasIdx = buildAliasIndex(state)) {
  const key = productKey(fixName(rawName));
  if (!key) return { productId: null, confidence: null, score: 0 };
  if (aliasIdx.has(key)) return { productId: aliasIdx.get(key), confidence: 'exact', score: 1 };
  let best = null, bs = 0;
  for (const [a, pid] of aliasIdx) {
    const s = similarity(a, key);
    if (s > bs) { bs = s; best = pid; }
  }
  for (const p of Object.values(state.products)) {
    const s = similarity(productKey(p.name), key);
    if (s > bs) { bs = s; best = p.id; }
  }
  if (bs >= 0.84) return { productId: best, confidence: 'fuzzy', score: bs };
  return { productId: null, confidence: null, score: bs };
}

export function ensureProduct(state, item) {
  // item.productId may be null ("new product") -> create
  const key = productKey(fixName(item.name));
  let p = item.productId && state.products[item.productId];
  if (!p) {
    p = { id: uid(), name: prettyName(item.name) || 'Item', category: item.category || guessCategory(item.name), aliases: [], createdAt: Date.now() };
    state.products[p.id] = p;
  }
  if (key && !p.aliases.includes(key)) p.aliases.push(key);
  item.productId = p.id;
  return p;
}

export function mergeProducts(state, fromId, intoId) {
  if (fromId === intoId) return;
  const from = state.products[fromId], into = state.products[intoId];
  if (!from || !into) return;
  for (const a of from.aliases) if (!into.aliases.includes(a)) into.aliases.push(a);
  for (const r of state.receipts) for (const it of r.items) if (it.productId === fromId) it.productId = intoId;
  delete state.products[fromId];
}

export const paid = (it) => Math.round(((+it.price || 0) + (+it.discount || 0)) * 100) / 100;
export function unitPriceOf(it) {
  const q = +it.qty || 1;
  // prefer the unit price printed on the receipt (e.g. 1,99 EUR/kg) when it is consistent with the line total
  if (it.unitPrice > 0 && !(+it.discount) && Math.abs(it.unitPrice * q - (+it.price || 0)) <= 0.011) return +it.unitPrice;
  return paid(it) / q;
}

// All purchase observations of a product
export function observations(state, productId) {
  const obs = [];
  for (const r of state.receipts) for (const it of r.items) {
    if (it.productId !== productId) continue;
    obs.push({ store: r.store || '?', date: r.date, receiptId: r.id, qty: +it.qty || 1, unit: it.unit || 'pc', paid: paid(it), unitPrice: unitPriceOf(it), name: it.name });
  }
  obs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return obs;
}

export function productUnit(obs) {
  const kg = obs.filter(o => o.unit === 'kg').length;
  return kg > obs.length / 2 ? 'kg' : 'pc';
}

// Per-store price summary for one product
export function storeSummary(obs) {
  const unit = productUnit(obs);
  const rel = obs.filter(o => o.unit === unit && o.paid > 0);
  const by = new Map();
  for (const o of rel) {
    if (!by.has(o.store)) by.set(o.store, []);
    by.get(o.store).push(o);
  }
  const rows = [...by.entries()].map(([store, list]) => {
    const prices = list.map(o => o.unitPrice);
    const last = list[list.length - 1];
    return {
      store, count: list.length, last: last.unitPrice, lastDate: last.date,
      min: Math.min(...prices), max: Math.max(...prices), avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    };
  }).sort((a, b) => a.last - b.last);
  return { unit, rows };
}

export function productOverview(state) {
  const byProduct = new Map();
  for (const r of state.receipts) for (const it of r.items) {
    if (!it.productId) continue;
    if (!byProduct.has(it.productId)) byProduct.set(it.productId, []);
    byProduct.get(it.productId).push({ store: r.store || '?', date: r.date, qty: +it.qty || 1, unit: it.unit || 'pc', paid: paid(it), unitPrice: unitPriceOf(it) });
  }
  const out = [];
  for (const p of Object.values(state.products)) {
    const obs = (byProduct.get(p.id) || []).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const { unit, rows } = storeSummary(obs);
    const spent = obs.reduce((a, o) => a + o.paid, 0);
    const last = obs[obs.length - 1];
    out.push({ product: p, obs, unit, rows, stores: rows.length, best: rows[0] || null, worst: rows[rows.length - 1] || null, spent, count: obs.length, lastDate: last ? last.date : null, lastStore: last ? last.store : null, lastPrice: last ? last.unitPrice : null });
  }
  return out;
}

// Price index per store: 100 = always cheapest among stores where you bought the same product
export function storeIndex(overview) {
  const acc = new Map();
  for (const o of overview) {
    if (o.rows.length < 2 || o.product.category === 'deposit') continue;
    const min = o.rows[0].last;
    if (!(min > 0)) continue;
    for (const r of o.rows) {
      if (!acc.has(r.store)) acc.set(r.store, { store: r.store, sum: 0, n: 0, cheapest: 0 });
      const a = acc.get(r.store); a.sum += r.last / min; a.n++; if (r.last <= min + 1e-9) a.cheapest++;
    }
  }
  return [...acc.values()].map(a => ({ ...a, index: Math.round(a.sum / a.n * 100) })).sort((a, b) => a.index - b.index);
}

// Savings potential: last purchase price vs cheapest store's last price
export function savings(overview) {
  const list = [];
  for (const o of overview) {
    if (o.rows.length < 2 || !o.lastStore || o.product.category === 'deposit') continue;
    const lastRow = o.rows.find(r => r.store === o.lastStore);
    const best = o.rows[0];
    if (lastRow && best && best.store !== o.lastStore && lastRow.last - best.last > 0.005) {
      list.push({ o, save: lastRow.last - best.last, pct: (lastRow.last - best.last) / lastRow.last, bestStore: best.store, bestPrice: best.last, lastPrice: lastRow.last });
    }
  }
  return list.sort((a, b) => b.save - a.save);
}

export function inPeriod(date, from, to) {
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

export function spending(state, from, to) {
  const byCat = new Map(), byStore = new Map(), byProduct = new Map();
  let total = 0, receipts = 0;
  for (const r of state.receipts) {
    if (!inPeriod(r.date, from, to)) continue;
    receipts++;
    const rTotal = r.total != null && r.total !== '' ? +r.total : r.items.reduce((a, it) => a + paid(it), 0);
    total += rTotal;
    byStore.set(r.store || '?', (byStore.get(r.store || '?') || 0) + rTotal);
    for (const it of r.items) {
      const p = state.products[it.productId];
      const cat = (p && p.category) || 'other';
      byCat.set(cat, (byCat.get(cat) || 0) + paid(it));
      if (p) byProduct.set(p.id, (byProduct.get(p.id) || 0) + paid(it));
    }
  }
  const sortE = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { total, receipts, byCat: sortE(byCat), byStore: sortE(byStore), byProduct: sortE(byProduct) };
}

export function monthly(state, months = 12) {
  const now = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: d.toLocaleDateString(undefined, { month: 'short' }), total: 0 });
  }
  const idx = Object.fromEntries(out.map((o, i) => [o.key, i]));
  for (const r of state.receipts) {
    const k = (r.date || '').slice(0, 7);
    if (k in idx) out[idx[k]].total += r.total != null && r.total !== '' ? +r.total : r.items.reduce((a, it) => a + paid(it), 0);
  }
  return out;
}

// Try to fix one OCR digit error in a price so that items add up to the printed total.
const CONF = { 0: '689', 1: '74', 2: '7', 3: '85', 4: '1', 5: '63', 6: '508', 7: '12', 8: '0634', 9: '04' };
export function reconcileWithTotal(items, total) {
  if (total == null || !items.length) return null;
  const sum = items.reduce((a, it) => a + paid(it), 0);
  const diff = Math.round((total - sum) * 100);
  if (diff === 0) return null;
  const cands = [];
  items.forEach((it, idx) => {
    const cents = Math.round(Math.abs(it.price) * 100);
    const s = String(cents).padStart(3, '0');
    for (let p = 0; p < s.length; p++) {
      for (const alt of CONF[s[p]] || '') {
        const ns = s.slice(0, p) + alt + s.slice(p + 1);
        const nv = parseInt(ns, 10) * Math.sign(it.price || 1);
        if (nv - Math.round(it.price * 100) === diff) cands.push({ idx, price: nv / 100 });
      }
    }
  });
  return cands.length === 1 ? cands[0] : null;
}

// ---- "same product at another store?" suggestions (works across German / Italian names) ----
const CONCEPTS = [
  ['milk', 'milch latte'], ['banana', 'banan'], ['butter', 'butter burro'], ['water', 'wasser acqua mineralw'], ['bread', 'brot pane'],
  ['cheese', 'kase kaese formagg'], ['tomato', 'tomat pomodor'], ['pasta', 'pasta nudel'], ['spaghetti', 'spaghet'], ['penne', 'penne'],
  ['rice', 'reis riso'], ['eggs', 'eier uova uovo'], ['yogurt', 'joghurt jogurt yogurt yoghurt'], ['sugar', 'zucker zucchero'], ['flour', 'mehl farina'],
  ['coffee', 'kaffee caffe'], ['oil', 'olivenol oliven olio'], ['wine', 'wein vino'], ['beer', 'bier birra'], ['ham', 'schinken prosciut'],
  ['potato', 'kartoff patat'], ['onion', 'zwiebel cipoll'], ['apple', 'apfel aepfel mela mele'], ['mozzarella', 'mozzar'], ['toiletpaper', 'toilett igienic klopapier'],
  ['dishsoap', 'spulmit spuelmit piatti'], ['cola', 'cola'], ['chicken', 'hahnch haehnch hahnchen pollo'], ['salmon', 'lachs salmon'], ['tuna', 'thunfis tonno'],
  ['orange', 'orange arance aranc'], ['lemon', 'zitron limon'], ['cucumber', 'gurke cetriol'], ['salad', 'salat insalat'], ['carrot', 'karott mohre moehre carot'],
  ['cream', 'sahne panna'], ['parmesan', 'parmig parmes grana'], ['chocolate', 'schoko ciocco'], ['juice', 'saft succo'], ['tea', 'tee'], ['salt', 'salz'],
  ['detergent', 'waschmit detersiv'], ['toothpaste', 'zahnpas dentifr'], ['shampoo', 'shampo'], ['pizza', 'pizza'], ['zucchini', 'zucchin'], ['paprika', 'paprik peperon'],
];
const CONCEPT_LIST = [];
for (const [c, s] of CONCEPTS) for (const k of s.split(' ')) CONCEPT_LIST.push([k, c]);
CONCEPT_LIST.sort((a, b) => b[0].length - a[0].length);
const STOPW = new Set('bio ja! gut gunstig guenstig beste wahl milbona pilos select classic extra fresh fresco fresca frisch frische stk pack packung confezione vegan light gusto italia deutsche markenqualitat esselunga conad coop rewe lidl aldi edeka penny netto kaufland despar carrefour eurospin spar billa hofer natur naturale qualita qualitat premium original mini maxi groß gross piccolo grande nach art del della alla con mit und per von'.split(' '));

export function stems(name) {
  const out = new Set();
  for (const raw of norm(name).replace(/[-/]/g, ' ').split(' ')) {
    const t = raw.replace(/[^a-z]/g, '');
    if (t.length < 4 || /\d/.test(raw) || STOPW.has(t)) continue;
    let hit = null;
    for (const [k, c] of CONCEPT_LIST) { if (t.startsWith(k) || (t.length >= k.length + 2 && k.length >= 4 && t.endsWith(k))) { hit = c; break; } }
    out.add(hit ? 'c:' + hit : 's:' + t.slice(0, 5));
  }
  return out;
}

export function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

export function duplicateSuggestions(state, overview, limit = 6) {
  const dismissed = new Set(state.settings.dismissedPairs || []);
  const items = overview.filter(o => o.count > 0 && o.product.category !== 'deposit').map(o => ({
    o, st: new Set([...stems(o.product.name), ...o.product.aliases.flatMap(a => [...stems(a)])]), stores: new Set(o.rows.map(r => r.store)),
  }));
  const bucket = new Map();
  items.forEach((it, i) => { for (const s of it.st) { if (!bucket.has(s)) bucket.set(s, []); bucket.get(s).push(i); } });
  const seen = new Set(), out = [];
  for (const [s, idxs] of bucket) {
    if (idxs.length > 40) continue;
    for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) {
      const A = items[idxs[a]], B = items[idxs[b]];
      const key = pairKey(A.o.product.id, B.o.product.id);
      if (seen.has(key) || dismissed.has(key)) continue; seen.add(key);
      const ca = A.o.product.category, cb = B.o.product.category;
      if (ca !== cb && ca !== 'other' && cb !== 'other') continue;
      const onlySame = [...A.stores].every(x => B.stores.has(x)) && [...B.stores].every(x => A.stores.has(x));
      if (onlySame) continue; // same store(s) only: probably genuinely different products
      const shared = [...A.st].filter(x => B.st.has(x));
      const concept = shared.some(x => x.startsWith('c:'));
      const score = shared.length + (concept ? 0.5 : 0) + similarity(productKey(A.o.product.name), productKey(B.o.product.name));
      out.push({ a: A.o, b: B.o, score, key });
    }
    void s;
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
