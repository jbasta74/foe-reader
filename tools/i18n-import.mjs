// Import překladu z CSV (export z i18n-export.mjs) → i18n-<jazyk>.js.
// Použití: node tools/i18n-import.mjs translations.csv pl
// Nový jazyk je pak potřeba přidat do manifest.json (za i18n.js), do test/harness.html a do přepínače jazyka (panel-stats.js, panel-core.js).
import fs from 'node:fs';
import { loadDicts, parseCsv, writeLang } from './i18n-lib.mjs';

const [file, lang] = process.argv.slice(2);
if (!file || !/^[a-z]{2}$/.test(lang || '') || lang === 'cs' || lang === 'en') {
  console.error('Použití: node tools/i18n-import.mjs translations.csv <jazyk, např. pl>'); process.exit(1);
}
const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
const col = (c) => head.findIndex((h) => h.trim().split(/\s/)[0].toLowerCase() === c); // „cs (klíč – neměnit)“ = cs
const ci = col('cs'), li = col(lang);
if (ci < 0 || li < 0) { console.error(`V CSV chybí sloupec cs nebo ${lang}`); process.exit(1); }
const known = new Set(loadDicts().en.map(([k]) => k));
const pairs = [], unknown = [];
for (const r of rows) {
  const k = r[ci], v = r[li];
  if (!k || !v) continue;
  if (!known.has(k)) { unknown.push(k); continue; }
  pairs.push([k, v]);
}
writeLang(lang, pairs);
console.log(`i18n-${lang}.js: ${pairs.length} / ${known.size} frází` + (unknown.length ? `; ${unknown.length} neznámých klíčů vynecháno (text v kódu se mezitím změnil?): ${unknown.slice(0, 5).join(' | ')}` : ''));
