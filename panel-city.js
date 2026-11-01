// FoE Reader – panel-city.js
// Společné pohledy, mapa města a osady, okna kalkulačky VB a mapy.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ===================== Pohledy =====================
// Kalkulačka náhozů pro naposledy otevřenou vlastní VB (null = není).
function ownCalcHtml() {
  if (!S.ownRanking) return null;
  const ent = [...S.entities.values()].find((e) => e.type === 'greatbuilding' && e.cityentity_id === S.ownRanking.building);
  const c = ent && nahozCalc(S.ownRanking.rankings, ent, S.player?.user_name || '');
  if (!c) return null;
  return viewNahoz(c, 'Náhozy: ' + entName(ent.cityentity_id) + ` · úr. ${ent.level}→${ent.level + 1}`)
    + (ent.max_level != null && ent.level >= ent.max_level ? '<p class="hi">Budova je na maximální odemčené úrovni – další úroveň je potřeba nejdřív odemknout plánky.</p>' : '');
}
function viewGB() {
  const gbs = [...S.entities.values()].filter((e) => e.type === 'greatbuilding');
  if (!gbs.length) return '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
  // Jedna záložka pro vlastní i cizí VB: nahoře kalkulačka naposledy otevřené budovy, pod tím přehledy.
  const calc = '<p><button data-act="calcwin">Kalkulačka v okně ⤢</button></p>' + calcWinHtml() + '<h4>Moje VB</h4>';
  const rows = gbs.map((e) => {
    const max = e.max_level ?? S.gbInfo.get(e.cityentity_id)?.max_level;
    const inv = e.state?.invested_forge_points || 0;
    const need = e.state?.forge_points_for_level_up;
    const atMax = max != null && e.level >= max;
    const left = need != null ? need - inv : null;
    return { id: e.id, name: entName(e.cityentity_id), level: e.level, max, inv, need, left, atMax };
  }).sort((a, b) => (a.atMax - b.atMax) || ((a.left ?? 1e15) - (b.left ?? 1e15)));
  return `${calc}<table><thead><tr><th>Velká budova</th><th>Úr.</th><th>Vloženo / potřeba</th><th>Chybí FP</th></tr></thead><tbody>${
    rows.map((r) => `<tr class="${r.atMax ? 'muted' : ''}">
      <td>${esc(r.name)}</td><td>${r.level}${r.max ? ' / ' + r.max : ''} ${gbTier(r.level, r.id)}</td>
      <td class="num">${r.atMax ? 'max' : `${fmt(r.inv)} / ${fmt(r.need)}`}</td>
      <td class="num ${!r.atMax && r.left != null && r.left <= 100 ? 'hi' : ''}">${r.atMax ? '' : fmt(r.left)}</td></tr>`).join('')
  }</tbody></table>` + (S.otherGBs?.list?.length ? otherGBsHtml() : '');
}

function viewTaverns() {
  if (!S.taverns.length) return '<p class="muted">Zatím žádná data o hospodách.</p>';
  // Stav bez "state" = volná židle; isSitting = už tam sedíte.
  const LABEL = { undefined: 'volno', isSitting: 'sedíte tam', noChair: 'plno', alreadyVisited: 'navštíveno' };
  const counts = {};
  for (const t of S.taverns) { const k = LABEL[t.state] || t.state; counts[k] = (counts[k] || 0) + 1; }
  const now = nowServer();
  const name = (id) => S.players.get(id)?.name || `#${id}`;
  const free = S.taverns.filter((t) => !['alreadyVisited', 'noChair', 'isSitting'].includes(t.state)
    || (t.state === 'alreadyVisited' && t.nextVisitTime && t.nextVisitTime <= now));
  const soon = S.taverns.filter((t) => t.state === 'alreadyVisited' && t.nextVisitTime > now)
    .sort((a, b) => a.nextVisitTime - b.nextVisitTime).slice(0, 15);
  const mine = S.myTavern ? `<p>Vaše hospoda: <b>${S.myTavern.sitting}/${S.myTavern.unlocked}</b>${S.myTavern.sitting >= S.myTavern.unlocked ? ' <span class="hi">plná</span>' : ''}</p>` : '';
  return `${mine}<p>${Object.entries(counts).map(([k, v]) => `<span class="chip">${esc(k)}: ${v}</span>`).join(' ')}</p>
    <h4>Lze si přisednout (${free.length})</h4>
    ${free.length ? `<ul>${free.map((t) => `<li>${esc(name(t.ownerId))} <span class="muted">${t.state === 'alreadyVisited' ? 'znovu dostupná, pokud je volno' : `${t.sittingPlayerCount ?? '?'}/${t.unlockedChairCount ?? '?'}`}</span></li>`).join('')}</ul>` : '<p class="muted">nikde</p>'}
    <h4>Nejbližší znovu dostupné</h4>
    <ul>${soon.map((t) => `<li>${esc(name(t.ownerId))} <span class="muted">za ${dur(t.nextVisitTime - now)}</span></li>`).join('')}</ul>`;
}

