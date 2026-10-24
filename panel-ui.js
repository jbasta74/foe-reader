// FoE Reader – panel-ui.js
// UI: panel, nástrojová lišta, okna záložek, přetahování, vykreslování.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ===================== UI =====================
let root, body, host;
function mount() {
  host = document.createElement('div');
  host.id = 'foe-reader-host';
  // Plovoucí: pozice se dá přetáhnout a pamatuje si ji prohlížeč.
  host.style.cssText = 'position:fixed;z-index:2147483647;width:max-content;';
  const pos = loadPos();
  host.style.left = pos.x + 'px';
  host.style.top = pos.y + 'px';
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:system-ui,Segoe UI,sans-serif;font-size:12px}
    .btn{background:#2b2116;color:#f3d9a4;border:1px solid #8a6a3a;border-radius:6px;padding:4px 10px;cursor:grab;font-weight:600;white-space:nowrap;touch-action:none;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.4)}
    .btn.drag{cursor:grabbing;opacity:.85}
    .bar{display:flex;align-items:center;gap:3px}
    .bar.vert{flex-direction:column;align-items:stretch}
    .icons{display:flex;gap:3px}.bar.vert .icons{flex-direction:column}
    .ico{position:relative;width:34px;height:30px;background:#2b2116;border:1px solid #8a6a3a;border-radius:6px;cursor:pointer;font-size:16px;line-height:1;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.4)}
    .ico:hover{background:#4a3a26}.ico.on{background:#8a6a3a;border-color:#f3d9a4}
    .ico .bdg{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#b0410f;color:#fff;font-size:10px;font-weight:700;line-height:16px;padding:0 3px}
    .ico.alert{animation:pulse 1s ease-in-out infinite}
    .panel{display:none;position:absolute;top:calc(100% + 6px);left:0;width:580px;max-width:96vw;background:#fbf6ec;color:#2b2116;border:1px solid #8a6a3a;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.35);overflow:hidden;flex-direction:column}
    .panel.open{display:flex}
    .tabs{display:flex;flex-wrap:wrap;background:#2b2116}
    .tabs button{flex:1 0 auto;background:none;border:0;color:#d9c4a0;padding:7px 5px;cursor:pointer;white-space:nowrap}
    .tabs button.on{background:#fbf6ec;color:#2b2116;font-weight:700}
    .body{overflow:auto;padding:8px 10px;flex:1;min-height:0}
    .panel{resize:both;min-width:320px;min-height:180px}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;font-weight:600;border-bottom:1px solid #d8c8a8;padding:3px 4px;position:sticky;top:0;background:#fbf6ec}
    td{padding:3px 4px;border-bottom:1px solid #eee3cd}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .muted{color:#9a8a70}
    .hi{color:#b0410f;font-weight:700}
    .chip{display:inline-block;background:#efe3c8;border-radius:10px;padding:1px 8px;margin:0 4px 4px 0}
    h4{margin:10px 0 4px}
    ul{margin:0;padding-left:18px}
    pre{background:#2b2116;color:#f3e7cf;padding:8px;border-radius:6px;max-height:300px;overflow:auto;font:11px/1.35 Consolas,monospace;white-space:pre-wrap}
    table.log tr{cursor:pointer} table.log tr:hover td{background:#f3ead6} tr.sel td{background:#efe0bd}
    button[data-act]{background:#2b2116;color:#f3d9a4;border:0;border-radius:5px;padding:4px 10px;cursor:pointer}
    .btn.alert{background:#b0410f;border-color:#ffcf8a;color:#fff;animation:pulse 1s ease-in-out infinite}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,140,40,.9)}50%{box-shadow:0 0 0 8px rgba(255,140,40,0)}}
    .star{background:none;border:0;cursor:pointer;font-size:15px;color:#b0410f;padding:0 2px;line-height:1}
    .cfg{display:flex;flex-direction:column;gap:6px;background:#f3ead6;border-radius:6px;padding:8px}
    .cfg label{margin-right:10px;white-space:nowrap}
    input[type=number],input.pname{border:1px solid #c9b48c;border-radius:4px;padding:1px 4px;background:#fff}
    input.pname{width:140px}
    .copyrow{display:flex;gap:6px}
    a{color:#8a4b12}
    .good{display:inline-block;margin:0 10px 1px 0;white-space:nowrap}
    .good.low{text-decoration:underline;text-decoration-color:#b0410f}
    table.stock td{vertical-align:top}
    .fbtn{background:#fff;border:1px solid #c9b48c;border-radius:4px;padding:1px 6px;margin-right:3px;cursor:pointer}
    .fbtn.on{background:#2b2116;color:#f3d9a4;border-color:#2b2116;font-weight:700}
    table.neg{table-layout:fixed;width:100%}table.neg td,table.neg th{word-break:break-word;font-size:12px}table.neg td:first-child,table.neg th:first-child{width:52px}
    .gicon{display:inline-block;vertical-align:middle;background-repeat:no-repeat}table.neg td{text-align:center}
    .incgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
    .inccard{background:#f3ead6;border:1px solid #e0d2b4;border-radius:6px;padding:5px;text-align:center;font-size:11px;line-height:1.3}
    .inccard img{display:block;margin:0 auto 3px;height:44px;object-fit:contain}
    .inccard.rare{border-color:#b0410f;box-shadow:0 0 0 1px #b0410f inset;background:#fbe3c8}
    .inccard.uncommon{border-color:#5b8fd6;background:#e6eefa}
    .inccard .incname{font-weight:600}
    .inccard .noimg{height:44px;line-height:44px;color:#9a8a70;font-size:20px}
    td.ng.ok{background:#d6efc7}td.ng.wp{background:#fbe3b4}td.ng.nn{background:#e6e0d6;color:#7a6f60}
    .fbtn.arc{border-color:#b5651d;color:#8a4a12;font-weight:700}
    .fbtn.arc.on{background:#b5651d;color:#fff;border-color:#b5651d}
    tr.safe td{background:#d6efc7}
    .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin:4px 0 6px}
    .tile{background:#f3ead6;border:1px solid #e0d2b4;border-radius:8px;padding:7px 9px}
    .tile .tl{font-size:11px;color:#8a7a60}.tile .tb{font-size:21px;font-family:Georgia,serif;margin:2px 0}.tile .ts{font-size:11px;color:#8a7a60}
    .tile .ts.up{color:#2e7d32}.tile .ts.down{color:#b0410f}
    svg.chart{display:block;background:#fbf6ec}svg.chart .hov{fill:transparent;cursor:crosshair}svg.chart .hov:hover{fill:rgba(138,106,58,.12)}
    .legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:#7a6a50;margin:2px 0 6px}.legend i{display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:4px;vertical-align:middle}
    .seg{margin:2px 0 4px}
    .ctip{position:fixed;z-index:2147483647;pointer-events:none;background:#fff;border:1px solid #c9b48c;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.25);padding:4px 8px;font-size:11px;line-height:1.45;white-space:nowrap;display:none}
    .bt{display:inline-block;min-width:18px;text-align:center;border-radius:4px;font-size:11px;line-height:16px;padding:0 2px;color:#fff}
    .bt.red{background:#c0392b}.bt.blue{background:#2e6db4}
    .turns{display:inline-block;font-size:15px;padding:4px 12px;margin:2px 0 4px;border-radius:6px;background:#d6efc7;color:#1f4d1f}.turns b{font-size:17px}
    .turns.last{background:#fbe3b4;color:#7a4a00}.turns.out{background:#b0410f;color:#fff;font-weight:700}
    .up{color:#2e7d32;font-weight:600}.down{color:#b0410f;font-weight:600}
    .copytext{flex:1;border:1px solid #c9b48c;border-radius:4px;padding:3px 6px;background:#fff;font-family:Consolas,monospace}
  </style>
  <div class="bar" id="bar"><button class="btn" id="toggle" title="FoE Reader ${VERSION} · klik = panel se záložkami, táhnout = přesunout">⠿ FoE Reader</button><span class="icons" id="icons"></span></div>
  <div class="panel" id="panel"><div class="tabs" id="tabs"></div><div class="body" id="body"></div></div>`;
  body = root.getElementById('body');
  renderTabs();
  renderIcons();
  updateBadge(); // v režimu lišty jen ⠿
  setupDrag(root.getElementById('toggle'), () => {
    open = !open; root.getElementById('panel').classList.toggle('open', open); render();
    placing = true; placePanel(); setTimeout(() => { placing = false; }, 400);
  });
  window.addEventListener('resize', () => { clampHost(); placePanel(); });
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    const ic = ev.target.closest('[data-ico]');
    if (ic) { const id = ic.dataset.ico; tabWins.has(id) ? closeTabWin(id) : openTabWin(id); return; }
    if (ev.target.closest('[data-act="popout"]')) { openTabWin(tab); return; }
    onUiClick(ev);
  });
  root.addEventListener('input', () => { lastInputAt = Date.now(); });
  root.addEventListener('change', onUiChange);
  attachTips(root, host);
  attach();
  // Hra si stránku po načtení přestavuje – když panel zmizí, vrátíme ho.
  setInterval(() => { if (!host.isConnected) attach(); }, 2000);
  restoreTabWins();
  watchPanelSize();
  console.log('[FoE Reader] panel připraven');
}
// Popisky grafů (data-tip) – pro panel i samostatná okna.
function attachTips(r, hostEl) {
  let tip = null;
  const hide = () => { if (tip) tip.style.display = 'none'; };
  r.addEventListener('mousemove', (ev) => {
    const t = ev.target.closest?.('[data-tip]');
    if (!t) return hide();
    if (!tip || !tip.isConnected) { tip = document.createElement('div'); tip.className = 'ctip'; r.appendChild(tip); }
    if (tip.dataset.k !== t.dataset.tip) { tip.innerHTML = t.dataset.tip; tip.dataset.k = t.dataset.tip; }
    tip.style.display = 'block';
    tip.style.left = Math.max(4, Math.min(innerWidth - tip.offsetWidth - 4, ev.clientX + 14)) + 'px';
    tip.style.top = Math.max(4, ev.clientY - tip.offsetHeight - 10) + 'px';
  });
  hostEl.addEventListener('mouseleave', hide);
}
// Společné ovládání pro panel i samostatná okna záložek.
function onUiClick(ev) {
  {
    const r = ev.target.closest('tr[data-key]');
    if (r) { selectedKey = r.dataset.key === selectedKey ? null : r.dataset.key; render(); return; }
    if (ev.target.closest('[data-act="download"]')) download();
    const sp = ev.target.closest('tr[data-statpid]');
    if (sp) { statSel = statSel === sp.dataset.statpid ? null : sp.dataset.statpid; render(); return; }
    const gv = ev.target.closest('[data-gbgview]');
    if (gv) { gbgView = gv.dataset.gbgview; render(); return; }
    const gp = ev.target.closest('[data-guildper]');
    if (gp) { guildPer = +gp.dataset.guildper; render(); return; }
    const gs = ev.target.closest('[data-guildsort]');
    if (gs) { guildSort = gs.dataset.guildsort; render(); return; }
    const gm = ev.target.closest('tr[data-guildpid]');
    if (gm) { guildSel = guildSel === gm.dataset.guildpid ? null : gm.dataset.guildpid; render(); return; }
    const sv = ev.target.closest('[data-statview]');
    if (sv) { statView = sv.dataset.statview; render(); return; }
    const sa2 = ev.target.closest('[data-statarea]');
    if (sa2) { statArea = sa2.dataset.statarea; render(); return; }
    const sm = ev.target.closest('[data-statmetric]');
    if (sm) { statMetric = sm.dataset.statmetric; render(); return; }
    if (ev.target.closest('[data-act="bonusunlock"]')) {
      const inp = ev.target.closest('.copyrow')?.querySelector('[data-input="bonusCode"]');
      bonusUnlock(inp?.value).then((ok) => { bonusMsg = ok ? '' : 'Neplatný kód.'; if (ok) tab = 'stat'; render(); });
      return;
    }
    const sa = ev.target.closest('[data-act^="st"]')?.dataset.act;
    if (sa && globalThis.FOE_STATS) {
      const st = FOE_STATS, done = () => render();
      if (sa === 'stpick') st.pickFolder().then(done);
      else if (sa === 'stgrant') st.grant().then(done);
      else if (sa === 'stsync') st.sync().then(done);
      else if (sa === 'stforget') st.forgetFolder().then(done);
      else if (sa === 'stcsvown' && st.ready()) exportCsv('own');
      else if (sa === 'stcsvvis' && st.ready()) exportCsv('visits');
      else if (sa === 'stjson' && st.ready()) saveText(`foe-reader-${st.data().world}-zaloha-${dayKey()}.json`, st.exportJson(), 'application/json');
      else if (sa === 'stimport') ev.target.closest('p')?.querySelector('[data-stimport]')?.click();
      if (sa !== 'stimport') render();
      return;
    }
    if (ev.target.closest('[data-act="alertcfg"]')) { alertCfgOpen = !alertCfgOpen; render(); return; }
    if (ev.target.closest('[data-act="systest"]')) sysSend({ type: 'notify', title: 'FoE Reader', message: 'Zkušební oznámení – takhle bude vypadat upozornění na sledovanou provincii.' });
    if (ev.target.closest('[data-act="testsound"]')) { ensureAudio(); const was = cfg.sound; cfg.sound = true; beep(true); cfg.sound = was; }
    const ra = ev.target.closest('[data-rate]');
    if (ra) { const a = ra.dataset.rate; if (a === 'sort') rateSel.asc = !rateSel.asc; else { rateSel.settings = a === 'settings'; rateSel.inv = a === 'inv'; } render(); return; }
    const rz = ev.target.closest('[data-ratesize]');
    if (rz) { rateSel.size = +rz.dataset.ratesize; render(); return; }
    if (ev.target.closest('[data-act="ratereset"]')) { cfg.ratingW = {}; saveCfg(); render(); return; }
    const pv = ev.target.closest('[data-prodview]');
    if (pv) { prodView = pv.dataset.prodview; render(); return; }
    const pc = ev.target.closest('tr[data-prodcat]');
    if (pc) { prodCat = pc.dataset.prodcat; render(); return; }
    const fg = ev.target.closest('[data-frag]');
    if (fg) { fragFilter = fg.dataset.frag; render(); return; }
    if (ev.target.closest('[data-act="mapwin"]')) { openMapWin(); return; }
    if (ev.target.closest('[data-act="calcwin"]')) { openCalcWin(); return; }
    const mg = ev.target.closest('[data-mapgrid]');
    if (mg) { mapGrid = mg.dataset.mapgrid; render(); renderMapWin(); return; }
    const fb = ev.target.closest('[data-factor]');
    if (fb) { cfg.arcFactor = fb.dataset.factor === 'arc' ? 'arc' : +fb.dataset.factor; saveCfg(); render(); return; }
    const cp = ev.target.closest('[data-act="copy"]');
    if (cp) {
      const txt = cp.dataset.text;
      const done = () => { cp.textContent = 'Zkopírováno ✓'; setTimeout(() => { cp.textContent = 'Kopírovat'; }, 1500); };
      (navigator.clipboard?.writeText(txt) || Promise.reject()).then(done).catch(() => {
        const inp = cp.parentElement.querySelector('.copytext'); inp.select(); document.execCommand('copy'); done();
      });
    }
    const w = ev.target.closest('[data-watch]');
    if (w) {
      const set = loadWatch(), id = +w.dataset.watch;
      set.has(id) ? set.delete(id) : set.add(id);
      saveWatch(set); timeChecks(); render();
    }
    const tt = ev.target.closest('[data-tabtoggle]');
    if (tt) {
      const id = tt.dataset.tabtoggle, hid = new Set(cfg.hiddenTabs || []);
      hid.has(id) ? hid.delete(id) : hid.add(id);
      cfg.hiddenTabs = [...hid]; saveCfg(); renderTabs(); render();
    }
    const lg = ev.target.closest('[data-lang]');
    if (lg && cfg.lang !== lg.dataset.lang) {
      cfg.lang = lg.dataset.lang; saveCfg(); renderTabs(); render(); renderCalcWin();
      if (mapWin) renderMapWin();
    }
    if (ev.target.closest('[data-act="resetsize"]')) {
      try { localStorage.removeItem(PSIZE_KEY); } catch { /* ignore */ }
      const panel = root.getElementById('panel'); panel.style.width = ''; panel.style.height = '';
      placing = true; placePanel(); setTimeout(() => { placing = false; }, 400);
    }
  }
}
function onUiChange(ev) {
  const el = ev.target.closest('[data-cfg]');
  if (el) {
    cfg[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : +el.value; saveCfg(); render();
    if (['uiBar', 'barVertical'].includes(el.dataset.cfg)) { updateBadge(); placePanel(); }
  }
  const pn = ev.target.closest('[data-prov]');
  if (pn) { setProvName(+pn.dataset.prov, pn.value); render(); }
  const bc = ev.target.closest('[data-input="bonusCode"]');
  if (bc) { bonusCode = bc.value; bonusUnlock(bonusCode).then((ok) => { if (ok) { bonusCode = ''; bonusMsg = ''; tab = 'stat'; render(); } }); }
  const rq = ev.target.closest('[data-input="rateQ"]');
  if (rq) { rateSel.q = rq.value; render(); }
  const rw = ev.target.closest('[data-ratew]');
  if (rw) {
    const w = (cfg.ratingW = { ...(cfg.ratingW || {}) }), k = rw.dataset.ratew;
    w[k] = { ...(w[k] || {}), [rw.dataset.f]: rw.type === 'checkbox' ? rw.checked : Math.max(0, +rw.value || 0) };
    saveCfg(); render();
  }
  const sf = ev.target.closest('[data-input="statFilter"]');
  if (sf) { statFilter = sf.value; render(); }
  const fi = ev.target.closest('[data-stimport]');
  if (fi?.files?.[0]) {
    fi.files[0].text().then((t) => { try { FOE_STATS.importJson(t); statMsg = 'Záloha načtena a sloučena.'; } catch (e) { statMsg = 'Zálohu se nepodařilo načíst: ' + e.message; } render(); });
  }
  const inp = ev.target.closest('[data-input="attrTarget"]');
  if (inp) { attrTarget = +inp.value || null; render(); }
}

// ---------- Záložky v samostatných oknech (⧉) – otevřená okna se pamatují i po F5 ----------
const TABWIN_KEY = 'foeReaderTabWins';
const tabWins = new Map(); // id záložky -> {host, root, body}
let zTop = 2147400000; // panel (2147483647) zůstává vždy navrchu
const toFront = (el) => { el.style.zIndex = String(++zTop); }; // okno, na které kliknete, jde dopředu
const loadTabWinCfg = () => { try { return JSON.parse(localStorage.getItem(TABWIN_KEY) || '{}'); } catch { return {}; } };
const saveTabWinCfg = (c) => { try { localStorage.setItem(TABWIN_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
function openTabWin(id, restore) {
  const def = TABS.find((t) => t[0] === id);
  if (!def || (BONUS_TABS.includes(id) && !bonusOn())) return;
  if (tabWins.has(id)) { renderTabWin(id); return; }
  const all = loadTabWinCfg();
  const st = { x: 140 + tabWins.size * 30, y: 80 + tabWins.size * 30, w: 560, h: 480, ...(all[id] || {}) };
  const h = document.createElement('div');
  h.className = 'foe-reader-win';
  h.style.cssText = `position:fixed;z-index:2147483645;left:${Math.max(0, Math.min(st.x, innerWidth - 200))}px;top:${Math.max(0, Math.min(st.y, innerHeight - 80))}px;width:${st.w}px;height:${st.h}px;resize:both;overflow:hidden;min-width:280px;min-height:140px;background:#fbf6ec;border:1px solid #8a6a3a;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.45)`;
  const r = h.attachShadow({ mode: 'open' });
  r.innerHTML = L(`<style>${root.querySelector('style')?.textContent || ''}
    :host{all:initial}
    .whead{display:flex;align-items:center;gap:8px;background:#2b2116;color:#f3d9a4;padding:5px 8px;cursor:move;user-select:none}
    .whead b{flex:1}
    .whead button{background:#4a3a26;color:#f3d9a4;border:1px solid #8a6a3a;border-radius:4px;padding:0 7px;cursor:pointer}
    .wbody{overflow:auto;padding:8px 10px;height:calc(100% - 30px)}
  </style><div class="whead"><b>${{ '🔔': '🔔 Upozornění', 'ℹ️': 'ℹ️ O rozšíření a nastavení' }[def[1]] || def[1]}</b><button data-w="close" title="Zavřít">✕</button></div><div class="wbody"></div>`);
  document.documentElement.appendChild(h);
  toFront(h);
  h.addEventListener('pointerdown', () => toFront(h), true);
  const w = { host: h, root: r, body: r.querySelector('.wbody') };
  tabWins.set(id, w);
  if (id === 'alerts' && S.unread) { S.unread = 0; S.unreadLoud = 0; updateBadge(); }
  renderIcons();
  const save = (closed) => {
    const c = loadTabWinCfg();
    if (closed) { if (c[id]) c[id].open = false; }
    else { const b = h.getBoundingClientRect(); c[id] = { x: b.left, y: b.top, w: b.width, h: b.height, open: true }; }
    saveTabWinCfg(c);
  };
  r.querySelector('.whead').addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button')) return;
    const sx = ev.clientX, sy = ev.clientY, b = h.getBoundingClientRect();
    const mv = (e) => { h.style.left = Math.max(0, b.left + e.clientX - sx) + 'px'; h.style.top = Math.max(0, b.top + e.clientY - sy) + 'px'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); save(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  r.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-w="close"]')) { closeTabWin(id); return; }
    onUiClick(ev);
  });
  r.addEventListener('input', () => { lastInputAt = Date.now(); });
  r.addEventListener('change', onUiChange);
  attachTips(r, h);
  new ResizeObserver(() => { if (tabWins.has(id)) save(); }).observe(h);
  w.close = () => { save(true); h.remove(); tabWins.delete(id); renderIcons(); };
  if (!restore) save();
  renderTabWin(id);
}
function closeTabWin(id) { tabWins.get(id)?.close(); }
// Nástrojová lišta: ikona = okno záložky (klik otevře / zavře), odznaky u upozornění.
function renderIcons() {
  const el = root?.getElementById('icons'), bar = root?.getElementById('bar');
  if (!el) return;
  bar.classList.toggle('vert', !!cfg.barVertical);
  const tg = root.getElementById('toggle');
  if (!cfg.uiBar) { el.innerHTML = ''; return; }
  el.innerHTML = L(TABS.filter(([id]) => tabVisible(id)).map(([id, l]) => {
    const badge = id === 'alerts' && S.unread ? `<span class="bdg">${S.unread}</span>` : '';
    const alertCls = id === 'alerts' && (S.unreadLoud || 0) > 0 ? ' alert' : '';
    return `<button class="ico${tabWins.has(id) ? ' on' : ''}${alertCls}" data-ico="${id}" title="${l === '🔔' ? 'Upozornění' : l === 'ℹ️' ? 'O rozšíření a nastavení' : l}">${ICONS[id] || '•'}${badge}</button>`;
  }).join(''));
  if (tg && !tg.classList.contains('drag')) tg.title = L(`FoE Reader ${VERSION} · klik = panel se záložkami, táhnout = přesunout lištu`);
}
function renderTabWin(id) {
  const w = tabWins.get(id);
  const def = TABS.find((t) => t[0] === id);
  if (!w || !def) return;
  const act = w.root.activeElement;
  if (act && act.tagName === 'INPUT' && !act.readOnly && act.type !== 'checkbox' && Date.now() - lastInputAt < 2500) return;
  const keep = w.body.scrollTop;
  w.body.innerHTML = L(def[2]());
  w.body.scrollTop = keep;
}
function restoreTabWins() {
  for (const [id, c] of Object.entries(loadTabWinCfg())) if (c?.open) openTabWin(id, true);
}
// ---------- Přetahování ----------
const POS_KEY = 'foeReaderPos';
function loadPos() {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY)); if (p && isFinite(p.x) && isFinite(p.y)) return p; } catch { /* ignore */ }
  return { x: Math.max(8, Math.round(window.innerWidth / 2 - 60)), y: 6 };
}
function savePos() {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ x: parseInt(host.style.left), y: parseInt(host.style.top) })); } catch { /* ignore */ }
}
function clampHost() {
  const btn = root.getElementById('toggle');
  const w = btn.offsetWidth || 120, h = btn.offsetHeight || 28;
  host.style.left = Math.min(Math.max(0, parseInt(host.style.left) || 0), window.innerWidth - w) + 'px';
  host.style.top = Math.min(Math.max(0, parseInt(host.style.top) || 0), window.innerHeight - h) + 'px';
}
// Panel se otevře tam, kde je místo: doprava/doleva, dolů/nahoru.
function placePanel() {
  const panel = root.getElementById('panel');
  const x = parseInt(host.style.left), y = parseInt(host.style.top);
  const btnW = root.getElementById('toggle').offsetWidth;
  const sz = loadPanelSize();
  const pw = Math.min(sz.w || 580, window.innerWidth * 0.96);
  panel.style.width = pw + 'px';
  panel.style.left = (x + pw > window.innerWidth ? Math.max(-x, btnW - pw) : 0) + 'px';
  const below = y < window.innerHeight / 2;
  panel.style.top = below ? 'calc(100% + 6px)' : 'auto';
  panel.style.bottom = below ? 'auto' : 'calc(100% + 6px)';
  const btnH = root.getElementById('toggle').offsetHeight;
  const maxH = Math.max(200, below ? window.innerHeight - y - btnH - 16 : y - 16);
  panel.style.maxHeight = maxH + 'px';
  panel.style.height = sz.h ? Math.min(sz.h, maxH) + 'px' : '';
}
// Velikost panelu (roztažení za pravý dolní roh) se pamatuje.
const PSIZE_KEY = 'foeReaderPanelSize';
const loadPanelSize = () => { try { return JSON.parse(localStorage.getItem(PSIZE_KEY) || '{}'); } catch { return {}; } };
function watchPanelSize() {
  const panel = root.getElementById('panel');
  let t = null;
  new ResizeObserver(() => {
    if (!open || !panel.offsetWidth || placing) return;
    clearTimeout(t);
    t = setTimeout(() => { try { localStorage.setItem(PSIZE_KEY, JSON.stringify({ w: panel.offsetWidth, h: panel.offsetHeight })); } catch { /* ignore */ } }, 300);
  }).observe(panel);
}
let placing = false;
function setupDrag(btn, onClick) {
  let start = null, moved = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { mx: e.clientX, my: e.clientY, x: parseInt(host.style.left), y: parseInt(host.style.top) };
    moved = false;
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.mx, dy = e.clientY - start.my;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    moved = true; btn.classList.add('drag');
    host.style.left = start.x + dx + 'px';
    host.style.top = start.y + dy + 'px';
    clampHost(); placePanel();
  });
  btn.addEventListener('pointerup', () => {
    if (!start) return;
    start = null; btn.classList.remove('drag');
    if (moved) savePos(); else onClick();
  });
  // Ať hra pod tlačítkem nereaguje na kliky a tahy.
  for (const t of ['mousedown', 'mouseup', 'click', 'wheel']) host.addEventListener(t, (e) => e.stopPropagation());
}

function attach() {
  (document.body || document.documentElement).appendChild(host);
}

function download() {
  const ids = new Set([...S.entities.values(), ...(S.outpost?.entities?.values() || [])].map((e) => e.cityentity_id));
  const sizes = {};
  for (const id of ids) if (S.ent.has(id)) sizes[id] = { ...S.ent.get(id), name: S.names.get(id) };
  const extra = { t: Date.now(), channel: 'meta', key: 'FoEReader.mapData', data: { sizes, grids: S.grids, gbgMaps: S.gbgMapsMeta || null, gbgNames: S.gbgNames } };
  const blob = new Blob([JSON.stringify([...S.ring, extra], null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `foe-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Lišta záložek podle nastavení (vypnuté se nezobrazují; VB, Upozornění a ℹ️ vypnout nejdou).
const FIXED_TABS = ['gb', 'alerts', 'about'];
// Bonusové funkce (Statistiky + ukládání do složky) se ukážou až po zadání kódu v ℹ️.
// V kódu je jen otisk SHA-256 kódu (velká písmena bez pomlček a mezer). Data se sbírají i bez kódu, jen se neukazují.
const BONUS_TABS = ['stat'];
const BONUS_HASH = '291ed068b7e9dd970be786fc6d67af2a700fb9d9dd16541f2b7cd0357cf32da9';
const bonusOn = () => cfg.bonusKey === BONUS_HASH;
async function bonusUnlock(code) {
  const norm = String(code || '').toUpperCase().replace(/[\s-]+/g, '');
  if (!norm || !crypto?.subtle) return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== BONUS_HASH) return false;
  cfg.bonusKey = hex; saveCfg(); renderTabs();
  return true;
}
const tabVisible = (id) => (!BONUS_TABS.includes(id) || bonusOn()) && (FIXED_TABS.includes(id) || !(cfg.hiddenTabs || []).includes(id));
function renderTabs() {
  renderIcons();
  const el = root?.getElementById('tabs');
  if (!el) return;
  if (!tabVisible(tab)) tab = 'gb';
  el.innerHTML = L(TABS.filter(([id]) => tabVisible(id)).map(([id, l]) => `<button data-tab="${id}">${l}</button>`).join('')
    + '<button data-act="popout" title="Otevřít tuto záložku v samostatném okně">⧉</button>');
}
function render() {
  if (!root) return;
  for (const id of tabWins.keys()) renderTabWin(id);
  root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (alertsVisible() && S.unread) { S.unread = 0; S.unreadLoud = 0; updateBadge(); }
  if (!open) return;
  // Nepřekreslovat, když uživatel zrovna píše do pole v panelu.
  // Při psaní do pole chvíli počkat (jinak by se přepsalo pod rukama), pak překreslit a vrátit kurzor.
  const act = root.activeElement;
  const editing = act && act.tagName === 'INPUT' && !act.readOnly && body.contains(act);
  if (editing && Date.now() - lastInputAt < 2500) { setTimeout(scheduleRender, 2600); return; }
  const focusSel = editing ? (act.dataset.cfg ? `[data-cfg="${act.dataset.cfg}"]` : act.dataset.prov ? `[data-prov="${act.dataset.prov}"]` : act.dataset.input ? `[data-input="${act.dataset.input}"]` : null) : null;
  const keepScroll = body.scrollTop;
  body.innerHTML = L(TABS.find((t) => t[0] === tab)[2]());
  body.scrollTop = keepScroll;
  if (focusSel) body.querySelector(focusSel)?.focus({ preventScroll: true });
}

let lastInputAt = 0;
let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    try { statsTick(); } catch (e) { console.warn('[FoE Reader] statistiky', e); }
    render();
    if (mapWin && mapWin.rev !== S.mapRev) { mapWin.rev = S.mapRev; renderMapWin(); }
    renderCalcWin();
  }, 500);
}
setInterval(() => {
  if (open && ['tav', 'gbg', 'prod', 'inc'].includes(tab)) render();
  else for (const id of tabWins.keys()) if (['tav', 'gbg', 'prod', 'inc'].includes(id)) renderTabWin(id);
}, 15000);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();

// Pro ladění z konzole (izolovaný svět): stav není v kontextu stránky.
window.__foeReader = S;
