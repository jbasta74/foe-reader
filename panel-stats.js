// FoE Reader – panel-stats.js
// Grafy, přehled cechu, můj vývoj, záložka Statistiky, seznam záložek.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ---------- Grafy (SVG bez knihoven; popisek po najetí myší přes data-tip) ----------
let statView = 'own', statArea = 'gbg';
const SER_COL = ['#c0392b', '#e67e22', '#2e6db4', '#16a085'];
const kfmt = (n) => { const a = Math.abs(n), c = (x) => x.toFixed(1).replace('.', ',').replace(',0', '');
  return a >= 1e9 ? c(n / 1e9) + ' mld' : a >= 1e6 ? c(n / 1e6) + ' mil' : a >= 1e4 ? c(n / 1e3) + ' tis' : fmt(Math.round(n)); };
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || Math.abs(hi) || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
  const t = [], top = Math.ceil(hi / step - 1e-9) * step;
  for (let v = Math.floor(lo / step) * step; v <= top + step * 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}
// labels: popisky osy x; series: [{name, color, values:[číslo|null]}]; type: 'line' | 'bar'
function svgChart({ labels, series, type = 'line', height = 170, unit = '' }) {
  const n = labels.length;
  const vals = series.flatMap((x) => x.values).filter((v) => v != null);
  if (!n || !vals.length) return '<p class="muted">Zatím málo dat.</p>';
  const W = 560, H = height, L = 52, R = 8, T = 8, B = 20, iw = W - L - R, ih = H - T - B;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (type === 'bar') { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) { lo -= Math.abs(lo) * 0.05 || 1; hi += Math.abs(hi) * 0.05 || 1; }
  const ticks = niceTicks(lo, hi); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const y = (v) => T + ih - ((v - lo) / (hi - lo)) * ih;
  const bw = iw / n, x = (i) => (type === 'bar' ? L + bw * (i + 0.5) : n === 1 ? L + iw / 2 : L + (i * iw) / (n - 1));
  let g = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#e3d6bb"/>
    <text x="${L - 5}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a7a60">${esc(kfmt(t))}</text>`).join('');
  const every = Math.max(1, Math.ceil(n / 7));
  g += labels.map((l, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${n > 1 && type !== 'bar' ? (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') : 'middle'}" font-size="10" fill="#8a7a60">${esc(l)}</text>` : '').join('');
  if (type === 'bar') {
    const s0 = series[0];
    g += s0.values.map((v, i) => v == null ? '' : `<rect x="${(x(i) - bw * 0.35).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}"
      height="${Math.max(1, Math.abs(y(v) - y(0))).toFixed(1)}" rx="2" fill="${v < 0 ? '#c0392b' : s0.color}"/>`).join('');
  } else {
    for (const sr of series) {
      const pts = sr.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`));
      const segs = []; let cur = [];
      for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
      if (cur.length) segs.push(cur);
      g += segs.map((sg) => `<polyline fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" points="${sg.join(' ')}"/>`).join('');
      if (n <= 40) g += sr.values.map((v, i) => (v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${sr.color}"/>`)).join('');
    }
  }
  // sloupce pro popisek
  g += labels.map((l, i) => {
    const tip = `<b>${esc(l)}</b>` + series.map((sr) => sr.values[i] == null ? '' : `<br><span style="color:${sr.color}">●</span> ${esc(sr.name)}: <b>${fmt(Math.round(sr.values[i]))}${unit}</b>`).join('');
    const cx = type === 'bar' ? x(i) - bw / 2 : n === 1 ? L : x(i) - iw / (n - 1) / 2;
    const cw = type === 'bar' ? bw : n === 1 ? iw : iw / (n - 1);
    return `<rect class="hov" x="${Math.max(L, cx).toFixed(1)}" y="${T}" width="${Math.min(cw, W - R - Math.max(L, cx)).toFixed(1)}" height="${ih}" data-tip="${esc(tip)}"/>`;
  }).join('');
  const legend = series.length > 1 ? `<div class="legend">${series.map((sr) => `<span><i style="background:${sr.color}"></i>${esc(sr.name)}</span>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>${legend}`;
}
const AREA_LBL = { all: 'Všude', gbg: 'GBG', ge: 'Expedice', qi: 'QI' };
const ARMY_NAMES = ['Útok útočníka', 'Obrana útočníka', 'Útok obránce', 'Obrana obránce'];
function armyChart(daysArr, snapOf) {
  return `<div class="seg">${Object.entries(AREA_LBL).map(([k, l]) => `<button class="fbtn ${statArea === k ? 'on' : ''}" data-statarea="${k}">${l}</button>`).join('')}</div>
    ${svgChart({ labels: daysArr.map(shortDate), unit: ' %', series: ARMY_NAMES.map((nm, i) => ({ name: nm, color: SER_COL[i], values: daysArr.map((d) => snapOf(d).army?.[statArea]?.[i] ?? null) })) })}`;
}
function tile(label, big, sub, cls = '') {
  return `<div class="tile"><div class="tl">${label}</div><div class="tb">${big}</div>${sub ? `<div class="ts ${cls}">${sub}</div>` : ''}</div>`;
}
const signed = (n) => (n > 0 ? '+' : '') + (Math.abs(n) >= 1e5 ? kfmt(n) : fmt(Math.round(n)));
// ---------- Přehled cechu ----------
let guildPer = 7, guildSort = 'score', guildSel = null;
const GUILD_COLS = [
  ['score', 'Body', true], ['gbgF', 'GBG boje*', true], ['gbgA', 'Opotř.', false], ['geP', 'Exp. body', true], ['geE', 'Exp. setkání', true], ['qiA', 'QI akce', true], ['qiP', 'QI postup', true],
];
const gval = (x, k) => (x == null ? null : k === 'gbgF' ? (x.gbgB != null ? x.gbgB + 2 * (x.gbgN || 0) : null) : x[k] ?? null);
function viewGuild(D) {
  const g = D.guild || { names: {}, days: {} };
  const days = Object.keys(g.days).sort();
  if (!days.length) return '<p class="muted">Zatím žádná data. Otevřete ve hře přehled cechu (členové), žebříček GBG, žebříček expedice nebo aktivitu QI – každé otevření se uloží jako denní snímek.</p>';
  const last = days[days.length - 1];
  const cutoff = dayKey(new Date(last).getTime() - guildPer * 864e5);
  const base = days.filter((d) => d <= cutoff).pop() || days[0];
  const members = S.clan?.members?.length ? S.clan.members.map(String) : Object.keys(g.days[last]);
  // poslední známá hodnota člena (údaje chodí z různých obrazovek v různé dny)
  const latest = (pid, upTo) => { const o = {}; for (const d of days) { if (d > upTo) break; Object.assign(o, g.days[d][pid] || {}); } return o; };
  const rows = members.map((pid) => {
    const cur = latest(pid, last), old = latest(pid, base);
    const r = { pid, name: g.names[pid] || `#${pid}`, era: cur.era, active: cur.active };
    for (const [k] of GUILD_COLS) {
      const v = gval(cur, k), o = gval(old, k);
      r[k] = v;
      // sezónní čítače (GBG, expedice) se nulují: záporný rozdíl = nová sezóna, přírůstek = aktuální hodnota
      r['d' + k] = v == null || o == null || base === last ? null : v - o < 0 ? v : v - o;
    }
    return r;
  }).sort((a, b) => (b['d' + guildSort] ?? b[guildSort] ?? -1) - (a['d' + guildSort] ?? a[guildSort] ?? -1));
  const per = [[1, 'od včera'], [7, '7 dní'], [30, '30 dní']];
  let h = `<p>Přírůstek za: ${per.map(([n, l]) => `<button class="fbtn ${guildPer === n ? 'on' : ''}" data-guildper="${n}">${l}</button>`).join('')}
    <span class="muted">(srovnání s ${esc(shortDate(base))}, poslední údaje ${esc(shortDate(last))})</span></p>
    <table class="log"><thead><tr><th>Člen</th>${GUILD_COLS.map(([k, l]) => `<th class="num" style="cursor:pointer" data-guildsort="${k}">${l}${guildSort === k ? ' ▼' : ''}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr data-guildpid="${esc(r.pid)}" class="${String(guildSel) === r.pid ? 'sel' : ''}"><td>${esc(r.name)}${r.active === false ? ' <span class="muted">(neaktivní)</span>' : ''}${r.era ? `<br><span class="muted" style="font-size:10px">${esc(ERA[r.era] || r.era)}</span>` : ''}</td>${
      GUILD_COLS.map(([k, , showD]) => `<td class="num">${r[k] == null ? '<span class="muted">–</span>' : k === 'score' ? kfmt(r[k]) : fmt(r[k])}${showD && r['d' + k] ? `<br><span class="${r['d' + k] > 0 ? 'up' : 'down'}" style="font-size:10px">${signed(r['d' + k])}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="muted">* GBG boje = bitvy + 2 × vyjednávání (za sezónu). Údaje se doplňují, když ve hře otevřete přehled cechu, žebříček GBG, žebříček expedice nebo aktivitu QI. Zeleně přírůstek za zvolené období; klik na člena ukáže vývoj, klik na hlavičku seřadí.</p>`;
  const sel = guildSel != null && members.includes(String(guildSel)) ? String(guildSel) : null;
  if (sel) {
    const ds = days.filter((d) => g.days[d][sel]);
    const vals = (k) => ds.map((d) => gval(latest(sel, d), k));
    h += `<h4>${esc(g.names[sel] || sel)} – vývoj</h4>
      ${svgChart({ labels: ds.map(shortDate), series: [{ name: 'Body', color: '#8a4b12', values: vals('score') }] })}
      ${svgChart({ labels: ds.map(shortDate), series: [{ name: 'GBG boje (sezóna)', color: '#c0392b', values: vals('gbgF') }, { name: 'Exp. body', color: '#2e6db4', values: vals('geP').map((v) => (v == null ? null : v / 100)) }, { name: 'QI akce', color: '#16a085', values: vals('qiA') }], height: 150 })}
      <p class="muted">Exp. body v grafu děleno 100 (kvůli měřítku).</p>`;
  }
  return h;
}
function viewOwnStats(D) {
  const days = Object.keys(D.own).sort();
  if (!days.length) return '<p class="muted">První záznam se uloží chvíli po načtení hry.</p>';
  const sn = (d) => D.own[d], first = sn(days[0]), last = sn(days[days.length - 1]);
  const scoreDays = days.filter((d) => sn(d).score != null);
  const sc0 = scoreDays.length ? sn(scoreDays[0]).score : null, sc1 = scoreDays.length ? sn(scoreDays[scoreDays.length - 1]).score : null;
  const nd = scoreDays.length > 1 ? (new Date(scoreDays[scoreDays.length - 1]) - new Date(scoreDays[0])) / 864e5 : 0;
  const gbg0 = first.army?.gbg?.[0], gbg1 = last.army?.gbg?.[0];
  const lv0 = gbLevels(first), lv1 = gbLevels(last);
  const grown = (last.gb || []).filter((g) => { const o = (first.gb || []).find((x) => x.id === g.id); return o && g.l > o.l; }).length;
  let h = `<div class="tiles">
    ${tile(`Skóre k ${esc(shortDate(scoreDays[scoreDays.length - 1] || days[days.length - 1]))}`, sc1 != null ? kfmt(sc1) : '–', sc1 != null && scoreDays.length > 1 ? `${signed(sc1 - sc0)} od ${esc(shortDate(scoreDays[0]))}` : '', 'up')}
    ${tile('Průměrný přírůstek skóre za den', nd ? kfmt((sc1 - sc0) / nd) : '–', nd ? `za ${fmt(Math.round(nd))} dní` : 'potřeba aspoň 2 dny')}
    ${tile('Útok útočníka v GBG', gbg1 != null ? fmt(gbg1) + ' %' : '–', days.length > 1 && gbg0 != null ? `${signed(gbg1 - gbg0)} b. od prvního dne` : '', gbg1 >= gbg0 ? 'up' : 'down')}
    ${tile('Úrovně Velkých budov', fmt(lv1), days.length > 1 ? `${signed(lv1 - lv0)} (rostlo ${grown} VB)` : '', 'up')}
  </div>`;
  if (scoreDays.length) {
    h += `<h4>Celkové skóre</h4>${svgChart({ labels: scoreDays.map(shortDate), series: [{ name: 'Skóre', color: '#8a4b12', values: scoreDays.map((d) => sn(d).score) }] })}`;
    if (scoreDays.length > 1) {
      const gl = scoreDays.slice(1), gv = gl.map((d, i) => sn(d).score - sn(scoreDays[i]).score);
      h += `<h4>Přírůstek skóre mezi snímky</h4>${svgChart({ labels: gl.map(shortDate), type: 'bar', height: 140, series: [{ name: 'Přírůstek', color: '#b5651d', values: gv }] })}`;
    }
  }
  h += `<h4>Bonusy armády</h4>${armyChart(days, sn)}`;
  h += `<h4>Velké budovy</h4><table><thead><tr><th>Budova</th><th class="num">${esc(shortDate(days[0]))}</th><th class="num">${esc(shortDate(days[days.length - 1]))}</th><th class="num">Změna</th><th class="num">Max.</th></tr></thead><tbody>${
    (last.gb || []).slice().sort((a, b) => b.l - a.l).map((g) => { const o = (first.gb || []).find((x) => x.id === g.id);
      return `<tr><td>${esc(g.n)}</td><td class="num">${o ? o.l : '–'}</td><td class="num"><b>${g.l}</b></td><td class="num">${o && g.l > o.l ? `<span class="up">+${g.l - o.l}</span>` : ''}</td><td class="num muted">${g.m ?? ''}</td></tr>`; }).join('')}</tbody></table>`;
  h += `<details><summary class="muted">Tabulka po dnech</summary>
    <table><thead><tr><th>Den</th><th class="num">Skóre</th><th class="num">Všude útok / obr.</th><th class="num">GBG útok / obr.</th><th class="num">Exp. útok / obr.</th><th class="num">VB Σ</th></tr></thead><tbody>${
      days.slice().reverse().slice(0, 120).map((d, i, arr) => { const x = sn(d), pv = D.own[arr[i + 1]];
        return `<tr><td>${esc(shortDate(d))}</td><td class="num">${x.score != null ? fmt(x.score) : ''}</td><td class="num">${pair(x.army?.all)}</td>
          <td class="num">${pair(x.army?.gbg)}${diff(x.army?.gbg?.[0], pv?.army?.gbg?.[0])}</td><td class="num">${pair(x.army?.ge)}</td>
          <td class="num">${fmt(gbLevels(x))}${diff(gbLevels(x), pv && gbLevels(pv))}</td></tr>`; }).join('')}</tbody></table></details>`;
  return h;
}

function armyTable(a) {
  return `<table><thead><tr><th>Oblast</th><th>Útok útočníka</th><th>Obrana útočníka</th><th>Útok obránce</th><th>Obrana obránce</th></tr></thead><tbody>${
    [['all', 'Všude'], ['gbg', 'GBG'], ['ge', 'Expedice'], ['qi', 'Kvantové invaze']].map(([k, l]) =>
      `<tr><td>${l}</td>${(a?.[k] || []).map((v) => `<td class="num">${fmt(v)} %</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function gbChips(sn, prev) {
  const pl = new Map((prev?.gb || []).map((g) => [g.id, g.l]));
  return (sn.gb || []).map((g) => `<span class="chip">${esc(g.n)} <b>${g.l}</b>${pl.has(g.id) && pl.get(g.id) !== g.l ? `<span class="up"> +${g.l - pl.get(g.id)}</span>` : ''}</span>`).join('') || '<span class="muted">žádné</span>';
}
function visitCard(sn, prev) {
  const arc = sn.arc?.c ? ` · Archa ${fmt(sn.arc.c)} %${sn.arc.g ? ` (zlatá ${fmt(sn.arc.g)} %)` : ''}` : '';
  return `<div class="cfg"><div><b>${esc(sn.name || '?')}</b>${sn.guild ? ` · ${esc(sn.guild)}` : ''}${sn.era ? ` · ${esc(ERA[sn.era] || sn.era)}` : ''}${sn.score != null ? ` · ${fmt(sn.score)} bodů` : ''}${arc}</div>
    ${armyTable(sn.army)}
    <div>VB (${(sn.gb || []).length}, Σ úrovní ${fmt(gbLevels(sn))}): ${gbChips(sn, prev)}</div>
    <div class="muted">Odhad z budov ve městě${sn.gbBonus ? ' a bonusů VB' : ' (bonusy VB hra u cizích měst neposlala)'} – bez spojenců, předmětů a hradu.
      ${sn.unknown ? `Chybí metadata u ${sn.unknown} z ${sn.known + sn.unknown} budov (hra je načítá postupně, odhad se může ještě zpřesnit).` : ''}</div></div>`;
}
function viewStats() {
  const st = globalThis.FOE_STATS;
  if (!st?.ready()) return '<p class="muted">Statistiky se začnou ukládat po načtení hry (F5).</p>';
  const D = st.data(), f = st.folder();
  const store = f.name ? (f.perm === 'granted' ? `složka <b>${esc(f.name)}</b>${f.last ? ` (synchronizováno ${new Date(f.last).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })})` : ''}`
    : `složka <b>${esc(f.name)}</b> – <button data-act="stgrant">Povolit přístup</button>`) : 'jen v tomto prohlížeči (složku pro sdílení mezi počítači nastavíte v ℹ️)';
  let h = `<p>${[['own', 'Můj vývoj'], ['guild', 'Cech'], ['visits', `Navštívená města (${Object.keys(D.visits).length})`]].map(([k, l]) => `<button class="fbtn ${statView === k ? 'on' : ''}" data-statview="${k}">${l}</button>`).join('')}</p>`;
  const foot = `<p style="margin-top:8px"><button data-act="stcsvown">CSV – můj vývoj</button> <button data-act="stcsvvis">CSV – navštívená města</button>
    <button data-act="stjson">Záloha (JSON)</button> <button data-act="stimport">Načíst zálohu…</button><input type="file" accept=".json,application/json" data-stimport style="display:none"></p>
    <p class="muted">Ukládání: ${store}${f.error ? ` · <span class="hi">${esc(f.error)}</span>` : ''}. CSV se otevře v Excelu (oddělovač středník). Záloha i načtení slučují data – nic se nepřepíše starším.</p>${statMsg ? `<p class="hi">${esc(statMsg)}</p>` : ''}`;
  if (statView === 'own') return h + viewOwnStats(D) + foot;
  if (statView === 'guild') return h + viewGuild(D) + foot;
  // --- navštívená města ---
  if (S.visit?.snap) {
    const hist = D.visits[S.visit.pid];
    const days = hist ? Object.keys(hist.days).sort() : [];
    const prev = days.length > 1 ? hist.days[days[days.length - 2]] : null;
    h += `<h4>Právě navštívené město</h4>${visitCard(S.visit.snap, prev)}`;
  }
  const q = statFilter.trim().toLowerCase();
  const players = Object.entries(D.visits).map(([pid, v]) => {
    const days = Object.keys(v.days).sort();
    return { pid, name: v.name, days, last: v.days[days[days.length - 1]] };
  }).filter((p) => p.last && (!q || `${p.name} ${p.last.guild || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => b.last.t - a.last.t);
  h += `<h4>Navštívená města (${Object.keys(D.visits).length})</h4>
    <div class="copyrow" style="margin-bottom:4px"><input class="pname" data-input="statFilter" placeholder="Hledat hráče nebo cech" value="${esc(statFilter)}"></div>`;
  if (!players.length) h += '<p class="muted">Zatím žádná – navštivte město jiného hráče (otevřít jeho město ve hře).</p>';
  else {
    h += `<table class="log"><thead><tr><th>Hráč</th><th>Cech</th><th class="num">GBG útok / obr.</th><th class="num">Exp. útok / obr.</th><th class="num">VB Σ</th><th>Naposledy</th></tr></thead><tbody>${
      players.slice(0, 200).map((p) => `<tr data-statpid="${esc(p.pid)}" class="${String(statSel) === p.pid ? 'sel' : ''}"><td>${esc(p.name || '?')}</td><td>${esc(p.last.guild || '')}</td>
        <td class="num">${pair(p.last.army?.gbg)}</td><td class="num">${pair(p.last.army?.ge)}</td><td class="num">${fmt(gbLevels(p.last))}</td>
        <td class="muted">${esc(shortDate(p.days[p.days.length - 1]))}${p.days.length > 1 ? ` (${p.days.length}×)` : ''}</td></tr>`).join('')}</tbody></table>`;
    const sel = statSel != null && D.visits[statSel];
    if (sel) {
      const days = Object.keys(sel.days).sort();
      const last = sel.days[days[days.length - 1]];
      const isNow = S.visit?.snap && String(S.visit.pid) === String(statSel);
      h += `<h4>${esc(sel.name || '?')} – vývoj</h4>${isNow ? '' : visitCard(last, days.length > 1 ? sel.days[days[days.length - 2]] : null)}`;
      if (days.length < 2) h += '<p class="muted">Zatím jen jedna návštěva – vývoj bude vidět po další návštěvě v jiný den.</p>';
      if (days.length > 1) {
        h += armyChart(days, (d) => sel.days[d]);
        h += `<table><thead><tr><th>Den</th><th class="num">GBG útok / obr.</th><th class="num">Exp. útok / obr.</th><th class="num">Všude útok / obr.</th><th class="num">VB Σ</th></tr></thead><tbody>${
          days.slice().reverse().map((d, i, arr) => { const sn = sel.days[d], pv = sel.days[arr[i + 1]];
            return `<tr><td>${esc(shortDate(d))}</td><td class="num">${pair(sn.army?.gbg)}${diff(sn.army?.gbg?.[0], pv?.army?.gbg?.[0])}</td>
              <td class="num">${pair(sn.army?.ge)}</td><td class="num">${pair(sn.army?.all)}</td><td class="num">${fmt(gbLevels(sn))}${diff(gbLevels(sn), pv && gbLevels(pv))}</td></tr>`; }).join('')}</tbody></table>`;
      }
    }
  }
  return h + foot;

}
function saveText(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvArmy = (a) => ['all', 'gbg', 'ge', 'qi'].flatMap((k) => a?.[k] || ['', '', '', '']);
const CSV_ARMY_HEAD = ['Všude', 'GBG', 'Expedice', 'QI'].flatMap((a) => [`${a} útok útočníka`, `${a} obrana útočníka`, `${a} útok obránce`, `${a} obrana obránce`]);
function exportCsv(kind) {
  const D = FOE_STATS.data();
  const rows = [];
  if (kind === 'own') {
    rows.push(['Den', 'Věk', ...CSV_ARMY_HEAD, 'Počet VB', 'Součet úrovní VB', 'FP bonus', 'Zboží bonus', 'Archa %', ...[]]);
    for (const d of Object.keys(D.own).sort()) { const s = D.own[d]; rows.push([d, s.era, ...csvArmy(s.army), (s.gb || []).length, gbLevels(s), s.fp, s.goods, s.arc?.c]); }
  } else {
    rows.push(['Hráč', 'ID', 'Den', 'Cech', 'Věk', 'Body', ...CSV_ARMY_HEAD, 'Počet VB', 'Součet úrovní VB', 'Archa %']);
    for (const [pid, v] of Object.entries(D.visits)) for (const d of Object.keys(v.days).sort()) {
      const s = v.days[d]; rows.push([s.name || v.name, pid, d, s.guild, s.era, s.score, ...csvArmy(s.army), (s.gb || []).length, gbLevels(s), s.arc?.c]);
    }
  }
  saveText(`foe-reader-${D.world}-${kind === 'own' ? 'muj-vyvoj' : 'navstivena-mesta'}-${dayKey()}.csv`, '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n'), 'text/csv');
}
function storageSettingsHtml() {
  const st = globalThis.FOE_STATS;
  if (!st) return '';
  const f = st.folder();
  const status = !f.supported
    ? `<div class="muted">Tento prohlížeč výběr složky nepodporuje. V Brave ho zapnete v <code>brave://flags/#file-system-access-api</code> (pak restart prohlížeče). Do té doby použijte v Statistikách Zálohu / Načíst zálohu.</div>`
    : f.name
      ? `<div>Složka: <b>${esc(f.name)}</b> · ${f.perm === 'granted' ? `přístup povolen${f.last ? `, synchronizováno ${new Date(f.last).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}` : '<span class="hi">přístup je potřeba znovu povolit</span>'}</div>
         <div>${f.perm === 'granted' ? '<button data-act="stsync">Synchronizovat teď</button>' : '<button data-act="stgrant">Povolit přístup</button>'} <button data-act="stpick">Změnit složku…</button> <button data-act="stforget">Odpojit složku</button></div>`
      : `<div><button data-act="stpick">Vybrat složku…</button> <span class="muted">např. složka ve OneDrive, Google Drive nebo iCloud Drive</span></div>`;
  return `<h4>Nastavení – ukládání statistik</h4>
    <div class="cfg">${status}${f.error ? `<div class="hi">${esc(f.error)}</div>` : ''}
      <div class="muted">Data se ukládají vždy v prohlížeči. Ve vybrané složce je navíc soubor <code>${esc(st.fileName() || 'foe-reader-<svět>-<hráč>.json')}</code> a <code>foe-reader-nastaveni.json</code>;
      když stejnou (synchronizovanou) složku vyberete i na druhém počítači, data se při každém uložení sloučí. Po restartu prohlížeče může Chrome chtít přístup povolit znovu
      (při povolení zvolte „Povolit při každé návštěvě“). Nastavení panelu se navíc synchronizuje přes účet prohlížeče.</div></div>`;
}

function viewAbout() {
  const world = location.hostname.split('.')[0];
  return `<h4>FoE Reader ${esc(VERSION)}</h4>
    <p>Pasivně čte komunikaci Forge of Empires a zobrazuje přehledy. Na server nic neposílá a nic ve hře nemění.</p>
    <table><tbody>
      <tr><td>Verze</td><td><b>${esc(VERSION)}</b></td></tr>
      <tr><td>Zdrojový kód</td><td><a href="${REPO}" target="_blank" rel="noopener">${REPO.replace('https://', '')}</a></td></tr>
      <tr><td>Vydání a seznam změn</td><td><a href="${REPO}/releases" target="_blank" rel="noopener">Releases</a></td></tr>
      <tr><td>Nahlásit chybu / nápad</td><td><a href="${REPO}/issues" target="_blank" rel="noopener">Issues</a></td></tr>
      <tr><td>Svět</td><td>${esc(world)}${S.player ? ` · ${esc(S.player.user_name)}` : ''}</td></tr>
      <tr><td>Zachyceno zpráv</td><td>${fmt([...S.log.values()].reduce((a, l) => a + l.count, 0))} (${S.log.size} druhů)</td></tr>
    </tbody></table>
    <h4>Jazyk / Language</h4>
    <div class="cfg"><div>${[['cs', 'Čeština'], ['en', 'English']].map(([k, l]) => `<button data-lang="${k}" class="fbtn${(cfg.lang || 'cs') === k ? ' on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="muted">Názvy z hry (budovy, zboží, hráči) zůstávají v jazyce hry. / Names from the game stay in the game's language.</div></div>
    <h4>Nastavení – zobrazené záložky</h4>
    <div class="cfg"><div>${TABS.filter(([id]) => !FIXED_TABS.includes(id) && (!BONUS_TABS.includes(id) || bonusOn())).map(([id, l]) =>
      `<label><input type="checkbox" data-tabtoggle="${id}" ${tabVisible(id) ? 'checked' : ''}> ${l}</label>`).join(' ')}</div>
      <div class="muted">VB, Upozornění a ℹ️ zůstávají vždy. Vypnutá záložka jen zmizí z lišty – data se sbírají dál a upozornění fungují.</div>
      <div>${['uiBar', 'barVertical'].map((k) => `<label><input type="checkbox" data-cfg="${k}" ${cfg[k] ? 'checked' : ''}> ${k === 'uiBar' ? 'nástrojová lišta s ikonami' : 'lišta svisle'}</label>`).join(' ')}
        <span class="muted">Ikona otevře / zavře okno záložky, ⠿ otevře panel se záložkami.</span></div>
      <div><button data-act="resetsize">Obnovit výchozí velikost panelu</button> <span class="muted">Panel se dá roztáhnout tažením za pravý dolní roh.</span></div></div>
    ${bonusOn() ? storageSettingsHtml() : ''}
    <h4>Bonusové funkce</h4>
    <div class="cfg">${bonusOn() ? '<div>Odemčeno ✓ – záložka Statistiky a ukládání do složky.</div>'
      : `<div class="copyrow"><input class="pname" data-input="bonusCode" placeholder="Bonusový kód" value="${esc(bonusCode)}"> <button data-act="bonusunlock">Odemknout</button></div>${bonusMsg ? `<div class="hi">${esc(bonusMsg)}</div>` : ''}`}</div>
    <p class="muted">Aktualizace: stáhněte novou verzi (git pull nebo ZIP z Releases), v chrome://extensions klikněte u rozšíření na obnovit a ve hře dejte F5.</p>
    <p class="muted">Názvy a sousednost provincií GBG pocházejí z projektu FoE Helper (AGPL-3.0).</p>`;
}

let selectedKey = null;
function viewLog() {
  const rows = [...S.log.entries()].sort((a, b) => b[1].time - a[1].time);
  let detail = '';
  if (selectedKey && S.log.has(selectedKey)) {
    let txt = JSON.stringify(S.log.get(selectedKey).last, null, 2) || '';
    if (txt.length > 20000) txt = txt.slice(0, 20000) + '\n… (zkráceno, celé ve stažení)';
    detail = `<h4>${esc(selectedKey)}</h4><pre>${esc(txt)}</pre>`;
  }
  return `<p><button data-act="download">Stáhnout posledních ${S.ring.length} zpráv (JSON)</button></p>
    <table class="log"><thead><tr><th>Zpráva</th><th>Kanál</th><th>×</th><th>Velikost</th></tr></thead><tbody>${
    rows.map(([k, v]) => `<tr data-key="${esc(k)}" class="${k === selectedKey ? 'sel' : ''}">
      <td>${esc(k)}</td><td>${v.channel}</td><td class="num">${v.count}</td><td class="num">${fmt(v.bytes)}</td></tr>`).join('')
  }</tbody></table>${detail}`;
}

// Ikony nástrojové lišty
const ICONS = { gb: '🏛️', prod: '🏭', rate: '⭐', boost: '💪', gbg: '⚔️', ge: '🧭', qi: '🌀', tav: '🍺', inc: '🎁', neg: '🤝', map: '🗺️', stat: '📊', res: '💰', stock: '📦', log: '📜', alerts: '🔔', about: 'ℹ️' };
const TABS = [
  ['gb', 'VB', viewGB], ['prod', 'Produkce', viewProduction], ['rate', 'Rating', viewRating],
  ['boost', 'Bonusy', viewBoosts], ['gbg', 'GBG', viewGBG], ['ge', 'Expedice', viewGE], ['qi', 'QI', viewQI], ['tav', 'Hospody', viewTaverns],
  ['inc', 'Příhody', viewIncidents], ['neg', 'Vyjednávání', viewNego], ['map', 'Mapa', viewMap], ['stat', 'Statistiky', viewStats], ['res', 'Suroviny', viewResources], ['stock', 'Sklad', viewStock], ['log', 'Log', viewLog], ['alerts', '🔔', viewAlerts], ['about', 'ℹ️', viewAbout],
];
let tab = 'gb';
let open = false;