// ===================== Mapa města / osady =====================
let mapGrid = 'main';
// Model mapy se počítá znovu jen při změně rozmístění (rozbor cest a volného místa je náročnější).
let mapCache = null;
function mapModel(gridId) {
  const g = S.grids[gridId];
  const list = gridId === 'main' ? [...S.entities.values()].filter((e) => (e.player_id == null || e.player_id === myId()))
    : (S.gridMap?.[gridId] ? [...S.gridMap[gridId].entities.values()] : []);
  if (!g || !list.length) return null;
  let h = list.length * 7 + S.ent.size;
  for (const e of list) h = (h * 31 + (e.x || 0) * 977 + (e.y || 0) * 131 + e.cityentity_id.length) % 1e9;
  const key = `${gridId}|${h}|${g.unlocked.length}`;
  if (mapCache?.key === key) return mapCache.M;
  const M = mapModelRaw(g, list);
  mapCache = { key, M };
  return M;
}
function mapModelRaw(g, list, plan) {
  const tiles = new Set();
  for (const a of g.unlocked) for (let x = 0; x < a.width; x++) for (let y = 0; y < a.length; y++) tiles.add(`${(a.x || 0) + x},${(a.y || 0) + y}`);
  const occ = new Map(); // "x,y" -> entity
  const items = [];
  let missing = 0;
  for (const e of list) {
    const m = S.ent.get(e.cityentity_id);
    if (!m) { missing++; continue; }
    const x0 = e.x || 0, y0 = e.y || 0;
    const isRoad = m.type === 'street' || /^S_/.test(e.cityentity_id);
    const isImp = m.type === 'impediment' || /^I_/.test(e.cityentity_id);
    const it = { e, m, x0, y0, isRoad, isImp, name: S.names.get(e.cityentity_id) || e.cityentity_id };
    items.push(it);
    for (let x = 0; x < m.w; x++) for (let y = 0; y < m.l; y++) occ.set(`${x0 + x},${y0 + y}`, it);
  }
  // cesty, které nevedou k žádné budově s potřebou cesty (slepé konce) – opakovaně odstraňujeme listy
  const road = new Set([...occ].filter(([, it]) => it.isRoad).map(([k]) => k));
  const nb = (k) => { const [x, y] = k.split(',').map(Number); return [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]; };
  const needsRoadAt = (k) => nb(k).some((n) => { const it = occ.get(n); return it && !it.isRoad && !it.isImp && (it.m.road > 0 || it.m.type === 'main_building'); });
  const alive = new Set(road);
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...alive]) {
      if (needsRoadAt(k)) continue;
      if (nb(k).filter((n) => alive.has(n)).length <= 1) { alive.delete(k); changed = true; }
    }
  }
  const deadRoads = [...road].filter((k) => !alive.has(k));
  const free = [...tiles].filter((k) => !occ.has(k)).length;
  const touchesRoad = (it) => {
    for (let x = -1; x <= it.m.w; x++) for (let y = -1; y <= it.m.l; y++) {
      if ((x === -1 || x === it.m.w) === (y === -1 || y === it.m.l)) continue; // jen hrany, ne rohy ani vnitřek
      if (road.has(`${it.x0 + x},${it.y0 + y}`)) return true;
    }
    return false;
  };
  const noRoadAtRoad = items.filter((it) => !it.isRoad && !it.isImp && it.m.road === 0 && it.m.type !== 'main_building' && touchesRoad(it));
  const removable = removableRoads(items, road, occ, nb);
  // v plánu se připojení počítá z modelu (hra o přesunutých budovách nic neví)
  const notConnected = plan ? removable.unconn : items.filter((it) => !it.isRoad && it.m.road > 0 && !it.e.connected);
  const xs = [...tiles].map((k) => +k.split(',')[0]), ys = [...tiles].map((k) => +k.split(',')[1]);
  return { tiles, items, occ, road, deadRoads, free, noRoadAtRoad, notConnected, missing, removable,
    minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
// Cesty, které jde odebrat, aniž by se odpojila některá budova, která je teď připojená k radnici.
// Po kusech cest (dvouproudá 2×2 je jeden kus) od konců se zkusí každý odebrat; zůstane-li vše připojené, odebere se natrvalo –
// výsledek je sada, kterou jde odebrat celou najednou. Budovy s dvouproudou cestou potřebují spojení po dvouproudých cestách.
function removableRoads(items, road, occ, nb) {
  const th = items.find((it) => it.m.type === 'main_building');
  const roads = items.filter((it) => it.isRoad);
  if (!th || !roads.length) { const o = []; o.unconn = []; o.adj = new Map(); o.reach = [new Set(), new Set()]; return o; }
  const tilesOf = (it) => { const o = []; for (let x = 0; x < it.m.w; x++) for (let y = 0; y < it.m.l; y++) o.push(`${it.x0 + x},${it.y0 + y}`); return o; };
  const edge = (it) => { const o = []; for (let x = -1; x <= it.m.w; x++) for (let y = -1; y <= it.m.l; y++) { if ((x === -1 || x === it.m.w) === (y === -1 || y === it.m.l)) continue; o.push(`${it.x0 + x},${it.y0 + y}`); } return o; };
  const thEdge = edge(th);
  const gone = new Set();
  const lvlAt = (k) => { const it = occ.get(k); return it && it.isRoad && !gone.has(it) ? it.m.road || 1 : 0; };
  const reach = (L) => { const seen = new Set(), q = thEdge.filter((k) => lvlAt(k) >= L); for (const k of q) seen.add(k);
    while (q.length) { const k = q.pop(); for (const n of nb(k)) if (!seen.has(n) && lvlAt(n) >= L) { seen.add(n); q.push(n); } } return seen; };
  const needers = items.filter((it) => !it.isRoad && !it.isImp && it.m.road > 0 && it.m.type !== 'main_building').map((it) => ({ it, ed: edge(it), L: Math.min(2, it.e._lvl ?? it.m.road) })).filter((n) => n.L > 0);
  const conn = (r1, r2, n) => n.ed.some((k) => (n.L > 1 ? r2 : r1).has(k));
  const b1 = reach(1), b2 = reach(2);
  // Opatrně: budova, kterou hra hlásí jako připojenou, ale model ji při její úrovni cesty nespojí (dvouproudé cesty), se hlídá aspoň
  // jako jednoproudá; když ani to ne, cesty kolem ní se neodebírají.
  const keep = new Set();
  const adj = new Map(); // entita -> úroveň, se kterou model budovu opravdu spojí (pro plánovač)
  for (const n of needers) if (!conn(b1, b2, n) && n.it.e.connected) { if (n.ed.some((k) => b1.has(k))) { n.L = 1; adj.set(n.it.e, 1); } else { adj.set(n.it.e, 0); for (const k of n.ed) { const r = occ.get(k); if (r?.isRoad) keep.add(r); } } }
  const need = needers.filter((n) => conn(b1, b2, n));
  const ok = () => { const r1 = reach(1), r2 = reach(2); return need.every((n) => conn(r1, r2, n)); };
  const deg = (it) => tilesOf(it).reduce((a, k) => a + nb(k).filter((n) => lvlAt(n) && occ.get(n) !== it).length, 0);
  const out = [];
  for (const it of roads.sort((a, b) => deg(a) - deg(b))) {
    if (keep.has(it)) continue;
    gone.add(it);
    if (!tilesOf(it).some((k) => b1.has(k)) || ok()) out.push(...tilesOf(it)); else gone.delete(it);
  }
  out.adj = adj; out.reach = [b1, b2];
  out.unconn = needers.filter((n) => !conn(b1, b2, n)).map((n) => n.it);
  return out;
}
// Volné místo: kolik budov dané velikosti se vejde (hladově, bez překryvu, bez ohledu na cestu) a kam.
function freeFits(M, w, l) {
  const ck = `${w}×${l}`;
  if ((M._fits ||= {})[ck]) return M._fits[ck];
  const used = new Set(M.occ.keys()), spots = [];
  const ys = [], xs = [];
  for (let y = M.minY; y <= M.maxY; y++) ys.push(y);
  for (let x = M.minX; x <= M.maxX; x++) xs.push(x);
  const fits = (x0, y0, W, L) => { for (let x = 0; x < W; x++) for (let y = 0; y < L; y++) { const k = `${x0 + x},${y0 + y}`; if (!M.tiles.has(k) || used.has(k)) return false; } return true; };
  for (const y of ys) for (const x of xs) for (const [W, L] of w === l ? [[w, l]] : [[w, l], [l, w]]) {
    if (!fits(x, y, W, L)) continue;
    spots.push({ x, y, w: W, l: L });
    for (let a = 0; a < W; a++) for (let b = 0; b < L; b++) used.add(`${x + a},${y + b}`);
    break;
  }
  return (M._fits[ck] = spots);
}
// Největší volný obdélník (plocha) – histogram po řádcích.
function largestFree(M) {
  const W = M.maxX - M.minX + 1, hgt = new Array(W).fill(0);
  let best = { a: 0 };
  for (let y = M.minY; y <= M.maxY; y++) {
    for (let i = 0; i < W; i++) { const k = `${M.minX + i},${y}`; hgt[i] = M.tiles.has(k) && !M.occ.has(k) ? hgt[i] + 1 : 0; }
    const st = [];
    for (let i = 0; i <= W; i++) {
      const h = i < W ? hgt[i] : 0;
      while (st.length && hgt[st[st.length - 1]] >= h) {
        const top = st.pop(), hh = hgt[top], left = st.length ? st[st.length - 1] + 1 : 0, ww = i - left;
        if (hh * ww > best.a) best = { a: hh * ww, w: ww, l: hh, x: M.minX + left, y: y - hh + 1 };
      }
      st.push(i);
    }
  }
  return best.a ? best : null;
}
// ---------- Tipy na prohození: budova bez potřeby cesty stojí u cesty, stejně velká budova s potřebou cesty stojí jinde ----------
// Cesty se prohozením nemění, takže připojení na novém místě stačí ověřit proti dosahu cest od radnice. Úspora = o kolik polí cesty
// víc jde po prohození odebrat (stejný výpočet jako oranžové cesty). Zkouší se jen budovy, kterým patří aspoň jedno pole cesty.
const tileNb = (k) => { const [x, y] = k.split(',').map(Number); return [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]; };
function tileEdge(x0, y0, w, l) { const o = []; for (let x = -1; x <= w; x++) for (let y = -1; y <= l; y++) { if ((x === -1 || x === w) === (y === -1 || y === l)) continue; o.push(`${x0 + x},${y0 + y}`); } return o; }
function swapTips(M) {
  if (M._swaps) return M._swaps;
  const [b1, b2] = M.removable.reach || [new Set(), new Set()], adj = M.removable.adj || new Map();
  const isNeeder = (it) => it && !it.isRoad && !it.isImp && (it.m.road > 0 || it.m.type === 'main_building');
  const needers = M.items.filter((it) => isNeeder(it) && it.m.type !== 'main_building' && !M.notConnected.includes(it) && !M.removable.unconn.includes(it));
  const rem = new Set(M.removable);
  // pole cesty, u kterého stojí jen jedna budova s potřebou cesty
  const users = new Map();
  for (const it of M.items) if (isNeeder(it)) for (const k of tileEdge(it.x0, it.y0, it.m.w, it.m.l)) if (M.road.has(k)) users.set(k, (users.get(k) || 0) + 1);
  const owns = (it) => tileEdge(it.x0, it.y0, it.m.w, it.m.l).some((k) => M.road.has(k) && !rem.has(k) && users.get(k) === 1);
  const out = [], t0 = performance.now();
  for (const b of needers) {
    if (!owns(b)) continue;
    const L = Math.min(2, adj.has(b.e) ? adj.get(b.e) : (b.e._lvl ?? b.m.road));
    if (!L) continue;
    for (const a of M.noRoadAtRoad) {
      if (a.m.w !== b.m.w || a.m.l !== b.m.l) continue;
      if (!tileEdge(a.x0, a.y0, a.m.w, a.m.l).some((k) => (L > 1 ? b2 : b1).has(k))) continue; // na novém místě by nebyla připojená
      if (performance.now() - t0 > 1500) break;
      const occ = new Map(M.occ), a2 = { ...a, x0: b.x0, y0: b.y0 }, bb = { ...b, x0: a.x0, y0: a.y0, e: { ...b.e, connected: false, _lvl: L } };
      for (let x = 0; x < a.m.w; x++) for (let y = 0; y < a.m.l; y++) { occ.set(`${b.x0 + x},${b.y0 + y}`, a2); occ.set(`${a.x0 + x},${a.y0 + y}`, bb); }
      const r = removableRoads(M.items.map((it) => (it === a ? a2 : it === b ? bb : it)), M.road, occ, tileNb);
      if (r.unconn.includes(bb) || r.unconn.length > M.removable.unconn.length) continue;
      const gain = r.length - M.removable.length;
      if (gain > 0) out.push({ a, b, gain });
    }
  }
  out.sort((x, y) => y.gain - x.gain || x.a.name.localeCompare(y.a.name));
  // každá budova jen v jednom tipu (nejlepším)
  const used = new Set(), res = [];
  for (const t of out) { if (used.has(t.a) || used.has(t.b)) continue; used.add(t.a); used.add(t.b); res.push(t); }
  return (M._swaps = res);
}
let mapTip = null; // zvýrazněný tip (index)
// Společná obsluha tlačítek tipů a plánu (panel i okno mapy). Vrací true, když klik obsloužila.
function mapClick(b) {
  const M = curModel();
  if (b.dataset.mtip != null) {
    const i = +b.dataset.mtip, t = M && swapTips(M)[i];
    if (!t) return true;
    if (mapTip !== i) { mapTip = i; render(); renderMapWin(); return true; }
    // druhý klik: vyzkoušet v plánu
    if (planOn()) planSwap(t.a.e, t.b.e);
    else { const ia = M.items.indexOf(t.a), ib = M.items.indexOf(t.b); if (!planStart()) return true; planSwap(mapPlan.list[ia], mapPlan.list[ib]); mapPlan.hist = []; }
    if (!mapWin) openMapWin(); else renderMapWin();
    render(); return true;
  }
  if (b.dataset.pact === 'start' || b.dataset.pload != null) { if (planStart(b.dataset.pload)) { if (!mapWin) openMapWin(); else renderMapWin(); render(); } return true; }
  if (b.dataset.pdel != null) { const n = b.dataset.pdel; plansWrite(mapGrid, (o) => { delete o[n]; }); if (planOn() && mapPlan.name === n) mapPlan.name = PLAN_AUTO; renderMapWin(); render(); return true; }
  if (!planOn()) return false;
  if (b.dataset.ptool) { mapPlan.tool = b.dataset.ptool; mapPlan.pick = null; }
  else if (b.dataset.ppick != null) { const e = mapPlan.parked[+b.dataset.ppick]; mapPlan.pick = mapPlan.pick === e ? null : e; }
  else if (b.dataset.pshow) mapPlan.show[b.dataset.pshow] = !mapPlan.show[b.dataset.pshow];
  else if (b.dataset.pstep != null) mapPlan.step = mapPlan.step === +b.dataset.pstep ? null : +b.dataset.pstep;
  else if (b.dataset.pinv != null) { const inv = S.inv.get(b.dataset.pinv) ? b.dataset.pinv : +b.dataset.pinv, it = S.inv.get(inv); const cid = it?.item?.cityEntityId;
    if (cid) { const e = planInvEntity(cid, inv); planSnap(); mapPlan.parked.push(e); planChanged(); mapPlan.pick = e; mapPlan.tool = 'move'; } }
  else if (b.dataset.pact === 'save') { const n = (b.getRootNode().querySelector('#planname')?.value || '').trim().slice(0, 40); if (!n || n === PLAN_AUTO) return true; planSave(n); mapPlan.name = n; }
  else if (b.dataset.pact === 'undo') planUndo();
  else if (b.dataset.pact === 'droprem') planDropRemovable(M);
  else if (b.dataset.pact === 'reset') { const n = mapPlan.name; planStart(); mapPlan.name = n; planChanged(); }
  else if (b.dataset.pact === 'end') mapPlan = null;
  else return false;
  renderMapWin(); render(); return true;
}

// ---------- Plánovač: kopie mapy, ve které jde tahat budovy, přidávat a mazat cesty; ve hře se nic nemění ----------
let mapPlan = null;
const planOn = () => !!mapPlan && mapPlan.grid === mapGrid;
// Plán se dá uložit (localStorage tohoto světa) – rozpracovaný se ukládá sám po každé změně, další varianty pod jménem.
const PLANS_KEY = 'foeReaderPlans', PLAN_AUTO = 'Rozpracovaný';
function plansAll() { try { return JSON.parse(localStorage.getItem(PLANS_KEY) || '{}') || {}; } catch { return {}; } }
function plansOf(grid) { return plansAll()[grid] || {}; }
function plansWrite(grid, f) { const all = plansAll(); all[grid] = all[grid] || {}; f(all[grid]); if (!Object.keys(all[grid]).length) delete all[grid]; try { localStorage.setItem(PLANS_KEY, JSON.stringify(all)); } catch { /* plno */ } }
const planPack = (e) => ({ id: e.id, cityentity_id: e.cityentity_id, x: e.x || 0, y: e.y || 0, _lvl: e._lvl, _inv: e._inv });
// Budova z inventáře: postaví se ve věku hráče (jako v Ratingu).
function planInvEntity(cid, invId) { const sz = S.ent.get(cid); return { cityentity_id: cid, x: 0, y: 0, connected: false, _inv: invId ?? true, type: sz?.type, level: ERAS.indexOf(S.player?.era), state: {} }; }
// Nový plán ze stavu hry, nebo načtený uložený (sloučený s aktuálním stavem hry: prodané budovy vypadnou, nové přibudou na svém místě).
function planStart(name) {
  const M0 = mapModel(mapGrid);
  if (!M0) return false;
  const adj = M0.removable.adj || new Map();
  const fromGame = (e, x, y) => ({ ...e, x, y, connected: false, _lvl: adj.has(e) ? adj.get(e) : undefined });
  let list = M0.items.map((it) => fromGame(it.e, it.e.x || 0, it.e.y || 0)), parked = [];
  const saved = name ? plansOf(mapGrid)[name] : null;
  if (saved) {
    const game = new Map(M0.items.filter((it) => it.e.id != null).map((it) => [it.e.id, it.e]));
    const seen = new Set(), mk = (c) => { if (c.id != null) { const g = game.get(c.id); if (!g) return null; seen.add(c.id); return fromGame(g, c.x, c.y); } return c._inv ? { ...planInvEntity(c.cityentity_id, c._inv), x: c.x, y: c.y } : { cityentity_id: c.cityentity_id, x: c.x, y: c.y, connected: false }; };
    list = saved.list.map(mk).filter(Boolean); parked = (saved.parked || []).map(mk).filter(Boolean);
    const extra = M0.items.filter((it) => it.e.id != null && !seen.has(it.e.id)).map((it) => fromGame(it.e, it.e.x || 0, it.e.y || 0));
    list.push(...extra); // nové budovy ze hry: na svém místě, a když tam v plánu něco stojí, do skladu
  }
  // kusy cest, které se v městě už používají (1×1 jednoproudá, nejmenší dvouproudá)
  const rs = M0.items.filter((it) => it.isRoad);
  const pickRoad = (f) => rs.filter(f).sort((a, b) => a.m.w * a.m.l - b.m.w * b.m.l)[0]?.e.cityentity_id
    || [...S.ent].filter(([id, m]) => m.type === 'street' && f({ m, e: { cityentity_id: id } })).sort((a, b) => a[1].w * a[1].l - b[1].w * b[1].l)[0]?.[0];
  mapPlan = { grid: mapGrid, g: S.grids[mapGrid], list, parked, hist: [], tool: 'move', pick: null, rev: 1, name: name || PLAN_AUTO, step: null, show: {},
    r1: pickRoad((it) => (it.m.road || 1) === 1 && it.m.w === 1 && it.m.l === 1), r2: pickRoad((it) => (it.m.road || 1) >= 2),
    base: { roads: M0.road.size, free: M0.free, lf: largestFree(M0), unconn: M0.removable.unconn.length, v: planValue(M0.items.map((it) => it.e)) } };
  if (saved) planFixOverlaps();
  return true;
}
// Po sloučení s hrou se může něco překrývat – pozdější (nové ze hry) jde do skladu.
function planFixOverlaps() {
  const used = new Set(), keep = [];
  for (const e of mapPlan.list) {
    const m = S.ent.get(e.cityentity_id), ks = [];
    if (m) for (let a = 0; a < m.w; a++) for (let b = 0; b < m.l; b++) ks.push(`${(e.x || 0) + a},${(e.y || 0) + b}`);
    if (ks.some((k) => used.has(k))) { if (!/^S_/.test(e.cityentity_id) && m?.type !== 'street') mapPlan.parked.push(e); continue; }
    ks.forEach((k) => used.add(k)); keep.push(e);
  }
  mapPlan.list = keep;
}
// Hodnota podle Ratingu (skóre × pole, stejné váhy jako záložka Rating) a denní produkce po druzích.
function planValue(list) {
  if (typeof rateOne !== 'function') return null;
  const W = rateW().filter((t) => t.on && t.per > 0), bs = rateBs(), out = { val: 0, by: {}, n: 0 };
  for (const e of list) {
    const sz = S.ent.get(e.cityentity_id);
    if (!sz || sz.type === 'street' || sz.type === 'impediment' || rateSkip(e.type || sz.type)) continue;
    let r; try { r = rateOne(e, sz, W, bs); } catch { continue; }
    out.val += r.score * r.tiles; out.n++;
    for (const t of W) if (r.v[t.k]) out.by[t.k] = (out.by[t.k] || 0) + r.v[t.k];
  }
  return out;
}
function planVal() { if (mapPlan._V?.rev !== mapPlan.rev) mapPlan._V = { rev: mapPlan.rev, v: planValue(mapPlan.list) }; return mapPlan._V.v; }
function planSave(name) {
  const M = planModel(), v = planVal();
  plansWrite(mapPlan.grid, (o) => { o[name] = { t: Date.now(), list: mapPlan.list.map(planPack), parked: mapPlan.parked.map(planPack), st: { roads: M.road.size, free: M.free, val: v ? Math.round(v.val) : null, nc: M.notConnected.length } }; });
}
function planModel() {
  if (mapPlan._M?.rev !== mapPlan.rev) mapPlan._M = { rev: mapPlan.rev, M: mapModelRaw(mapPlan.g, mapPlan.list, true) };
  return mapPlan._M.M;
}
function curModel() { return planOn() ? planModel() : mapModel(mapGrid); }
function planSnap() {
  mapPlan.hist.push({ list: mapPlan.list.map((e) => ({ ...e })), parked: mapPlan.parked.map((e) => ({ ...e })) });
  if (mapPlan.hist.length > 80) mapPlan.hist.shift();
}
function planChanged() { mapPlan.rev++; mapTip = null; mapPlan.step = null; try { planSave(PLAN_AUTO); } catch { /* bez uložení */ } }
function planUndo() { const h = mapPlan.hist.pop(); if (!h) return; mapPlan.list = h.list; mapPlan.parked = h.parked; mapPlan.pick = null; planChanged(); }
function planFits(M, e, x, y) {
  const m = S.ent.get(e.cityentity_id);
  if (!m) return false;
  for (let a = 0; a < m.w; a++) for (let b = 0; b < m.l; b++) { const k = `${x + a},${y + b}`; const o = M.occ.get(k); if (!M.tiles.has(k) || (o && o.e !== e)) return false; }
  return true;
}
function planMove(e, x, y) { if ((e.x || 0) === x && (e.y || 0) === y) return; planSnap(); e.x = x; e.y = y; planChanged(); }
// klik nástrojem cesty: na cestě ji smaže, na volném poli položí
function planRoad(M, x, y, two) {
  const it = M.occ.get(`${x},${y}`);
  if (it?.isRoad) { planSnap(); mapPlan.list = mapPlan.list.filter((e) => e !== it.e); planChanged(); return true; }
  const id = two ? mapPlan.r2 : mapPlan.r1;
  if (it || !id) return false;
  const e = { cityentity_id: id, x, y, connected: false };
  if (!planFits(M, e, x, y)) return false;
  planSnap(); mapPlan.list.push(e); planChanged(); return true;
}
function planPark(it) {
  if (!it || it.isImp || it.m.type === 'main_building') return;
  planSnap();
  mapPlan.list = mapPlan.list.filter((e) => e !== it.e);
  if (!it.isRoad) mapPlan.parked.push(it.e);
  if (mapPlan.pick === it.e) mapPlan.pick = null;
  planChanged();
}
function planPlace(M, e, x, y) {
  if (!planFits(M, e, x, y)) return false;
  planSnap(); mapPlan.parked = mapPlan.parked.filter((p) => p !== e); e.x = x; e.y = y; mapPlan.list.push(e); mapPlan.pick = null; planChanged(); return true;
}
function planDropRemovable(M) {
  const rem = new Set(M.removable);
  const drop = M.items.filter((it) => it.isRoad && tilesOfItem(it).every((k) => rem.has(k)));
  if (!drop.length) return;
  planSnap(); const ds = new Set(drop.map((it) => it.e)); mapPlan.list = mapPlan.list.filter((e) => !ds.has(e)); planChanged();
}
function planSwap(a, b) { planSnap(); const ax = a.x, ay = a.y; a.x = b.x; a.y = b.y; b.x = ax; b.y = ay; planChanged(); }
// ---------- Postup přestavby: co udělat ve hře, aby město odpovídalo plánu ----------
// Porovnává plán s živou mapou ze hry, takže co ve hře uděláte, z postupu samo zmizí. Pořadí je proveditelné: nejdřív
// zbytečné cesty a odebrané budovy, pak přesuny na místa, která už jsou volná (když se dvě budovy blokují, jedna jde dočasně
// jinam nebo do inventáře), nakonec nové cesty.
function planSteps() {
  const G = mapModel(mapPlan.grid), P = planModel();
  if (!G || !P) return [];
  const isB = (it) => !it.isRoad && !it.isImp;
  const gById = new Map(G.items.filter((it) => it.e.id != null).map((it) => [it.e.id, it]));
  const pIds = new Set(P.items.map((it) => it.e.id).filter((x) => x != null).concat(mapPlan.parked.map((e) => e.id).filter((x) => x != null)));
  const at = (it) => `${it.e.cityentity_id}@${it.x0},${it.y0}`;
  // nové věci v plánu (cesty, budovy z inventáře), které už ve hře stojí na svém místě
  const gFree = new Map();
  for (const it of G.items) if (!pIds.has(it.e.id)) { const k = at(it); (gFree.get(k) || gFree.set(k, []).get(k)).push(it); }
  const matched = new Set(), adds = [];
  for (const it of P.items) if (it.e.id == null) { const l = gFree.get(at(it)); if (l?.length) matched.add(l.pop()); else adds.push(it); }
  const box = (it, x = it.x0, y = it.y0) => ({ x, y, w: it.m.w, l: it.m.l });
  const steps = [];
  // stav během provádění: pole -> klíč objektu
  const occ = new Map(), fill = (key, b, on) => { for (let a = 0; a < b.w; a++) for (let c = 0; c < b.l; c++) { const k = `${b.x + a},${b.y + c}`; if (on) occ.set(k, key); else if (occ.get(k) === key) occ.delete(k); } };
  for (const it of G.items) fill(it, box(it), true);
  // 1) cesty, které v plánu nejsou nebo jsou jinde
  const pById = new Map(P.items.filter((it) => it.e.id != null).map((it) => [it.e.id, it]));
  const roadGone = G.items.filter((it) => it.isRoad && !matched.has(it) && (!pById.has(it.e.id) || pById.get(it.e.id).x0 !== it.x0 || pById.get(it.e.id).y0 !== it.y0));
  if (roadGone.length) { steps.push({ k: 'rdel', text: `✂️ Smazat cesty: ${roadGone.reduce((a, it) => a + it.m.w * it.m.l, 0)} polí`, tiles: roadGone.flatMap(tilesOfItem) }); roadGone.forEach((it) => fill(it, box(it), false)); }
  // 2) budovy, které v plánu nejsou (nebo jsou ve skladu plánu)
  for (const it of G.items) if (isB(it) && !matched.has(it) && !pById.has(it.e.id)) { steps.push({ k: 'del', text: `📦 Odebrat: ${it.name} (uložit do inventáře nebo prodat)`, from: box(it) }); fill(it, box(it), false); }
  // 3) přesuny a stavby z inventáře
  const pend = [];
  for (const it of P.items) if (isB(it) && it.e.id != null) { const g = gById.get(it.e.id); if (g && (g.x0 !== it.x0 || g.y0 !== it.y0)) pend.push({ it, g, to: box(it), from: box(g) }); }
  for (const it of adds) if (isB(it)) pend.push({ it, g: null, to: box(it), from: null });
  const freeFor = (o, b) => { for (let a = 0; a < b.w; a++) for (let c = 0; c < b.l; c++) { const k = `${b.x + a},${b.y + c}`; if (!G.tiles.has(k)) return false; const v = occ.get(k); if (v && v !== o) return false; } return true; };
  const reserved = () => { const r = new Set(); for (const p of pend) for (let a = 0; a < p.to.w; a++) for (let c = 0; c < p.to.l; c++) r.add(`${p.to.x + a},${p.to.y + c}`); return r; };
  let guard = 0;
  while (pend.length && guard++ < 2000) {
    const i = pend.findIndex((p) => freeFor(p.g || p, p.to));
    if (i >= 0) {
      const p = pend.splice(i, 1)[0];
      if (p.g) { fill(p.g, p.from, false); steps.push({ k: 'move', text: `➜ Přesunout: ${p.it.name}`, from: p.from, to: p.to }); }
      else steps.push({ k: 'add', text: `🏗️ ${p.stored ? 'Vrátit z inventáře na nové místo' : 'Postavit z inventáře'}: ${p.it.name}`, to: p.to });
      fill(p.g || p, p.to, true);
      continue;
    }
    // zablokováno: první přesouvanou budovu dočasně jinam (mimo cílová místa ostatních), jinak do inventáře
    const p = pend.find((q) => q.g) || pend[0];
    if (!p.g) { steps.push({ k: 'add', text: `🏗️ Postavit z inventáře: ${p.it.name} (místo zatím není volné)`, to: p.to }); pend.splice(pend.indexOf(p), 1); continue; }
    const res = reserved(); let spot = null;
    for (let y = G.minY; y <= G.maxY && !spot; y++) for (let x = G.minX; x <= G.maxX && !spot; x++) {
      const b = { x, y, w: p.from.w, l: p.from.l };
      if (!freeFor(null, b)) continue;
      let ok = true; for (let a = 0; a < b.w && ok; a++) for (let c = 0; c < b.l && ok; c++) if (res.has(`${x + a},${y + c}`)) ok = false;
      if (ok) spot = b;
    }
    fill(p.g, p.from, false);
    if (spot) { steps.push({ k: 'tmp', text: `⇢ Dočasně přesunout jinam: ${p.it.name} (místo vyznačené na mapě)`, from: p.from, to: spot }); fill(p.g, spot, true); p.from = spot; }
    else { steps.push({ k: 'tmp', text: `📦 Dočasně uložit do inventáře: ${p.it.name} (blokuje jiný přesun)`, from: p.from }); p.g = null; p.from = null; p.stored = true; }
  }
  // 4) nové cesty
  const roadNew = P.items.filter((it) => it.isRoad && (it.e.id == null ? adds.includes(it) : (() => { const g = gById.get(it.e.id); return !g || g.x0 !== it.x0 || g.y0 !== it.y0; })()));
  if (roadNew.length) steps.push({ k: 'radd', text: `➕ Postavit cesty: ${roadNew.reduce((a, it) => a + it.m.w * it.m.l, 0)} polí`, tiles: roadNew.flatMap(tilesOfItem) });
  return steps;
}
function stepsHtml() {
  const st = planSteps();
  if (!mapPlan.show.steps) return `<br><button class="fbtn" data-pshow="steps">📋 Postup přestavby (${st.length} ${st.length === 1 ? 'krok' : st.length >= 2 && st.length <= 4 ? 'kroky' : 'kroků'})</button>`;
  return `<br><button class="fbtn on" data-pshow="steps">📋 Postup přestavby</button> <span class="muted">klik na krok = ukázat na mapě (modře odkud, růžově kam); co uděláte ve hře, samo zmizí</span>
    ${st.length ? `<ol class="steps">${st.map((x, i) => `<li><a href="#" class="${mapPlan.step === i ? 'on' : ''}" data-pstep="${i}">${esc(x.text)}</a></li>`).join('')}</ol>` : '<p class="muted">Město ve hře už odpovídá plánu ✓</p>'}`;
}
const tilesOfItem = (it) => { const o = []; for (let x = 0; x < it.m.w; x++) for (let y = 0; y < it.m.l; y++) o.push(`${it.x0 + x},${it.y0 + y}`); return o; };
function planStats(M) {
  const b = mapPlan.base, lf = largestFree(M), d = (v, good) => v === 0 ? '±0' : `<b style="color:${(v < 0) === good ? '#2e7d32' : '#b0410f'}">${v > 0 ? '+' : ''}${fmt(v)}</b>`;
  const tool = (k, l, tt) => `<button class="fbtn ${mapPlan.tool === k ? 'on' : ''}" data-ptool="${k}" title="${tt}">${l}</button>`;
  const v = planVal(), bv = b.v;
  let rate = '';
  if (v && bv && (v.val || bv.val)) {
    const W = rateW().filter((t) => t.on && t.per > 0);
    const diffs = W.map((t) => [t, Math.round((v.by[t.k] || 0) - (bv.by[t.k] || 0))]).filter(([, x]) => x !== 0);
    rate = `<span class="chip" title="Součet skóre × pole všech budov podle vah ze záložky Rating – vyšší = výkonnější město">Rating ${fmt(Math.round(v.val))} (${d(Math.round(v.val - bv.val), false)})</span>
      ${diffs.length ? `<br><span class="muted">Produkce za den oproti hře:</span> ${diffs.map(([t, x]) => `<span class="chip" title="${esc(t.l)}">${esc(rateShort(t.k))} ${d(x, false)}</span>`).join('')}` : ''}`;
  }
  const saved = Object.entries(plansOf(mapPlan.grid)).filter(([n]) => n !== PLAN_AUTO);
  return `<b>✏️ Plán</b> <span class="muted">${esc(mapPlan.name === PLAN_AUTO ? '' : mapPlan.name + ' · ')}(jen kopie – ve hře se nic nemění)</span>
    ${tool('move', '✋ Přesun', 'Táhněte budovu nebo cestu na nové místo')}${tool('road', '➕ Cesta', 'Klik na volné pole přidá cestu, klik na cestu ji smaže')}${mapPlan.r2 ? tool('road2', '➕ Dvouproudá', 'Klik na volné místo přidá dvouproudou cestu (levý horní roh), klik na cestu ji smaže') : ''}${tool('park', '📦 Do skladu', 'Klik na budovu ji uloží stranou, klik na cestu ji smaže')}
    <button class="fbtn ${mapPlan.show.inv ? 'on' : ''}" data-pshow="inv" title="Budovy z inventáře ve hře – klik je dá do skladu plánu a pak je položíte do mapy">🎁 Z inventáře</button>
    <button class="fbtn" data-pact="droprem" title="Smazat všechny oranžové cesty najednou">✂️ Odebrat odebratelné (${fmt(M.removable.length)})</button>
    <button class="fbtn" data-pact="undo" ${mapPlan.hist.length ? '' : 'disabled'}>↶ Zpět</button><button class="fbtn" data-pact="reset">⟲ Od začátku</button><button class="fbtn" data-pact="end">Konec plánu</button>
    <br><span class="muted">Oproti hře:</span> <span class="chip">cesty ${fmt(M.road.size)} (${d(M.road.size - b.roads, true)})</span><span class="chip">volno ${fmt(M.free)} (${d(M.free - b.free, false)})</span>
    <span class="chip">největší volné ${lf ? `${lf.w}×${lf.l}` : '–'} (bylo ${b.lf ? `${b.lf.w}×${b.lf.l}` : '–'})</span>
    ${M.notConnected.length ? `<span class="chip hi" title="Budovy, které v plánu nemají cestu k radnici (červený okraj)">nepřipojeno ${M.notConnected.length}</span>` : '<span class="chip" style="color:#2e7d32">vše připojeno ✓</span>'}
    ${rate}
    ${mapPlan.show.inv ? planInvHtml() : ''}
    ${mapPlan.parked.length ? `<br><span class="muted">Ve skladu (klik a pak klik do mapy = položit):</span> ${mapPlan.parked.map((e, i) => { const m = S.ent.get(e.cityentity_id);
      return `<button class="fbtn ${mapPlan.pick === e ? 'on' : ''}" data-ppick="${i}">${e._inv ? '🎁 ' : ''}${esc(S.names.get(e.cityentity_id) || e.cityentity_id)} ${m ? `${m.w}×${m.l}` : ''}</button>`; }).join('')}` : ''}
    <br><span class="muted">Uložit plán:</span> <input id="planname" class="pname" placeholder="název varianty" value="${esc(mapPlan.name === PLAN_AUTO ? '' : mapPlan.name)}"> <button class="fbtn" data-pact="save">💾 Uložit</button>
    ${saved.length ? `<span class="muted">Varianty:</span> ${saved.map(([n, x]) => planVariantBtn(n, x)).join('')}` : ''}
    ${stepsHtml()}`;
}
function planVariantBtn(n, x) {
  const st = x.st || {};
  return `<span class="pvar"><button class="fbtn ${planOn() && mapPlan.name === n ? 'on' : ''}" data-pload="${esc(n)}" title="${esc(`cesty ${st.roads ?? '?'} · volno ${st.free ?? '?'}${st.val != null ? ` · Rating ${st.val}` : ''}${st.nc ? ` · nepřipojeno ${st.nc}` : ''} · ${new Date(x.t).toLocaleString(LOC())}`)}">📂 ${esc(n)} <span class="muted">${st.roads ?? '?'} cest · ${st.free ?? '?'} volno${st.val != null ? ` · R ${fmt(st.val)}` : ''}</span></button><button class="fbtn" data-pdel="${esc(n)}" title="Smazat variantu">✕</button></span>`;
}
// Budovy z inventáře ve hře (kolik ještě zbývá po těch, které už v plánu jsou), seřazené podle skóre Ratingu.
function planInvHtml() {
  const used = new Map();
  for (const e of [...mapPlan.list, ...mapPlan.parked]) if (e._inv) used.set(e._inv, (used.get(e._inv) || 0) + 1);
  const W = typeof rateW === 'function' ? rateW().filter((t) => t.on && t.per > 0) : [], bs = typeof rateBs === 'function' ? rateBs() : null;
  const rows = [];
  for (const [invId, it] of S.inv?.entries?.() || []) {
    const cid = it.item?.__class__ === 'BuildingItemPayload' ? it.item.cityEntityId : null, sz = cid && S.ent.get(cid);
    if (!sz || sz.type === 'street' || !(it.stock > 0)) continue;
    const left = it.stock - (used.get(invId) || 0);
    if (left <= 0) continue;
    let sc = null; try { if (W.length && !rateSkip(sz.type)) sc = rateOne(planInvEntity(cid), sz, W, bs).score; } catch { /* bez hodnocení */ }
    rows.push({ invId, name: it.name || S.names.get(cid) || cid, sz, left, sc });
  }
  rows.sort((a, c) => (c.sc ?? -1) - (a.sc ?? -1) || a.name.localeCompare(c.name));
  if (!rows.length) return '<br><span class="muted">V inventáři nejsou žádné budovy (nebo ještě nebyl načten – otevřete ve hře inventář).</span>';
  return `<br><span class="muted">🎁 Inventář (klik = do skladu plánu, pak klik do mapy):</span> ${rows.slice(0, 40).map((r) =>
    `<button class="fbtn" data-pinv="${esc(String(r.invId))}" title="${esc(`${r.name} ${r.sz.w}×${r.sz.l}${r.sz.road ? ', cesta' : ', bez cesty'} · zbývá ${r.left}`)}">${esc(r.name)} ${r.sz.w}×${r.sz.l}${r.sc != null ? ` <span class="muted">${dec((Math.round(r.sc * 100) / 100).toFixed(2))}</span>` : ''}${r.left > 1 ? ` ×${r.left}` : ''}</button>`).join('')}`;
}
function tipsHtml(M) {
  const T = swapTips(M);
  if (!T.length) return '';
  return `<br><span class="muted">💡 Prohození (budova bez potřeby cesty u cesty ⇄ stejně velká s cestou jinde; −N = o kolik polí cesty víc jde pak odebrat):</span> ${T.slice(0, 12).map((t, i) =>
    `<button class="fbtn ${mapTip === i ? 'on' : ''}" data-mtip="${i}" title="${esc(`${t.a.name} ⇄ ${t.b.name} – pak jde odebrat o ${t.gain} polí cesty víc (klik = ukázat, druhý klik = vyzkoušet v plánu)`)}">${esc(t.a.name)} ⇄ ${esc(t.b.name)} −${t.gain}</button>`).join('')}`;
}
let mapMode = 'type', mapFit = null; // obarvení mapy ('type' | 'rate'), zvýrazněná velikost volného místa ('w×l')
// Velikosti pro hledání místa: půdorysy budov z inventáře + pár běžných.
function fitSizes() {
  const s = new Set(['1×1', '2×2', '3×3', '4×4']);
  for (const it of S.inv?.values?.() || []) { const id = it.item?.__class__ === 'BuildingItemPayload' ? it.item.cityEntityId : null; const m = id && S.ent.get(id);
    if (m && it.stock > 0 && m.type !== 'street') s.add(`${Math.min(m.w, m.l)}×${Math.max(m.w, m.l)}`); }
  return [...s].sort((a, b) => { const [a1, a2] = a.split('×').map(Number), [b1, b2] = b.split('×').map(Number); return a1 * a2 - b1 * b2 || a1 - b1; });
}
// Skóre Ratingu podle budovy na mapě (stejné seskupení jako záložka Rating).
function mapRateScores() {
  const out = new Map();
  try { for (const b of ratedBuildings()) out.set(`${b.id}|${b.era}`, b.score); } catch { /* bez dat */ }
  return out;
}
const GRID_NAMES = { main: 'Město', cultural_outpost: 'Osada', era_outpost: 'Kolonie', guild_raids: 'Kvantové invaze' };
function mapSvg(M, t) {
  const W = M.maxX - M.minX + 1, Hh = M.maxY - M.minY + 1;
  const X = (x) => (x - M.minX) * t, Y = (y) => (y - M.minY) * t;
  let svg = `<svg width="${W * t}" height="${Hh * t}" style="background:#3d3a33;display:block" data-t="${t}" data-x0="${M.minX}" data-y0="${M.minY}">`;
  for (const k of M.tiles) { const [x, y] = k.split(',').map(Number); svg += `<rect x="${X(x)}" y="${Y(y)}" width="${t}" height="${t}" fill="#efe6d2"/>`; }
  const dead = new Set(M.deadRoads), bad = new Set(M.noRoadAtRoad), nc = new Set(M.notConnected), rem = new Set(M.removable || []);
  const sw = Math.max(1, t / 6);
  // Rating: barva od červené (nejhorší) po zelenou (nejlepší) podle pořadí skóre budov na mapě
  let rateCol = null, rateOf = null;
  if (mapMode === 'rate') {
    const sc = mapRateScores(), keyOf = (e) => { const m = S.entProd.get(e.cityentity_id) || S.entBoost.get(e.cityentity_id); return `${e.cityentity_id}|${m ? entEra(e, m, S.player?.era) : ''}`; };
    rateOf = (it) => sc.get(keyOf(it.e));
    const vals = [...new Set(M.items.map(rateOf).filter((v) => v != null))].sort((a, b) => a - b);
    rateCol = (v) => { if (v == null) return '#bdb5a6'; const q = vals.length > 1 ? vals.indexOf(v) / (vals.length - 1) : 1; return `hsl(${Math.round(q * 120)},65%,45%)`; };
  }
  for (const it of M.items) {
    const col = rateCol && !it.isRoad && !it.isImp && it.m.type !== 'main_building' ? rateCol(rateOf(it)) : it.isRoad ? '#8a8378' : it.isImp ? '#8b5a2b' : it.m.type === 'main_building' ? '#c0392b' : it.m.road > 1 ? '#2c5aa0' : it.m.road > 0 ? '#5b8fd6' : '#5aa05a';
    const stroke = nc.has(it) ? ` stroke="#e00" stroke-width="${sw * 1.5}"` : bad.has(it) ? ` stroke="#e8a317" stroke-width="${sw * 1.5}"` : ` stroke="#2b2116" stroke-width="${sw / 3}"`;
    if (it.isRoad) {
      for (let x = 0; x < it.m.w; x++) for (let y = 0; y < it.m.l; y++) { const k = `${it.x0 + x},${it.y0 + y}`;
        svg += `<rect x="${X(it.x0 + x)}" y="${Y(it.y0 + y)}" width="${t}" height="${t}" fill="${dead.has(k) ? '#d9534f' : rem.has(k) ? '#e8a317' : col}"/>`; }
      continue;
    }
    const rs = rateOf ? rateOf(it) : null;
    const tip = `${it.name} (${it.m.w}×${it.m.l}${it.m.road ? ', cesta ' + it.m.road : ', bez cesty'})${rs != null ? ` · skóre ${(Math.round(rs * 100) / 100).toLocaleString(LOC())}` : ''}`;
    svg += `<rect x="${X(it.x0) + 0.5}" y="${Y(it.y0) + 0.5}" width="${it.m.w * t - 1}" height="${it.m.l * t - 1}" fill="${col}"${stroke}><title>${esc(tip)}</title></rect>`;
    // název do větších budov, když je dost místa
    if (t >= 14 && it.m.w * t >= 40) {
      const fs = Math.min(11, t * 0.7);
      const maxCh = Math.floor((it.m.w * t - 4) / (fs * 0.55));
      const label = it.name.length > maxCh ? it.name.slice(0, Math.max(1, maxCh - 1)) + '…' : it.name;
      svg += `<text x="${X(it.x0) + it.m.w * t / 2}" y="${Y(it.y0) + it.m.l * t / 2 + fs / 3}" font-size="${fs}" text-anchor="middle" fill="#fff" pointer-events="none" style="font-family:system-ui,sans-serif">${esc(label)}</text>`;
    }
  }
  // zvolený krok postupu přestavby: odkud (modře čárkovaně), kam (růžově), cesty (obrys)
  const step = planOn() && mapPlan.step != null ? planSteps()[mapPlan.step] : null;
  if (step) {
    const fr = (b, c, dash) => `<rect x="${X(b.x)}" y="${Y(b.y)}" width="${b.w * t}" height="${b.l * t}" fill="${c}33" stroke="${c}" stroke-width="${Math.max(2, t / 3)}"${dash ? ` stroke-dasharray="${t / 2}"` : ''} pointer-events="none"/>`;
    if (step.from) svg += fr(step.from, '#1565c0', true);
    if (step.to) svg += fr(step.to, '#c2185b', false);
    if (step.from && step.to) svg += `<line x1="${X(step.from.x) + step.from.w * t / 2}" y1="${Y(step.from.y) + step.from.l * t / 2}" x2="${X(step.to.x) + step.to.w * t / 2}" y2="${Y(step.to.y) + step.to.l * t / 2}" stroke="#c2185b" stroke-width="${Math.max(1.5, t / 5)}" pointer-events="none"/>`;
    for (const k of step.tiles || []) { const [x, y] = k.split(',').map(Number); svg += `<rect x="${X(x) + 1}" y="${Y(y) + 1}" width="${t - 2}" height="${t - 2}" fill="none" stroke="${step.k === 'rdel' ? '#d32f2f' : '#1565c0'}" stroke-width="${Math.max(1.5, t / 5)}" pointer-events="none"/>`; }
  }
  // zvýrazněný tip na prohození
  const tip = mapTip != null ? swapTips(M)[mapTip] : null;
  if (tip) {
    const c = (it) => [X(it.x0) + it.m.w * t / 2, Y(it.y0) + it.m.l * t / 2];
    for (const it of [tip.a, tip.b]) svg += `<rect x="${X(it.x0)}" y="${Y(it.y0)}" width="${it.m.w * t}" height="${it.m.l * t}" fill="none" stroke="#c2185b" stroke-width="${Math.max(2, t / 3)}"/>`;
    const [x1, y1] = c(tip.a), [x2, y2] = c(tip.b);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c2185b" stroke-width="${Math.max(1.5, t / 5)}" stroke-dasharray="${t / 2}"/>`;
  }
  // volné místo pro zvolenou velikost
  if (mapFit) {
    const [fw, fl] = mapFit.split('×').map(Number);
    for (const s of freeFits(M, fw, fl)) svg += `<rect x="${X(s.x) + 1}" y="${Y(s.y) + 1}" width="${s.w * t - 2}" height="${s.l * t - 2}" fill="rgba(46,125,50,.25)" stroke="#2e7d32" stroke-width="${Math.max(1.5, t / 5)}" stroke-dasharray="${t / 2}"><title>${s.w}×${s.l}</title></rect>`;
  }
  return svg + '</svg>';
}
function mapStats(M, win) {
  if (win && planOn()) return planStats(M) + tipsHtml(M);
  const roadTiles = M.road.size, unl = M.tiles.size;
  const saved = Object.entries(plansOf(mapGrid));
  return `<button class="fbtn" data-pact="start" title="Kopie mapy, ve které můžete přesouvat budovy a cesty a hned vidíte úsporu – ve hře se nic nemění">✏️ Plánovat</button>${saved.length ? ` <span class="muted">nebo pokračovat:</span> ${saved.map(([n, x]) => planVariantBtn(n, x)).join('')}` : ''}
    <span class="chip">plocha ${fmt(unl)} polí</span><span class="chip">cesty ${fmt(roadTiles)} (${Math.round(roadTiles / unl * 100)} %)</span><span class="chip">volno ${fmt(M.free)}</span>
    ${M.removable?.length ? `<span class="chip hi" title="Tolik polí cesty jde odebrat, aniž by se odpojila některá budova (oranžově; červeně slepé konce)">odebratelné cesty ${M.removable.length}${M.deadRoads.length ? ` (slepé ${M.deadRoads.length})` : ''}</span>` : M.deadRoads.length ? `<span class="chip hi">zbytečné cesty ${M.deadRoads.length}</span>` : ''}
    ${(() => { const nr = M.items.filter((it) => !it.isRoad && !it.isImp && it.m.road > 0).length; return nr ? `<span class="chip" title="Polí cesty na jednu budovu, která cestu potřebuje">${dec((Math.round((M.road.size / nr) * 100) / 100).toFixed(2))} cesty / budovu</span>` : ''; })()}
    ${M.noRoadAtRoad.length ? `<span class="chip">bez potřeby cesty u cesty: ${M.noRoadAtRoad.length}</span>` : ''}
    ${M.notConnected.length ? `<span class="chip hi">nepřipojeno ${M.notConnected.length}</span>` : ''}
    <br><span class="muted">Obarvit:</span> ${[['type', 'podle druhu'], ['rate', 'podle Ratingu']].map(([k, l]) => `<button class="fbtn ${mapMode === k ? 'on' : ''}" data-mapmode="${k}">${l}</button>`).join('')}
    ${(() => { const lf = largestFree(M); return `<br><span class="muted">Volné místo${lf ? ` (největší ${lf.w}×${lf.l})` : ''}:</span> ${fitSizes().map((z) => { const [a, b] = z.split('×').map(Number); const n = freeFits(M, a, b).length;
      return `<button class="fbtn ${mapFit === z ? 'on' : ''}" data-mapfit="${z}" title="Kolik budov ${z} se vejde do volného místa (bez ohledu na cestu) – klik ukáže kam">${z}: ${n}×</button>`; }).join('')}`; })()}${tipsHtml(M)}`;
}
const MAP_LEGEND = '🟦 potřebuje cestu (tmavší = dvouproudou) · 🟩 cestu nepotřebuje · ⬛ cesta, <span style="color:#d9534f">červená</span> = slepá cesta k ničemu, <span style="color:#e8a317">oranžová</span> = cesta, kterou jde odebrat · zelený čárkovaný rámeček = kam se vejde zvolená velikost · v režimu Rating červená = nejhorší, zelená = nejlepší · 🟫 překážka · oranžový okraj = cestu nepotřebuje, a stojí u ní · červený okraj = nepřipojeno';
function gridPicker() {
  const grids = Object.keys(S.grids);
  if (!grids.includes(mapGrid)) mapGrid = grids[0];
  return grids.map((g) => `<button class="fbtn ${g === mapGrid ? 'on' : ''}" data-mapgrid="${g}">${GRID_NAMES[g] || g}</button>`).join('');
}
function viewMap() {
  if (!Object.keys(S.grids).length) return '<p class="muted">Načtěte hru (F5); pro osadu ji ve hře otevřete.</p>';
  const pick = gridPicker() + ' <button data-act="mapwin">Otevřít v okně ⤢</button>';
  const M = curModel();
  if (!M) return `<p>${pick}</p><p class="muted">Pro tuto mapu zatím nejsou data (budovy nebo rozměry z metadat) – obnovte hru a mapu otevřete.</p>`;
  const t = Math.max(3, Math.min(14, Math.floor(560 / (M.maxX - M.minX + 1))));
  return `<p>${pick}</p><p>${mapStats(M, true)}</p><div style="overflow:auto">${mapSvg(M, t)}</div>
    <p class="muted">${MAP_LEGEND}${M.missing ? ` · ${M.missing} budov bez rozměrů (chybí metadata)` : ''}</p>`;
}

// ---------- Okno kalkulačky VB (jedna pro vlastní i cizí budovy) ----------
const CALCWIN_KEY = 'foeReaderCalcWin';
let calcWin = null;
S.lastGb = null; // 'own' | 'foreign' – co bylo otevřeno naposledy
function gbOpened(kind) {
  S.lastGb = kind;
  if (cfg.gbCalcPopup && !calcWin) setTimeout(openCalcWin, 50); // počkat, až dorazí i budova (cizí VB)
  else if (calcWin) setTimeout(renderCalcWin, 50);
}
function calcWinHtml() {
  const html = S.lastGb === 'foreign' ? foreignCalcHtml() : ownCalcHtml();
  return html || '<p class="muted">Otevřete ve hře Velkou budovu (svou nebo jiného hráče).</p>';
}
function openCalcWin() {
  if (calcWin) { renderCalcWin(); return; }
  let st = { x: 120, y: 90 };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(CALCWIN_KEY) || '{}') }; } catch { /* ignore */ }
  const h = document.createElement('div');
  h.id = 'foe-reader-calc';
  h.style.cssText = `position:fixed;z-index:2147483646;left:${Math.max(0, Math.min(st.x, innerWidth - 200))}px;top:${Math.max(0, Math.min(st.y, innerHeight - 80))}px;width:${st.w || 560}px;height:${st.h || 460}px;resize:both;overflow:hidden;min-width:360px;min-height:160px;background:#fbf6ec;border:1px solid #8a6a3a;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.45);display:flex;flex-direction:column`;
  const r = h.attachShadow({ mode: 'open' });
  const css = root.querySelector('style')?.textContent || '';
  r.innerHTML = L(`<style>${css}
    :host{all:initial}
    .whead{display:flex;align-items:center;gap:8px;background:#2b2116;color:#f3d9a4;padding:5px 8px;cursor:move;user-select:none}
    .whead b{flex:1}
    .whead label{font-size:11px;cursor:pointer}
    .whead button{background:#4a3a26;color:#f3d9a4;border:1px solid #8a6a3a;border-radius:4px;padding:0 7px;cursor:pointer}
    .wbody{overflow:auto;padding:8px 10px;height:calc(100% - 30px)}
  </style><div class="whead" id="whead"><b>Kalkulačka VB</b>
    <label title="Otevřít samo s otevřením Velké budovy ve hře"><input type="checkbox" id="auto" ${cfg.gbCalcPopup ? 'checked' : ''}> otevírat samo</label>
    ${minBtn('id="min"', 'calc')}<button id="close" title="Zavřít">✕</button></div><div class="wbody" id="wbody"></div>`);
  document.documentElement.appendChild(h);
  toFront(h); h.addEventListener('pointerdown', () => toFront(h), true);
  calcWin = { host: h, root: r };
  // Po zavření okna hlásí ResizeObserver nulovou velikost – to neukládat (jinak se okno příště otevřelo vlevo nahoře).
  const save = () => { if (!h.isConnected) return; const b = h.getBoundingClientRect(); if (!b.width || !b.height) return; try { localStorage.setItem(CALCWIN_KEY, JSON.stringify({ x: b.left, y: b.top, w: b.width, h: winFullH(h, 'calc') })); } catch { /* ignore */ } };
  r.getElementById('whead').addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button,input,label')) return;
    const sx = ev.clientX, sy = ev.clientY, b = h.getBoundingClientRect();
    const mv = (e) => { h.style.left = Math.max(0, b.left + e.clientX - sx) + 'px'; h.style.top = Math.max(0, b.top + e.clientY - sy) + 'px'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); save(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  r.getElementById('close').addEventListener('click', () => { save(); h.remove(); calcWin = null; });
  const chead = r.getElementById('whead'), ctoggle = () => winSetCollapsed(h, 'calc', chead, !winCollapsed('calc'), 160);
  r.getElementById('min').addEventListener('click', ctoggle);
  chead.addEventListener('dblclick', (ev) => { if (!ev.target.closest('button,input,label')) ctoggle(); });
  if (winCollapsed('calc')) winSetCollapsed(h, 'calc', chead, true, 160);
  r.getElementById('auto').addEventListener('change', (ev) => { cfg.gbCalcPopup = ev.target.checked; saveCfg(); render(); });
  r.addEventListener('click', (ev) => {
    const fb = ev.target.closest('[data-factor]');
    if (fb) { cfg.arcFactor = fb.dataset.factor === 'arc' ? 'arc' : +fb.dataset.factor; saveCfg(); renderCalcWin(); render(); return; }
    const cp = ev.target.closest('[data-act="copy"]');
    if (cp) {
      const done = () => { cp.textContent = 'Zkopírováno ✓'; setTimeout(() => { cp.textContent = 'Kopírovat'; }, 1500); };
      (navigator.clipboard?.writeText(cp.dataset.text) || Promise.reject()).then(done).catch(() => {
        const inp = cp.parentElement.querySelector('.copytext'); inp.select(); document.execCommand('copy'); done();
      });
    }
  });
  r.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-cfg]');
    if (el) { cfg[el.dataset.cfg] = +el.value; saveCfg(); renderCalcWin(); render(); }
  });
  new ResizeObserver(save).observe(h);
  renderCalcWin();
}
function renderCalcWin() {
  if (!calcWin) return;
  const r = calcWin.root;
  const act = r.activeElement;
  if (act && act.tagName === 'INPUT' && !act.readOnly && act.type !== 'checkbox') return; // nepřepisovat rozepsanou hodnotu
  const auto = r.getElementById('auto');
  if (auto) auto.checked = !!cfg.gbCalcPopup;
  const body = r.getElementById('wbody');
  const keep = body.scrollTop;
  body.innerHTML = L(calcWinHtml());
  body.scrollTop = keep;
}

