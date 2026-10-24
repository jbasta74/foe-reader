// FoE Reader – panel-outpost.js
// Kulturní osada: přehled odemykání (kolik zboží, diplomacie a hlavní suroviny chybí), rozšíření, diplomacie,
// a pomocník aztécké minihry (obchodník – hledání pokladů, podobné hledání min).
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';

// ===================== Data osady =====================
Object.assign(H, {
  'OutpostService.start'(d) {
    if (!d?.content) return;
    const list = (S.outposts ||= []), i = list.findIndex((o) => o.content === d.content);
    if (i >= 0) list[i] = d; else list.push(d);
  },
  'AdvancementService.unlock'(d) {
    if (d?.__class__ !== 'Success' || !S.advancements) return;
    const a = S.advancements.find((x) => !x.isUnlocked);
    if (a) a.isUnlocked = true;
  },
  // ---- Aztécká minihra (obchodník) ----
  'CollectingMinigameService.start'(d) { mgStart(d); },
  'CollectingMinigameService.submitMove'(d) { mgMove(d); },
});

// Právě rozehraná kulturní osada.
const outpostNow = () => (S.outposts || []).filter((o) => o.gridId === 'cultural_outpost' && o.startedAt && !o.finishedAt)
  .sort((a, b) => b.startedAt - a.startedAt)[0] || null;

// Kolik hlavní suroviny (kakao, mince …) stojí výroba jednoho kusu zboží – z nabídky výroben zboží v osadě (nejlevnější volba).
function outpostGoodRates(info) {
  const prim = info.primaryResourceId === 'deben' ? 'egyptians_loot' : info.primaryResourceId, rates = {};
  const ents = S.outpost ? [...S.outpost.entities.values()] : [];
  // právě běžící výroba zboží (cena a výnos přímo ze stavu budovy)
  for (const e of ents) {
    const cp = e.state?.current_product, c = cp?.requirements?.cost?.resources?.[prim];
    for (const [g, n] of Object.entries(cp?.product?.resources || {})) if (c && n && g !== prim && (rates[g] == null || c / n < rates[g])) rates[g] = c / n;
  }
  for (const id of new Set(ents.map((e) => e.cityentity_id))) {
    for (const o of S.entGoodsOpt.get(id) || []) {
      const c = o.cost[prim];
      for (const [g, n] of Object.entries(o.product)) {
        if (!c || !n) continue;
        const r = c / n;
        if (rates[g] == null || r < rates[g]) rates[g] = r;
      }
    }
  }
  return rates;
}

