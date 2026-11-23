// Rebuilding receipt rows from OCR pieces.
// Item names (left) and prices (right) usually come back as separate pieces. They must be joined along
// the slant of the text, not just by raw y position: a 1-degree tilt over a receipt's width already
// shifts the price column by a full line.

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


const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// segs: [{t, p:[TLx,TLy,TRx,TRy,BRx,BRy,BLx,BLy] or null, b:[x0,y0,x1,y1]}]
export function groupSegments(segs) {
  const S = [];
  for (const g of segs) {
    if (!g.t || !g.t.trim()) continue;
    let P = g.p && g.p.length === 8 ? g.p : [g.b[0], g.b[1], g.b[2], g.b[1], g.b[2], g.b[3], g.b[0], g.b[3]];
    const [tlx, tly, trx, try_, brx, bry, blx, bly] = P;
    const w = Math.hypot(trx - tlx, try_ - tly), h = Math.max(4, Math.hypot(blx - tlx, bly - tly));
    S.push({ t: g.t.trim(), w, h, ang: Math.atan2(try_ - tly, trx - tlx),
      cx: (tlx + trx + brx + blx) / 4, cy: (tly + try_ + bry + bly) / 4,
      x0: Math.min(tlx, blx), x1: Math.max(trx, brx) });
  }
  if (!S.length) return null;
  const hMed = med(S.map(s => s.h)) || 20;
  const xs = S.map(s => s.cx), span = Math.max(1, Math.max(...xs) - Math.min(...xs));
  // smoothed local slant: median over pieces in the same column region (similar x) and nearby rows
  const rel = S.filter(s => s.w > 2.2 * s.h && Math.abs(s.ang) < 0.35);
  const gAng = med(rel.map(r => r.ang)) ?? 0;
  for (const s of S) {
    const near = rel.filter(r => Math.abs(r.cx - s.cx) < span * 0.25 && Math.abs(r.cy - s.cy) < 8 * hMed)
      .sort((a, b) => Math.abs(a.cy - s.cy) - Math.abs(b.cy - s.cy)).slice(0, 7);
    s.la = near.length >= 2 ? med(near.map(r => r.ang)) : gAng;
  }
  // build rows left to right: each piece continues the row whose last piece predicts its height best,
  // predicting along the average of both slants (exact for a uniformly curled receipt)
  S.sort((a, b) => a.x0 - b.x0);
  const rows = [];
  for (const s of S) {
    let best = null, bd = hMed * 0.6;
    for (const R of rows) {
      const L = R.segs[R.segs.length - 1];
      if (L.x1 > s.x0 + 4) continue; // must be to the right of the row's last piece
      const pred = L.cy + Math.tan((L.la + s.la) / 2) * (s.cx - L.cx);
      const d = Math.abs(s.cy - pred);
      if (d < bd) { bd = d; best = R; }
    }
    if (best) best.segs.push(s);
    else rows.push({ segs: [s] });
  }
  for (const R of rows) { const f = R.segs[0]; R.key = f.cy - Math.tan(f.la) * f.cx; }
  rows.sort((a, b) => a.key - b.key);
  return rows.map(R => {
    let out = '', prev = null;
    for (const s of R.segs) { if (prev) out += (s.x0 - prev.x1 > hMed * 1.5) ? '     ' : ' '; out += s.t; prev = s; }
    return out;
  }).join('\n');
}
