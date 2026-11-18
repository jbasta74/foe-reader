// Export všech textů panelu do CSV pro překladatele: sloupce cs; en; <další jazyky>.
// Použití: node tools/i18n-export.mjs [výstup.csv] [nový jazyk …]   (např. … translations.csv de)
import fs from 'node:fs';
import { loadDicts, toCsv } from './i18n-lib.mjs';

const [out = 'translations.csv', ...extra] = process.argv.slice(2);
const d = loadDicts();
const langs = [...new Set(['en', ...Object.keys(d).filter((l) => l !== 'en'), ...extra])];
const maps = Object.fromEntries(langs.map((l) => [l, new Map(d[l] || [])]));
const keys = [...new Map(d.en).keys()];
const rows = [['cs', ...langs], ...keys.map((k) => [k, ...langs.map((l) => maps[l].get(k) ?? '')])];
fs.writeFileSync(out, toCsv(rows));
const miss = langs.map((l) => `${l}: ${keys.filter((k) => !maps[l].get(k)).length} chybí`).join(', ');
console.log(`${out}: ${keys.length} frází (${miss})`);