let opSums = true; // zobrazit průběžné součty (jinak cena jednotlivých odemčení)
function viewSettlement() {
  const now = nowServer();
  let html = mgHtml();
  const info = outpostNow();
  if (!info) return html + '<p class="muted">Žádná rozehraná kulturní osada (nebo ještě nepřišel její přehled – načtěte hru).</p>' + viewOutpost(now);
  const prim = info.primaryResourceId, loot = prim === 'deben' ? 'egyptians_loot' : prim;
  const goods = (info.goodsResourceIds || []).filter((g) => g !== loot);
  const cols = [...goods, 'diplomacy', loot];
  const have = (id) => S.resources[id] || 0;
  const runs = info.playthroughs || [];
  const runIdx = Math.min(info.completedPlaythroughs || 0, Math.max(0, runs.length - 1));
  const p4 = runs[runIdx]?.productionBonusProbability || 0;
  // Produkce hlavní suroviny za 5 h (budovy, které právě vyrábějí).
  let per5h = 0;
  for (const e of S.outpost ? S.outpost.entities.values() : []) {
    const st = e.state, cp = st?.current_product;
    if (st?.__class__ !== 'ProducingState' || !cp || e.connected === 0) continue;
    const amt = (cp.product?.resources || cp.resources?.resources || {})[prim];
    if (amt && cp.production_time) per5h += (amt / cp.production_time) * 18000;
  }
  const rates = outpostGoodRates(info);
  const DEF_RATE = loot === 'egyptians_loot' ? 10 : 200; // jako FoE Helper: 5 kusů za 1000 (Egypťané 50)
  const primFor = (sums) => goods.reduce((a, g) => a + Math.max(0, Math.ceil(Math.max(0, sums[g] - have(g)) * (rates[g] ?? DEF_RATE))), 0);
  const adv = S.advancements || [];
  const sums = Object.fromEntries(cols.map((c) => [c, 0]));
  const cell = (val, sum, id) => {
    const ok = have(id) >= sum, shown = opSums && id !== 'diplomacy' ? sum : val;
    return `<td class="num ${ok ? 'ok' : 'hi'}"${ok ? '' : ` title="chybí ${fmt(sum - have(id))}"`}>${fmt(shown)}</td>`;
  };
  const head = `<tr><th>Odemčení</th><th></th>${cols.map((c) => `<th class="num">${esc(c === 'diplomacy' ? 'Diplomacie' : resLabel(c))}</th>`).join('')}</tr>`;
  let rows = '';
  // Další rozšíření (nezapočítává se do součtů)
  const tiles = (S.outpost?.tilesets || []).filter((t) => t.available && t.type === 'selectablePrice');
  if (tiles[0]) {
    const c = tiles[0].requirements?.cost?.resources || {};
    rows += `<tr class="muted"><td>Další rozšíření${tiles.length > 1 ? ` <span title="Zbývá rozšíření za zboží">(${tiles.length})</span>` : ''}</td><td></td>${cols.map((id) =>
      `<td class="num">${c[id] ? `<span class="${have(id) >= c[id] ? 'ok' : ''}">${fmt(c[id])}</span>` : ''}</td>`).join('')}</tr>`;
  }
  for (const a of adv) {
    const name = a.rewards?.[0] ? (S.names.get(a.rewards[0]) || a.name) : a.name;
    const cost = a.requirements?.resources || {};
    if (a.isUnlocked) {
      rows += `<tr class="muted"><td>${esc(name)}</td><td>✓</td>${cols.map((id) => `<td class="num">${id === loot ? '' : fmt(cost[id] || 0)}</td>`).join('')}</tr>`;
      continue;
    }
    for (const g of goods) sums[g] += cost[g] || 0;
    sums.diplomacy = cost.diplomacy || 0; // diplomacie se nespotřebuje – stačí jí mít dost
    const pNeed = primFor(sums);
    sums[loot] = pNeed;
    rows += `<tr><td>${esc(name)}</td><td>✗</td>${cols.map((id) => (id === loot ? cell(pNeed, pNeed, id) : cell(cost[id] || 0, sums[id], id))).join('')}</tr>`;
  }
  const miss = (id) => have(id) - sums[id];
  const foot = `<tr class="tot"><td>Potřeba</td><td></td>${cols.map((id) => `<td class="num">${fmt(sums[id])}</td>`).join('')}</tr>
    <tr><td>Máte</td><td></td>${cols.map((id) => `<td class="num">${fmt(have(id))}</td>`).join('')}</tr>
    <tr class="tot"><td><b>Chybí / zbývá</b></td><td></td>${cols.map((id) => {
      const d = miss(id);
      const x4 = id !== 'diplomacy' && d < 0 && p4 ? ` title="Se šancí ${fmt(Math.round(p4 * 100))} % na 4× produkci v průměru jen ${fmt(Math.floor(d / (1 + 3 * p4)))}"` : '';
      return `<td class="num ${d < 0 ? 'hi' : 'ok'}"${x4}>${d < 0 ? fmt(d) : '+' + fmt(d)}</td>`;
    }).join('')}</tr>`;
  // Kdy bude dost hlavní suroviny (při současné produkci)
  const primMiss = Math.max(0, sums[loot] - have(loot));
  const eta = primMiss && per5h > 0 ? ` · chybějící ${esc(resLabel(loot))} za ~${durLong((primMiss / per5h) * 18000)}` : '';
  html += `<h4>${esc(info.name || 'Osada')}</h4>
    <p><span class="chip">průchod ${runIdx + 1} / ${runs.length || '?'}</span>${p4 ? `<span class="chip">šance na 4× ${fmt(Math.round(p4 * 100))} %</span>` : ''}
      <span class="chip">${esc(resLabel(prim))} <b>${fmt(have(prim))}</b>${per5h ? ` (+${fmt(Math.round(per5h))} / 5 h)` : ''}</span>${have('aztecs_collecting_minigame_turns') ? `<span class="chip">tahy minihry: <b>${fmt(have('aztecs_collecting_minigame_turns'))}</b></span>` : ''}</p>
    ${adv.length ? `<p><button class="fbtn ${opSums ? 'on' : ''}" data-opsums="1">průběžné součty</button><button class="fbtn ${opSums ? '' : 'on'}" data-opsums="0">cena odemčení</button><span class="muted">${eta}</span></p>
    <table class="op"><thead>${head}</thead><tbody>${rows}${foot}</tbody></table>${diploHtml(adv, Math.max(0, sums.diplomacy - have('diplomacy')))}`
    : '<p class="muted">Seznam odemčení přijde po otevření osady ve hře.</p>'}
    <p class="muted">Zboží a hlavní surovina: průběžný součet všech dalších odemčení (zeleně = na to už máte, červeně = chybí – kolik, ukáže najetí myší). Diplomacie se nespotřebuje – stačí jí mít dost pro dané odemčení. Sloupec ${esc(resLabel(loot))} = kolik ho padne na výrobu chybějícího zboží${Object.keys(rates).length ? ' (podle nejlevnější výroby ve vaší osadě)' : ' (odhad 1000 za 5 kusů)'}. Další rozšíření se do součtů nepočítá.</p>`;
  return html + viewOutpost(now);
}
// Diplomacie: odemčené budovy s diplomacií a kolik kterých by pokrylo, co chybí (nejvíc diplomacie na pole první).
function diploHtml(adv, missing) {
  const list = [];
  for (const a of adv) {
    if (!a.isUnlocked) continue;
    for (const id of a.rewards || []) {
      const dip = S.entDipl.get(id);
      if (!dip) continue;
      const sz = S.ent.get(id), tiles = sz ? sz.w * sz.l : null;
      list.push({ id, name: S.names.get(id) || a.name, dip, tiles, per: tiles ? dip / tiles : null });
    }
  }
  if (!list.length) return '';
  list.sort((a, b) => (b.per ?? 0) - (a.per ?? 0) || b.dip - a.dip);
  return `<details${missing ? ' open' : ''}><summary><b>Diplomacie</b>${missing ? ` – chybí <span class="hi">${fmt(missing)}</span>` : ' ✓'}</summary>
    <table><thead><tr><th>Budova</th><th class="num">Diplomacie</th><th class="num">Polí</th><th class="num">Na pole</th>${missing ? '<th class="num">Kolik na chybějící</th>' : ''}</tr></thead><tbody>${
    list.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${fmt(x.dip)}</td><td class="num">${x.tiles ?? '?'}</td><td class="num">${x.per != null ? dec((Math.round(x.per * 10) / 10).toFixed(1)) : '?'}</td>${missing ? `<td class="num">${fmt(Math.ceil(missing / x.dip))}×</td>` : ''}</tr>`).join('')}</tbody></table></details>`;
}

// ===================== Aztécká minihra =====================
// Mřížka (obvykle 11 × 7) se skrytými poklady. Odkryté prázdné pole ukazuje, kolik pokladů je v 8 okolních polích.
// Pravděpodobnost u každého neodkrytého pole se počítá přesně: projdou se všechna rozmístění pokladů, která sedí na všechna čísla,
// a každé se zváží počtem možností, jak rozmístit zbylé poklady do polí mimo dosah čísel (FoE Helper počítá jen místní odhad).
let MG = null; // {w, h, total, grid: [y][x] = 'u' | 'r' | číslo, t}
function mgStart(d) {
  if (!d || d.context && d.context !== 'merchant' || !d.width || !d.height) return;
  const total = Object.values(d.reward?.resources || {}).filter((v) => typeof v === 'number')[0] || 0;
  MG = { w: d.width, h: d.height, total, grid: Array.from({ length: d.height }, () => Array(d.width).fill('u')), t: Date.now() };
  // Rozehraná hra (pokud ji server pošle i s odkrytými poli)
  for (const v of Object.values(d)) if (Array.isArray(v)) mgApply(v);
  if (cfg.mgPopup !== false) setTimeout(() => openTabWin('osada'), 50);
}
function mgApply(tiles) {
  for (const t of tiles) {
    if (!t || typeof t !== 'object' || !/CollectingMinigame\w*Tile/.test(t.__class__ || '')) continue;
    const x = t.x || 0, y = t.y || 0;
    if (!MG.grid[y] || MG.grid[y][x] === undefined) continue;
    MG.grid[y][x] = /Reward/.test(t.__class__) ? 'r' : (t.adjacentRewards || 0);
  }
}
function mgMove(d) {
  if (!MG || !Array.isArray(d)) return;
  mgApply(d);
  MG.t = Date.now(); MG.rev = (MG.rev || 0) + 1;
}
// Přesný výpočet pravděpodobností (rozdělení hranice na nezávislé části, výčet s ořezáváním).
let mgCache = null;
function mgSolve() {
  if (mgCache?.rev === MG.rev && mgCache.mg === MG) return mgCache.r;
  const r = mgSolveRaw();
  mgCache = { rev: MG.rev, mg: MG, r };
  return r;
}
function mgSolveRaw() {
  const { w, h, grid, total } = MG;
  const nb = (x, y) => { const o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) o.push([X, Y]); } return o; };
  let found = 0;
  const unknown = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (grid[y][x] === 'r') found++; else if (grid[y][x] === 'u') unknown.push(y * w + x); }
  const R = Math.max(0, total - found);
  const prob = new Map();
  if (!unknown.length) return { prob, R, found, exact: true };
  if (R === 0) { for (const c of unknown) prob.set(c, 0); return { prob, R, found, exact: true }; }
  // Omezení z čísel
  const cons = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = grid[y][x];
    if (typeof v !== 'number') continue;
    const cells = [], ns = nb(x, y);
    let r = 0;
    for (const [X, Y] of ns) { if (grid[Y][X] === 'u') cells.push(Y * w + X); else if (grid[Y][X] === 'r') r++; }
    if (cells.length) cons.push({ cells, need: v - r });
  }
  const front = new Set(cons.flatMap((c) => c.cells));
  const others = unknown.filter((c) => !front.has(c));
  // Nezávislé části hranice (pole spojená společným číslem)
  const parent = new Map([...front].map((c) => [c, c]));
  const find = (c) => { while (parent.get(c) !== c) { parent.set(c, parent.get(parent.get(c))); c = parent.get(c); } return c; };
  for (const c of cons) for (const x of c.cells.slice(1)) parent.set(find(x), find(c.cells[0]));
  const groups = new Map();
  for (const c of front) { const r = find(c); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
  let budget = 4e6, exact = true;
  const comps = [];
  for (const cells of groups.values()) {
    const idx = new Map(cells.map((c, i) => [c, i]));
    const cs = cons.filter((c) => idx.has(c.cells[0])).map((c) => ({ ids: c.cells.map((x) => idx.get(x)), need: c.need }));
    const byCell = cells.map(() => []);
    cs.forEach((c, ci) => c.ids.forEach((i) => byCell[i].push(ci)));
    const n = cells.length, val = new Int8Array(n), sum = new Int16Array(cs.length), left = Int16Array.from(cs, (c) => c.ids.length);
    const cnt = new Float64Array(n + 1), cellCnt = Array.from({ length: n }, () => new Float64Array(n + 1));
    let k = 0, ok = true;
    const rec = (i) => {
      if (--budget < 0) { ok = false; return; }
      if (i === n) { cnt[k]++; for (let j = 0; j < n; j++) if (val[j]) cellCnt[j][k]++; return; }
      for (const v of [0, 1]) {
        if (v && k >= R) continue;
        let good = true;
        for (const ci of byCell[i]) { sum[ci] += v; left[ci]--; const c = cs[ci]; if (sum[ci] > c.need || sum[ci] + left[ci] < c.need) good = false; }
        if (good) { val[i] = v; k += v; rec(i + 1); k -= v; val[i] = 0; }
        for (const ci of byCell[i]) { sum[ci] -= v; left[ci]++; }
        if (!ok) return;
      }
    };
    rec(0);
    if (!ok) { exact = false; break; }
    comps.push({ cells, cnt, cellCnt });
  }
  const lnC = (n, k) => { if (k < 0 || k > n) return -Infinity; let s = 0; for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i); return s; };
  if (!exact) { // příliš mnoho možností – místní odhad
    for (const c of unknown) prob.set(c, R / unknown.length);
    for (const c of cons) for (const x of c.cells) prob.set(x, Math.max(prob.get(x), Math.min(1, c.need / c.cells.length)));
    return { prob, R, found, exact: false };
  }
  // Konvoluce počtů přes části: conv[k] = počet rozmístění k pokladů na celé hranici
  const conv = (arrs) => arrs.reduce((acc, a) => { const o = new Float64Array(Math.min(R, acc.length - 1 + a.length - 1) + 1); acc.forEach((x, i) => { if (x) a.forEach((y, j) => { if (y && i + j <= R) o[i + j] += x * y; }); }); return o; }, Float64Array.of(1));
  const O = others.length;
  const weight = (k) => (R - k > O || R - k < 0 ? 0 : Math.exp(lnC(O, R - k)));
  const all = conv(comps.map((c) => c.cnt));
  let Z = 0, Ek = 0;
  all.forEach((x, k) => { const wk = x * weight(k); Z += wk; Ek += wk * k; });
  if (!Z) { for (const c of unknown) prob.set(c, R / unknown.length); return { prob, R, found, exact: false }; }
  comps.forEach((c, ci) => {
    const rest = conv(comps.filter((_, j) => j !== ci).map((x) => x.cnt));
    c.cells.forEach((cell, i) => {
      let s = 0;
      c.cellCnt[i].forEach((x, k1) => { if (x) rest.forEach((y, k2) => { if (y) s += x * y * weight(k1 + k2); }); });
      prob.set(cell, s / Z);
    });
  });
  const pOther = O ? (R - Ek / Z) / O : 0;
  for (const c of others) prob.set(c, pOther);
  return { prob, R, found, exact: true };
}
function mgHtml() {
  if (!MG) return '';
  const turns = S.resources.aztecs_collecting_minigame_turns;
  const { prob, R, found, exact } = mgSolve();
  if (!R && found) return `<h4>Minihra – obchodník</h4><p>Nalezeny všechny poklady (${fmt(found)}) 🎉</p>`;
  let best = -1, bestCells = [];
  for (const [c, p] of prob) { if (p > best + 1e-9) { best = p; bestCells = [c]; } else if (Math.abs(p - best) <= 1e-9) bestCells.push(c); }
  const bestSet = new Set(best > 0 ? bestCells : []);
  const col = (p) => { const t = Math.max(0, Math.min(1, p)); const g = Math.round(200 - 120 * t), r = Math.round(235 - 200 * t); return `rgb(${r},${g + 30},${Math.round(150 - 110 * t)})`; };
  let rows = '';
  for (let y = 0; y < MG.h; y++) {
    rows += '<tr>';
    for (let x = 0; x < MG.w; x++) {
      const v = MG.grid[y][x], c = y * MG.w + x;
      if (v === 'r') rows += '<td class="mg r" title="poklad">✓</td>';
      else if (typeof v === 'number') rows += `<td class="mg n">${v || ''}</td>`;
      else {
        const p = prob.get(c) ?? 0;
        const txt = p >= 0.995 ? '★' : p <= 0.005 ? '·' : Math.round(p * 100);
        rows += `<td class="mg u${bestSet.has(c) ? ' best' : ''}" style="background:${p <= 0.005 ? '#e9e2d2' : col(p)}" title="šance na poklad ${fmt(Math.round(p * 1000) / 10)} %">${txt}</td>`;
      }
    }
    rows += '</tr>';
  }
  return `<h4>Minihra – obchodník</h4>
    <p><span class="chip">nalezeno <b>${fmt(found)}</b> / ${fmt(MG.total)}</span>${turns != null ? `<span class="chip">tahy <b>${fmt(turns)}</b></span>` : ''}${best > 0 ? `<span class="chip">nejlepší tah: <b>${fmt(Math.round(best * 1000) / 10)} %</b></span>` : ''}${exact ? '' : '<span class="chip">odhad</span>'}</p>
    <table class="mgt"><tbody>${rows}</tbody></table>
    <p class="muted">Čísla = šance v % na poklad v poli, ★ = jistý poklad, · = jistě prázdné, rámeček = nejlepší tah. Počítá se přesně ze všech možných rozmístění zbývajících pokladů. Tah dělejte ve hře – pomocník jen radí.</p>`;
}
