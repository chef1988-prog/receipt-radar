import { parseReceipt } from '../web/js/parser.js';
import fs from 'fs';
const file = process.argv[2] || 'truth_texts.json';
const texts = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const [k, t] of Object.entries(texts)) {
  const r = parseReceipt(t, { now: new Date('2026-11-21') });
  console.log(`\n== ${k}: store=${r.store} date=${r.date} total=${r.total} sum=${r.sum} ${r.warnings.join('; ')}`);
  for (const it of r.items) console.log(`   ${it.name.padEnd(32)} ${String(it.qty).padStart(6)} ${it.unit} x ${it.unitPrice?.toFixed(2)}  = ${it.price.toFixed(2)} ${it.discount ? 'disc ' + it.discount : ''}${it.deposit ? ' [deposit]' : ''}`);
}
