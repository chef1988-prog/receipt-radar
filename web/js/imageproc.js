// Image helpers: load (EXIF-aware), auto-detect receipt outline, perspective warp, enhance.

export async function loadImageToCanvas(blob, maxSide = 3200) {
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) {
    bmp = await new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(blob);
    });
  }
  const w = bmp.width, h = bmp.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}

export function rotateCanvas(src, dir /* 1 = cw, -1 = ccw */) {
  const c = document.createElement('canvas');
  c.width = src.height; c.height = src.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(dir * Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function grayOf(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const g = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return g;
}

function otsu(g) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length; let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

// Returns 4 corners [TL, TR, BR, BL] in source-canvas coordinates.
export function detectQuad(canvas) {
  const W = canvas.width, H = canvas.height;
  const fallback = () => {
    const ix = W * 0.04, iy = H * 0.03;
    return [{ x: ix, y: iy }, { x: W - ix, y: iy }, { x: W - ix, y: H - iy }, { x: ix, y: H - iy }];
  };
  const s = Math.min(1, 360 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, 0, 0, w, h);
  const g = grayOf(c);
  const thr = otsu(g);
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > thr ? 1 : 0;
  // erode 3x3 to cut thin bridges to bright background bits
  const er = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    er[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - w] & mask[i + w];
  }
  mask = er;
  // largest 4-connected component
  const lab = new Int32Array(w * h); let bestLab = 0, bestN = 0, cur = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i]) continue;
    cur++; let sp = 0, n = 0; stack[sp++] = i; lab[i] = cur;
    while (sp) {
      const p = stack[--sp]; n++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = cur; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = cur; stack[sp++] = p + w; }
    }
    if (n > bestN) { bestN = n; bestLab = cur; }
  }
  const frac = bestN / (w * h);
  if (frac < 0.06 || frac > 0.93) return fallback();
  let tl = [1e9, 0, 0], br = [-1e9, 0, 0], tr = [-1e9, 0, 0], bl = [1e9, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lab[y * w + x] !== bestLab) continue;
    const a = x + y, b = x - y;
    if (a < tl[0]) tl = [a, x, y];
    if (a > br[0]) br = [a, x, y];
    if (b > tr[0]) tr = [b, x, y];
    if (b < bl[0]) bl = [b, x, y];
  }
  const pad = 1.5; // compensate erosion
  const P = (p, dx, dy) => ({ x: Math.min(W, Math.max(0, (p[1] + dx * pad) / s)), y: Math.min(H, Math.max(0, (p[2] + dy * pad) / s)) });
  const q = [P(tl, -1, -1), P(tr, 1, -1), P(br, 1, 1), P(bl, -1, 1)];
  // sanity: quad must have reasonable area
  const area = Math.abs(polyArea(q));
  if (area < W * H * 0.05) return fallback();
  return q;
}

function polyArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p.x * n.y - n.x * p.y; }
  return a / 2;
}

function solve8(A, b) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
    [A[i], A[mx]] = [A[mx], A[i]]; [b[i], b[mx]] = [b[mx], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// homography mapping dst points -> src points
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i], { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve8(A, b);
  return [...h, 1];
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Perspective-correct the quad into a grayscale canvas about targetW wide.
export function warpGray(src, quad, targetW = 1500) {
  const [tl, tr, br, bl] = quad;
  const sw = Math.max(dist(tl, tr), dist(bl, br));
  const sh = Math.max(dist(tl, bl), dist(tr, br));
  let scale = Math.min(2.5, Math.max(0.4, targetW / sw));
  if (sh * scale > 9000) scale = 9000 / sh;
  const ow = Math.max(50, Math.round(sw * scale)), oh = Math.max(50, Math.round(sh * scale));
  const H = homography([{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }], quad);
  const g = grayOf(src); const SW = src.width, SH = src.height;
  const out = document.createElement('canvas'); out.width = ow; out.height = oh;
  const octx = out.getContext('2d');
  const img = octx.createImageData(ow, oh); const d = img.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const den = H[6] * x + H[7] * y + 1;
      const sx = (H[0] * x + H[1] * y + H[2]) / den, sy = (H[3] * x + H[4] * y + H[5]) / den;
      let v = 255;
      if (sx >= 0 && sy >= 0 && sx < SW - 1 && sy < SH - 1) {
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, i = y0 * SW + x0;
        v = (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + SW] * (1 - fx) + g[i + SW + 1] * fx) * fy;
      }
      const o = (y * ow + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function integral(g, w, h, sq) {
  const I = new Float64Array((w + 1) * (h + 1));
  const S = sq ? new Float64Array((w + 1) * (h + 1)) : null;
  for (let y = 0; y < h; y++) {
    let row = 0, rowS = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x]; row += v; if (sq) rowS += v * v;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
      if (sq) S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + rowS;
    }
  }
  return { I, S };
}

// mode: 'auto' (illumination-normalised gray), 'bw' (adaptive threshold), 'none'
export function enhance(canvas, mode = 'auto') {
  if (mode === 'none') return canvas;
  const w = canvas.width, h = canvas.height;
  const g = grayOf(canvas);
  const r = Math.max(12, Math.round(w / 22));
  const { I, S } = integral(g, w, h, mode === 'bw');
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const W1 = w + 1;
  const vals = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const mean = sum / n;
      const v = g[y * w + x];
      if (mode === 'bw') {
        const s2 = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
        const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
        const t = mean * (1 + 0.18 * (sd / 128 - 1));
        vals[y * w + x] = v > t ? 255 : 0;
      } else {
        // background estimate ~ local mean pushed toward paper brightness
        vals[y * w + x] = Math.min(1.25, v / (mean * 1.08 + 1)) * 255;
      }
    }
  }
  if (mode !== 'bw') {
    // contrast stretch using percentiles
    const hist = new Uint32Array(320);
    for (let i = 0; i < vals.length; i++) hist[Math.min(319, vals[i] | 0)]++;
    const pct = (p) => { let acc = 0; const lim = vals.length * p; for (let i = 0; i < 320; i++) { acc += hist[i]; if (acc >= lim) return i; } return 319; };
    const lo = pct(0.01), hi = Math.max(lo + 30, pct(0.55));
    for (let i = 0; i < vals.length; i++) vals[i] = Math.max(0, Math.min(255, (vals[i] - lo) * 255 / (hi - lo)));
  }
  for (let i = 0, o = 0; i < vals.length; i++, o += 4) { d[o] = d[o + 1] = d[o + 2] = vals[i]; d[o + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function thumbnail(canvas, maxW = 520, quality = 0.62) {
  const s = Math.min(1, maxW / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// stack several canvases vertically (multi-part long receipts)
export function stackCanvases(list) {
  if (list.length === 1) return list[0];
  const w = Math.max(...list.map(c => c.width));
  const h = list.reduce((a, c) => a + c.height, 0);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  let y = 0; for (const c of list) { ctx.drawImage(c, 0, y); y += c.height; }
  return out;
}

// Unsharp mask (helps with slightly blurred photos)
export function sharpen(canvas, amount = 1.0, radius = 3) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, w, h); const d = src.data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = d[i];
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d'); const img = octx.createImageData(w, h); const o = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
      const v = Math.max(0, Math.min(255, g[y * w + x] + amount * (g[y * w + x] - m)));
      const k = (y * w + x) * 4; o[k] = o[k + 1] = o[k + 2] = v; o[k + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

export function scaleCanvas(canvas, targetW) {
  const s = targetW / canvas.width;
  const c = document.createElement('canvas'); c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}
