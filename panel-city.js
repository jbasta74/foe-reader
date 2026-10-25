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
function mapModel(gridId) {
  const g = S.grids[gridId];
  const list = gridId === 'main' ? [...S.entities.values()].filter((e) => (e.player_id == null || e.player_id === myId()))
    : (S.gridMap?.[gridId] ? [...S.gridMap[gridId].entities.values()] : []);
  if (!g || !list.length) return null;
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
  const notConnected = items.filter((it) => !it.isRoad && it.m.road > 0 && !it.e.connected);
  const xs = [...tiles].map((k) => +k.split(',')[0]), ys = [...tiles].map((k) => +k.split(',')[1]);
  return { tiles, items, occ, road, deadRoads, free, noRoadAtRoad, notConnected, missing,
    minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
const GRID_NAMES = { main: 'Město', cultural_outpost: 'Osada', era_outpost: 'Kolonie', guild_raids: 'Kvantové invaze' };
function mapSvg(M, t) {
  const W = M.maxX - M.minX + 1, Hh = M.maxY - M.minY + 1;
  const X = (x) => (x - M.minX) * t, Y = (y) => (y - M.minY) * t;
  let svg = `<svg width="${W * t}" height="${Hh * t}" style="background:#3d3a33;display:block">`;
  for (const k of M.tiles) { const [x, y] = k.split(',').map(Number); svg += `<rect x="${X(x)}" y="${Y(y)}" width="${t}" height="${t}" fill="#efe6d2"/>`; }
  const dead = new Set(M.deadRoads), bad = new Set(M.noRoadAtRoad), nc = new Set(M.notConnected);
  const sw = Math.max(1, t / 6);
  for (const it of M.items) {
    const col = it.isRoad ? '#8a8378' : it.isImp ? '#8b5a2b' : it.m.type === 'main_building' ? '#c0392b' : it.m.road > 1 ? '#2c5aa0' : it.m.road > 0 ? '#5b8fd6' : '#5aa05a';
    const stroke = nc.has(it) ? ` stroke="#e00" stroke-width="${sw * 1.5}"` : bad.has(it) ? ` stroke="#e8a317" stroke-width="${sw * 1.5}"` : ` stroke="#2b2116" stroke-width="${sw / 3}"`;
    if (it.isRoad) {
      for (let x = 0; x < it.m.w; x++) for (let y = 0; y < it.m.l; y++) { const k = `${it.x0 + x},${it.y0 + y}`;
        svg += `<rect x="${X(it.x0 + x)}" y="${Y(it.y0 + y)}" width="${t}" height="${t}" fill="${dead.has(k) ? '#d9534f' : col}"/>`; }
      continue;
    }
    const tip = `${it.name} (${it.m.w}×${it.m.l}${it.m.road ? ', cesta ' + it.m.road : ', bez cesty'})`;
    svg += `<rect x="${X(it.x0) + 0.5}" y="${Y(it.y0) + 0.5}" width="${it.m.w * t - 1}" height="${it.m.l * t - 1}" fill="${col}"${stroke}><title>${esc(tip)}</title></rect>`;
    // název do větších budov, když je dost místa
    if (t >= 14 && it.m.w * t >= 40) {
      const fs = Math.min(11, t * 0.7);
      const maxCh = Math.floor((it.m.w * t - 4) / (fs * 0.55));
      const label = it.name.length > maxCh ? it.name.slice(0, Math.max(1, maxCh - 1)) + '…' : it.name;
      svg += `<text x="${X(it.x0) + it.m.w * t / 2}" y="${Y(it.y0) + it.m.l * t / 2 + fs / 3}" font-size="${fs}" text-anchor="middle" fill="#fff" pointer-events="none" style="font-family:system-ui,sans-serif">${esc(label)}</text>`;
    }
  }
  return svg + '</svg>';
}
function mapStats(M) {
  const roadTiles = M.road.size, unl = M.tiles.size;
  return `<span class="chip">plocha ${fmt(unl)} polí</span><span class="chip">cesty ${fmt(roadTiles)} (${Math.round(roadTiles / unl * 100)} %)</span><span class="chip">volno ${fmt(M.free)}</span>
    ${M.deadRoads.length ? `<span class="chip hi">zbytečné cesty ${M.deadRoads.length}</span>` : ''}
    ${M.noRoadAtRoad.length ? `<span class="chip">bez potřeby cesty u cesty: ${M.noRoadAtRoad.length}</span>` : ''}
    ${M.notConnected.length ? `<span class="chip hi">nepřipojeno ${M.notConnected.length}</span>` : ''}`;
}
const MAP_LEGEND = '🟦 potřebuje cestu (tmavší = dvouproudou) · 🟩 cestu nepotřebuje · ⬛ cesta, <span style="color:#d9534f">červená</span> = slepá cesta k ničemu · 🟫 překážka · oranžový okraj = cestu nepotřebuje, a stojí u ní · červený okraj = nepřipojeno';
function gridPicker() {
  const grids = Object.keys(S.grids);
  if (!grids.includes(mapGrid)) mapGrid = grids[0];
  return grids.map((g) => `<button class="fbtn ${g === mapGrid ? 'on' : ''}" data-mapgrid="${g}">${GRID_NAMES[g] || g}</button>`).join('');
}
function viewMap() {
  if (!Object.keys(S.grids).length) return '<p class="muted">Načtěte hru (F5); pro osadu ji ve hře otevřete.</p>';
  const pick = gridPicker() + ' <button data-act="mapwin">Otevřít v okně ⤢</button>';
  const M = mapModel(mapGrid);
  if (!M) return `<p>${pick}</p><p class="muted">Pro tuto mapu zatím nejsou data (budovy nebo rozměry z metadat) – obnovte hru a mapu otevřete.</p>`;
  const t = Math.max(3, Math.min(14, Math.floor(560 / (M.maxX - M.minX + 1))));
  return `<p>${pick}</p><p>${mapStats(M)}</p><div style="overflow:auto">${mapSvg(M, t)}</div>
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
  </style><div class="wrap"><div class="head" id="head"></div><div class="stats" id="stats"></div><div class="view" id="view"></div><div class="leg">${MAP_LEGEND} · kolečko = zoom, tažení = posun</div></div>`;
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
  // posun mapy tažením
  view.addEventListener('pointerdown', (ev) => {
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
  r.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.mapgrid) { mapGrid = b.dataset.mapgrid; renderMapWin(true); render(); }
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
function renderMapWin(fit) {
  if (!mapWin) return;
  const r = mapWin.root;
  const M = Object.keys(S.grids).length ? mapModel(mapGrid) : null;
  r.getElementById('head').innerHTML = L(`<b>FoE Reader – mapa</b>${Object.keys(S.grids).length ? gridPicker().replace(/class="fbtn /g, 'class="') : ''}
    <span class="sp"></span><button data-z="out" title="Oddálit">−</button><button data-z="fit" title="Přizpůsobit oknu">⤢</button><button data-z="in" title="Přiblížit">+</button>${minBtn('data-z="min"', 'map')}<button data-z="close" title="Zavřít">✕</button>`);
  const view = r.getElementById('view');
  if (!M) { r.getElementById('stats').innerHTML = ''; view.innerHTML = L('<p style="color:#efe6d2;padding:10px">Pro tuto mapu zatím nejsou data.</p>'); return; }
  if (fit) {
    const W = M.maxX - M.minX + 1, Hh = M.maxY - M.minY + 1;
    mapWin.zoom = Math.max(3, Math.min(40, Math.floor(Math.min((view.clientWidth || 800) / W, (view.clientHeight || 500) / Hh))));
  }
  r.getElementById('stats').innerHTML = L(mapStats(M) + (M.missing ? `<span class="chip">${M.missing} budov bez rozměrů</span>` : ''));
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