// ---------- Samostatné okno mapy (přesun, změna velikosti, zoom kolečkem, posun tažením) ----------
const MAPWIN_KEY = 'foeReaderMapWin';
let mapWin = null;
function mapWinState() {
  try { return { x: 80, y: 60, w: 900, h: 650, zoom: 12, ...JSON.parse(localStorage.getItem(MAPWIN_KEY) || '{}') }; }
  catch { return { x: 80, y: 60, w: 900, h: 650, zoom: 12 }; }
}
function saveMapWin() {
  if (!mapWin) return;
  const r = mapWin.host.getBoundingClientRect();
  try { localStorage.setItem(MAPWIN_KEY, JSON.stringify({ x: r.left, y: r.top, w: r.width, h: winFullH(mapWin.host, 'map'), zoom: mapWin.zoom })); } catch { /* ignore */ }
}
function openMapWin() {
  if (mapWin) { renderMapWin(); return; }
  const st = mapWinState();
  const h = document.createElement('div');
  h.id = 'foe-reader-map';
  h.style.cssText = `position:fixed;z-index:2147483646;left:${Math.max(0, st.x)}px;top:${Math.max(0, st.y)}px;width:${st.w}px;height:${st.h}px;resize:both;overflow:hidden;min-width:320px;min-height:240px;background:#fbf6ec;border:1px solid #8a6a3a;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.45)`;
  const r = h.attachShadow({ mode: 'open' });
  r.innerHTML = `<style>
    *{box-sizing:border-box;font-family:system-ui,Segoe UI,sans-serif;font-size:12px}
    .wrap{display:flex;flex-direction:column;height:100%;color:#2b2116}
    .head{display:flex;align-items:center;gap:6px;background:#2b2116;color:#f3d9a4;padding:5px 8px;cursor:move;user-select:none;flex-wrap:wrap}
    .head b{margin-right:6px}
    .head button{background:#4a3a26;color:#f3d9a4;border:1px solid #8a6a3a;border-radius:4px;padding:1px 7px;cursor:pointer}
    .head button.on{background:#f3d9a4;color:#2b2116}
    .head .sp{flex:1}
    .stats{padding:4px 8px;background:#f3ead6}
    .chip{display:inline-block;background:#efe3c8;border-radius:10px;padding:1px 8px;margin:0 4px 2px 0}
    .chip.hi{color:#b0410f;font-weight:700}
    .view{flex:1;overflow:auto;cursor:grab;background:#3d3a33}
    .view.drag{cursor:grabbing}
    .leg{padding:3px 8px;color:#7a6a50;font-size:11px}
    .fbtn{background:#fff;border:1px solid #c9b48c;border-radius:4px;padding:1px 6px;margin:0 3px 2px 0;cursor:pointer}
    .fbtn.on{background:#2b2116;color:#f3d9a4;border-color:#2b2116;font-weight:700}
    .fbtn:disabled{opacity:.45;cursor:default}
    .muted{color:#7a6a50}
    .stats{max-height:45%;overflow:auto}
    .pname{width:150px;padding:1px 4px;border:1px solid #c9b48c;border-radius:4px}
    .pvar{white-space:nowrap;margin-right:4px}
    ol.steps{margin:3px 0 3px 18px;padding:0}
    ol.steps a{color:#2b2116;text-decoration:none}
    ol.steps a.on{background:#c2185b;color:#fff;border-radius:3px;padding:0 3px}
  </style><div class="wrap"><div class="head" id="head"></div><div class="stats" id="stats"></div><div class="view" id="view"></div><div class="leg">${MAP_LEGEND} · kolečko = zoom, tažení = posun · ✏️ v plánu: tažení budovy = přesun, růžový rámeček = tip na prohození (2. klik na tip = vyzkoušet)</div></div>`;
  document.documentElement.appendChild(h);
  toFront(h); h.addEventListener('pointerdown', () => toFront(h), true);
  mapWin = { host: h, root: r, zoom: st.zoom };
  const view = r.getElementById('view');
  // přesun okna za hlavičku
  r.getElementById('head').addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button')) return;
    const sx = ev.clientX, sy = ev.clientY, rect = h.getBoundingClientRect();
    const mv = (e) => { h.style.left = Math.max(0, rect.left + e.clientX - sx) + 'px'; h.style.top = Math.max(0, rect.top + e.clientY - sy) + 'px'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); saveMapWin(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  // posun mapy tažením; v plánu nástroje (přesun budovy tažením, cesta, sklad, položení ze skladu)
  view.addEventListener('pointerdown', (ev) => {
    if (planOn() && planPointer(ev, view)) return;
    const sx = ev.clientX, sy = ev.clientY, l = view.scrollLeft, t = view.scrollTop;
    view.classList.add('drag');
    const mv = (e) => { view.scrollLeft = l - (e.clientX - sx); view.scrollTop = t - (e.clientY - sy); };
    const up = () => { view.classList.remove('drag'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  // zoom kolečkem kolem kurzoru
  view.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = view.getBoundingClientRect();
    const px = ev.clientX - rect.left + view.scrollLeft, py = ev.clientY - rect.top + view.scrollTop;
    const old = mapWin.zoom;
    mapWin.zoom = Math.max(3, Math.min(40, Math.round(old * (ev.deltaY < 0 ? 1.2 : 1 / 1.2))));
    if (mapWin.zoom === old) return;
    renderMapWin();
    const k = mapWin.zoom / old;
    view.scrollLeft = px * k - (ev.clientX - rect.left);
    view.scrollTop = py * k - (ev.clientY - rect.top);
    saveMapWin();
  }, { passive: false });
  // psaní do pole (název plánu) nesmí jít do hry jako klávesové zkratky
  for (const t of ['keydown', 'keyup', 'keypress']) h.addEventListener(t, (e) => e.stopPropagation());
  r.addEventListener('click', (ev) => {
    const b = ev.target.closest('button,a[data-pstep]');
    if (!b) return;
    if (b.tagName === 'A') ev.preventDefault();
    if (mapClick(b)) return;
    if (b.dataset.mapgrid) { mapGrid = b.dataset.mapgrid; renderMapWin(true); render(); }
    else if (b.dataset.mapmode) { mapMode = b.dataset.mapmode; renderMapWin(); render(); }
    else if (b.dataset.mapfit) { mapFit = mapFit === b.dataset.mapfit ? null : b.dataset.mapfit; renderMapWin(); render(); }
    else if (b.dataset.z === 'in') { mapWin.zoom = Math.min(40, Math.round(mapWin.zoom * 1.25)); renderMapWin(); saveMapWin(); }
    else if (b.dataset.z === 'out') { mapWin.zoom = Math.max(3, Math.round(mapWin.zoom / 1.25)); renderMapWin(); saveMapWin(); }
    else if (b.dataset.z === 'fit') { renderMapWin(true); saveMapWin(); }
    else if (b.dataset.z === 'min') winSetCollapsed(h, 'map', r.getElementById('head'), !winCollapsed('map'), 240);
    else if (b.dataset.z === 'close') { saveMapWin(); h.remove(); mapWin = null; }
  });
  new ResizeObserver(() => saveMapWin()).observe(h);
  renderMapWin(!localStorage.getItem(MAPWIN_KEY));
  r.getElementById('head').addEventListener('dblclick', (ev) => { if (!ev.target.closest('button,select')) winSetCollapsed(h, 'map', r.getElementById('head'), !winCollapsed('map'), 240); });
  if (winCollapsed('map')) winSetCollapsed(h, 'map', r.getElementById('head'), true, 240);
}
// Pole mapy pod kurzorem (podle vykresleného SVG).
function planTileAt(view, cx, cy) {
  const svg = view.querySelector('svg');
  if (!svg) return null;
  const b = svg.getBoundingClientRect(), t = +svg.dataset.t;
  return { x: Math.floor((cx - b.left) / t) + +svg.dataset.x0, y: Math.floor((cy - b.top) / t) + +svg.dataset.y0, t, svg };
}
function planPointer(ev, view) {
  const M = planModel(), p = planTileAt(view, ev.clientX, ev.clientY);
  if (!p) return false;
  const it = M.occ.get(`${p.x},${p.y}`), tool = mapPlan.tool;
  const done = () => { renderMapWin(); render(); };
  if (mapPlan.pick) { if (planPlace(M, mapPlan.pick, p.x, p.y)) done(); return true; }
  if (tool === 'road' || tool === 'road2') { if (planRoad(M, p.x, p.y, tool === 'road2')) done(); return true; }
  if (tool === 'park') { if (it && !it.isImp) { planPark(it); done(); } return true; }
  if (!it || it.isImp) return false; // prázdné pole = posun mapy
  // tažení budovy / cesty: průhledný obrys ukazuje, jestli se na nové místo vejde
  ev.preventDefault();
  const NS = 'http://www.w3.org/2000/svg', g = document.createElementNS(NS, 'rect');
  g.setAttribute('width', it.m.w * p.t); g.setAttribute('height', it.m.l * p.t); g.setAttribute('pointer-events', 'none');
  p.svg.appendChild(g);
  const offX = p.x - it.x0, offY = p.y - it.y0;
  let nx = it.x0, ny = it.y0;
  const place = (e) => {
    const q = planTileAt(view, e.clientX, e.clientY);
    nx = q.x - offX; ny = q.y - offY;
    const ok = planFits(M, it.e, nx, ny);
    g.setAttribute('x', (nx - +p.svg.dataset.x0) * p.t); g.setAttribute('y', (ny - +p.svg.dataset.y0) * p.t);
    g.setAttribute('fill', ok ? 'rgba(46,125,50,.45)' : 'rgba(211,47,47,.45)'); g.setAttribute('stroke', ok ? '#2e7d32' : '#d32f2f'); g.setAttribute('stroke-width', 2);
  };
  place(ev);
  const up = () => {
    window.removeEventListener('pointermove', place); window.removeEventListener('pointerup', up);
    g.remove();
    if (planFits(M, it.e, nx, ny)) { planMove(it.e, nx, ny); done(); }
  };
  window.addEventListener('pointermove', place); window.addEventListener('pointerup', up);
  return true;
}
function renderMapWin(fit) {
  if (!mapWin) return;
  const r = mapWin.root;
  const M = Object.keys(S.grids).length ? curModel() : null;
  r.getElementById('head').innerHTML = L(`<b>FoE Reader – mapa</b>${Object.keys(S.grids).length ? gridPicker().replace(/class="fbtn /g, 'class="') : ''}
    <span class="sp"></span><button data-z="out" title="Oddálit">−</button><button data-z="fit" title="Přizpůsobit oknu">⤢</button><button data-z="in" title="Přiblížit">+</button>${minBtn('data-z="min"', 'map')}<button data-z="close" title="Zavřít">✕</button>`);
  const view = r.getElementById('view');
  if (!M) { r.getElementById('stats').innerHTML = ''; view.innerHTML = L('<p style="color:#efe6d2;padding:10px">Pro tuto mapu zatím nejsou data.</p>'); return; }
  if (fit) {
    const W = M.maxX - M.minX + 1, Hh = M.maxY - M.minY + 1;
    mapWin.zoom = Math.max(3, Math.min(40, Math.floor(Math.min((view.clientWidth || 800) / W, (view.clientHeight || 500) / Hh))));
  }
  if (r.activeElement?.id !== 'planname') r.getElementById('stats').innerHTML = L(mapStats(M, true) + (M.missing ? `<span class="chip">${M.missing} budov bez rozměrů</span>` : ''));
  const sl = view.scrollLeft, stp = view.scrollTop;
  view.innerHTML = L(mapSvg(M, mapWin.zoom));
  view.scrollLeft = sl; view.scrollTop = stp;
}

function viewResources() {
  const r = S.resources;
  if (!Object.keys(r).length) return '<p class="muted">Zatím žádná data.</p>';
  const packs = [...(S.fpPacks?.values() || [])].filter((x) => x.stock > 0).sort((a, b) => b.gain - a.gain)
    .map((x) => `${fmt(x.stock)}× ${x.gain} FP`).join(', ');
  const main = [['Forge body (FP) – v liště', 'strategy_points'], [`FP v balíčcích${packs ? ` <span class="muted">(${packs})</span>` : ''}`, '__packageFP'], ['<b>FP celkem</b>', '__totalFP'], ['Diamanty', 'premium'], ['Mince', 'money'],
    ['Zásoby', 'supplies'], ['Medaile', 'medals'], ['Pokusy expedice', 'guild_expedition_attempt']];
  const era = S.player?.era;
  const goods = [...S.goodsEra].filter(([, e]) => e === era).map(([id]) => id);
  return `${S.player ? `<p><b>${esc(S.player.user_name)}</b> · ${esc(era)} · ${esc(S.player.clan_name || '')}</p>` : ''}
    <table><tbody>${main.map(([l, k]) => `<tr><td>${l}</td><td class="num">${fmt(k === '__packageFP' ? S.packageFP : k === '__totalFP' ? (r.strategy_points || 0) + (S.packageFP || 0) : r[k])}</td></tr>`).join('')}</tbody></table>
    ${goods.length ? `<h4>Zboží aktuálního věku</h4><table><tbody>${goods.map((g) =>
      `<tr><td>${esc(S.goodsName.get(g) || g)}</td><td class="num">${fmt(r[g])}</td></tr>`).join('')}</tbody></table>` : ''}`;
}
