// Společné funkce pro export / import překladů (node tools/i18n-export.mjs, node tools/i18n-import.mjs).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Načte i18n.js a všechny i18n-<jazyk>.js → { en: [[cs, en]…], pl: […], … }
export function loadDicts() {
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const files = ['i18n.js', ...fs.readdirSync(ROOT).filter((f) => /^i18n-[a-z]{2}\.js$/.test(f)).sort()];
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const d = ctx.FOE_I18N;
  return Object.fromEntries(Object.entries(d).filter(([, v]) => Array.isArray(v)));
}

// CSV se středníkem (Excel v CZ/PL), UTF-8 s BOM.
const q = (s) => (/[;"\n\r]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map((c) => q(c ?? '')).join(';')).join('\r\n') + '\r\n';

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

// Zapíše i18n-<jazyk>.js z dvojic [cs, překlad].
export function writeLang(lang, pairs) {
  const js = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const out = `// FoE Reader – i18n-${lang}.js (vygenerováno: node tools/i18n-import.mjs)
// Překlad panelu do jazyka „${lang}“. Klíč = český text z kódu, chybějící fráze se zobrazí anglicky.
globalThis.FOE_I18N.${lang} = [
${pairs.map(([k, v]) => `  [${js(k)}, ${js(v)}],`).join('\n')}
];
`;
  fs.writeFileSync(path.join(ROOT, `i18n-${lang}.js`), out);
}
