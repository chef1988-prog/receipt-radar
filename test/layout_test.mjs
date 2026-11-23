import { groupWords, groupSegments } from '../web/js/layout.js';
const NOISE = +(process.argv[2] || 0);
// Simulate ML Kit pieces for a 30-item receipt: name on the left, price on the right, then distort.
function sim(tiltDeg, curl, tiltDrift, seed) {
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const W = 1500, rowH = 40, th = 26, segs = [], truth = [];
  const xf = (x, y) => {
    const t = (tiltDeg + tiltDrift * (y / 1300)) * Math.PI / 180;
    const dy = Math.tan(t) * x + curl * Math.pow(x / W - 0.5, 2) * 4;
    return [x, y + dy];
  };
  for (let i = 0; i < 30; i++) {
    const y = 100 + i * rowH, name = `ITEM${i} ` + 'X'.repeat(4 + Math.floor(rnd() * 12)), price = `${(1 + i * 0.37).toFixed(2).replace('.', ',')} A`;
    truth.push(name + '|' + price);
    const nx1 = 40 + name.length * 22;
    for (const [t, x0, x1] of [[name, 40, nx1], [price, 1280, 1440]]) {
      const P = [...xf(x0, y), ...xf(x1, y), ...xf(x1, y + th), ...xf(x0, y + th)].map(v => v + (rnd() - 0.5) * 2 * NOISE);
      const xs = [P[0], P[2], P[4], P[6]], ys = [P[1], P[3], P[5], P[7]];
      segs.push({ t, p: P, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  return { segs: segs.sort(() => rnd() - 0.5), truth };
}
const score = (text, truth) => truth.filter(tr => { const [n, p] = tr.split('|'); return text.split('\n').some(l => l.includes(n) && l.includes(p)); }).length;
console.log('tilt  curl drift | old  new  (rows correctly paired, of 30)');
for (const [tilt, curl, drift] of [[1, 10, 0], [0.5, 40, 0], [0, 0, 0], [0.5, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [1, 15, 0], [0, 25, 1.5], [2, 20, -2], [-1.5, 30, 1]]) {
  let o = 0, n = 0;
  for (let s = 1; s <= 5; s++) {
    const { segs, truth } = sim(tilt, curl, drift, s * 7919);
    o += score(groupWords(segs.map(g => ({ t: g.t, x0: g.b[0], y0: g.b[1], x1: g.b[2], y1: g.b[3] }))), truth);
    n += score(groupSegments(segs), truth);
  }
  console.log(`${String(tilt).padStart(4)} ${String(curl).padStart(5)} ${String(drift).padStart(5)} | ${(o / 5).toFixed(0).padStart(3)}  ${(n / 5).toFixed(0).padStart(3)}`);
}
