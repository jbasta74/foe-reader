// FoE Reader – panel-tabs.js
// Upozornění, sklad, o rozšíření, statistiky, expedice, QI.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ---------- Upozornění ----------
let alertCfgOpen = false; // nastavení upozornění je ve výchozím stavu sbalené
function viewAlerts() {
  const chk = (k, label) => `<label><input type="checkbox" data-cfg="${k}" ${cfg[k] ? 'checked' : ''}> ${label}</label>`;
  const num = (k, label, w = 50) => `<label>${label} <input type="number" data-cfg="${k}" value="${Number.isFinite(+cfg[k]) ? +cfg[k] : CFG_DEFAULT[k] ?? 0}" min="0" style="width:${w}px"></label>`;
  const ICON = { gbg: '⚔️', tav: '🍺', prod: '🏭', trade: '🤝', gb: '🏛️', lim: '⏳', msg: '✉️', ev: '⏰' };
  const cfgHtml = `<div class="cfg">
      <div>${chk('sound', 'Zvuk')} <button data-act="testsound">Vyzkoušet zvuk</button></div>
      <div><b>GBG:</b> ${chk('gbgAttack', 'útok na naše provincie / ztráta')} ${chk('gbgWatch', 'sledované provincie')} ${num('gbgWatchLead', 'min předem')}</div>
      <div><b>Hospody:</b> ${chk('tavFree', 'uvolněná židle')} ${chk('tavAgain', 'znovu k návštěvě')} ${chk('tavOwnFull', 'moje hospoda plná')}</div>
      <div><b>Obchod:</b> ${chk('tradeOn', 'někdo vzal moji nabídku')} ${chk('tradeSound', 'se zvukem')} ${chk('tradeExpired', 'vypršené nabídky')}</div>
      <div><b>Oznámení Chromu:</b> ${chk('sysWatch', 'sledované provincie ☆')} ${chk('sysUrgent', 'útok na naše provincie')} ${chk('sysMsg', 'zprávy')} ${chk('sysProd', 'hotová produkce')} ${chk('sysLim', 'limitované budovy')} ${chk('sysTav', 'hospody')} ${chk('sysTrade', 'obchod')} ${chk('sysEv', 'konec expedice / QI')} <button data-act="systest">Vyzkoušet</button></div>
      <div class="muted">Systémové oznámení Chromu se ukáže i mimo hru (když je okno na pozadí nebo minimalizované); klik na něj přepne na hru. Musí být povolená oznámení Chromu v systému (Windows / macOS).</div>
      <div><b>GBG okno:</b> ${chk('gbgPopup', 'otevřít okno GBG při vstupu do GBG')}</div>
      <div><b>Moje VB:</b> ${chk('gbContribOn', 'někdo přispěl (tiše)')} ${chk('gbCalcPopup', 'otevřít kalkulačku VB v okně s otevřením budovy')}</div>
      <div><b>Osada:</b> ${chk('mgPopup', 'otevřít okno Osada se zahájením minihry obchodníka')}</div>
      <div><b>Vyjednávání:</b> ${chk('negoPopup', 'otevřít okno vyjednávání při zahájení')} ${chk('negoGbg', 'pomocník i v GBG')}</div>
      <div><b>Zprávy:</b> ${chk('msgSocial', 'soukromé')} ${chk('msgGuild', 'cechovní')} ${chk('msgSound', 'se zvukem')}</div>
      <div><b>Limitované budovy:</b> ${chk('limOn', 'vypršení')} ${num('limLead', 'hodin předem')} ${chk('limInv', 'po načtení: co lze pozvednout (tiše)')}</div>
      <div><b>Expedice a QI:</b> ${chk('endOn', 'konec s nevyužitými pokusy / akcemi')} ${num('endLead', 'hodin předem')}</div>
      <div><b>Produkce:</b> ${chk('prodOn', 'město hotovo')} ${num('prodMin', 'od počtu budov')} ${chk('prodOutpost', 'osada a QI')}</div>
    </div>`;
  return `<p><button class="fbtn ${alertCfgOpen ? 'on' : ''}" data-act="alertcfg">⚙ Nastavení upozornění ${alertCfgOpen ? '▾' : '▸'}</button></p>
    ${alertCfgOpen ? cfgHtml : ''}
    <h4>Poslední upozornění</h4>
    ${S.alerts.length ? `<table><tbody>${S.alerts.map((a) => `<tr><td class="muted" style="white-space:nowrap">${new Date(a.t).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' })}</td>
      <td>${ICON[a.kind] || ''}</td><td class="${a.urgent ? 'hi' : ''}">${esc(a.text)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Zatím nic.</p>'}
    <p class="muted">Zvuk prohlížeč povolí až po prvním kliknutí do stránky. Upozornění fungují, jen když je hra otevřená (stačí i na pozadí).</p>`;
}

// ---------- Sklad: zboží všech věků a části ----------
const ERA = {
  BronzeAge: 'Doba bronzová', IronAge: 'Doba železná', EarlyMiddleAge: 'Raný středověk', HighMiddleAge: 'Vrcholný středověk',
  LateMiddleAge: 'Pozdní středověk', ColonialAge: 'Kolonizace', IndustrialAge: 'Průmyslový věk', ProgressiveEra: 'Pokrokové období',
  ModernEra: 'Moderna', PostModernEra: 'Postmoderna', ContemporaryEra: 'Současnost', TomorrowEra: 'Zítřek', FutureEra: 'Budoucnost',
  ArcticFuture: 'Arktická budoucnost', OceanicFuture: 'Oceánská budoucnost', VirtualFuture: 'Virtuální budoucnost',
  SpaceAgeMars: 'Mars', SpaceAgeAsteroidBelt: 'Pás asteroidů', SpaceAgeVenus: 'Venuše', SpaceAgeJupiterMoon: 'Jupiterův měsíc',
  SpaceAgeTitan: 'Titan', SpaceAgeSpaceHub: 'Vesmírný uzel', StellarAgeDiscovery: 'Hvězdný věk',
};
let fragFilter = 'ready';
// Ikona zboží z atlasu hry (zmenšená na size px); bez atlasu nebo ikony vrátí název.
function goodIcon(id, size = 30) {
  const sp = S.goodsSprite, f = sp?.frames?.[id];
  if (!f) return esc(resLabel(id));
  const [x, y, w, h, rot] = f;
  const k = size / Math.max(w, h);
  return `<span class="gicon" title="${esc(resLabel(id))}" style="width:${Math.round(w * k)}px;height:${Math.round(h * k)}px;background-image:url('${sp.png}');background-size:${sp.w * k}px ${sp.h * k}px;background-position:${-x * k}px ${-y * k}px${rot ? ';transform:rotate(-90deg)' : ''}"></span>`;
}

function viewIncidents() {
  const now = nowServer();
  const list = (S.incidents?.list || []).filter((h) => /^incident_/.test(h.type)); // relikvie expedice sem nepatří
  const act = list.filter((h) => h.startTime <= now && now < h.expireTime).sort((a, b) => a.expireTime - b.expireTime);
  const fut = list.filter((h) => h.startTime > now).sort((a, b) => a.startTime - b.startTime);
  const place = (h) => esc(INC_PLACES[h.position?.context] || h.position?.context || '');
  const rare = (h) => (h.rarity === 'rare' ? ' <span class="hi">vzácná</span>' : h.rarity === 'uncommon' ? ' <span class="muted">neobvyklá</span>' : '');
  const at = (t) => new Date((t - S.serverOffset) * 1000).toLocaleString(LOC(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const byPlace = {};
  for (const h of act) { const p = INC_PLACES[h.position?.context] || h.position?.context; byPlace[p] = (byPlace[p] || 0) + 1; }
  let html = !S.incidents ? '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>'
    : `<p><span class="chip">čeká: <b>${act.length}</b></span>${Object.entries(byPlace).map(([p, n]) => `<span class="chip">${esc(p)} ${n}</span>`).join('')}${fut.length ? `<span class="chip">další: ${fut.length}</span>` : ''}</p>
    <h4>Ve městě teď</h4>${act.length ? `<div class="incgrid">${act.map((h) =>
      `<div class="inccard ${h.rarity || ''}" title="${esc(incName(h.type))} · ${place(h)}">${incImg(h.type) || '<div class="noimg">?</div>'}
        <div class="incname">${esc(incName(h.type))}</div><div class="muted">${place(h)}</div>
        <div class="${h.expireTime - now < 3600 ? 'hi' : ''}">⏳ ${dur(h.expireTime - now)}</div></div>`).join('')}</div>` : '<p class="muted">Nic.</p>'}
    ${fut.length ? `<h4>Objeví se</h4><table><thead><tr><th>Kdy</th><th>Příhoda</th><th>Místo</th></tr></thead><tbody>${fut.map((h) =>
      `<tr><td>${at(h.startTime)} <span class="muted">(za ${dur(h.startTime - now)})</span></td><td>${incImg(h.type, 26)} ${esc(incName(h.type))}${rare(h)}</td><td>${place(h)}</td></tr>`).join('')}</tbody></table>` : ''}`;
  // deník vybraných odměn
  const log = loadIncLog();
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const today = log.filter((x) => x.t >= day0.getTime());
  const sum = new Map();
  for (const x of today) for (const r of x.r) { const k = r.id || r.name; const v = sum.get(k) || { name: r.name, n: 0 }; v.n += r.n; sum.set(k, v); }
  html += `<h4>Vybrané odměny dnes (${today.length})</h4>${sum.size ? `<p>${[...sum.values()].map((v) => `<span class="chip">${esc(v.name.replace(/^\d[\d\s.,]*\s*/, ''))} <b>${fmt(v.n)}</b></span>`).join('')}</p>` : '<p class="muted">Zatím nic.</p>'}
    ${log.length ? `<details><summary class="muted">Posledních ${Math.min(20, log.length)} odměn</summary><table><tbody>${log.slice(-20).reverse().map((x) =>
      `<tr><td class="muted" style="white-space:nowrap">${new Date(x.t).toLocaleString(LOC(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${x.r.map((r) => esc(r.name)).join(', ')}</td></tr>`).join('')}</tbody></table></details>` : ''}
    <p class="muted">Obsah odměny server prozradí až po vybrání příhody. Deník se ukládá v prohlížeči.</p>`;
  return html;
}

function viewNego() {
  const n = S.nego;
  if (!n) return '<p class="muted">Začněte ve hře vyjednávání (expedice) – tady se ukáže návrh dalšího tahu.</p>';
  if (n.gbg) return '<p class="muted">Vyjednávání v GBG: pomocník je vypnutý – zapnete ho v 🔔 → ⚙ Nastavení upozornění → Vyjednávání.</p>';
  const name = (gi) => goodIcon(n.goods[gi]);
  const CLS = { correct: 'ok', wrong_person: 'wp', not_needed: 'nn' };
  const TXT = { correct: '✓', wrong_person: '↔', not_needed: '✗' };
  const left = S.resources.negotiation_game_turn;
  const head = `<tr><th></th>${[...Array(NEGO_SLOTS).keys()].map((i) => `<th>Postava ${i + 1}</th>`).join('')}</tr>`;
  const rows = n.turns.map((t, i) => `<tr><td>Tah ${i + 1}</td>${[...Array(NEGO_SLOTS).keys()].map((sl) => t.guess.has(sl)
    ? `<td class="ng ${CLS[t.result.get(sl)] || ''}">${TXT[t.result.get(sl)] || ''} ${name(t.guess.get(sl))}</td>` : '<td class="muted">–</td>').join('')}</tr>`).join('');
  let sug = '';
  const c = n.calc;
  if (n.state === 'won') sug = `<p class="hi">Vyjednávání vyhráno 🎉${n.bought ? ` (dokoupeno tahů: ${n.bought}${n.paid ? `, ${fmt(n.paid)} 💎` : ''})` : ''}</p>`;
  else if (n.state !== 'ongoing' && n.state !== 'out_of_turns') sug = `<p class="muted">Konec vyjednávání (${esc(n.state)}).</p>`;
  else if (!c) sug = '<p class="muted">Počítám…</p>';
  else if (c.error) sug = `<p class="hi">Chyba výpočtu: ${esc(c.error)}</p>`;
  else if (!c.suggestion) sug = '<p class="hi">Žádná kombinace neodpovídá výsledkům – pošlete mi prosím log.</p>';
  let sugRow = '';
  if (c && c.suggestion && ['ongoing', 'out_of_turns'].includes(n.state)) sugRow = `<tr class="sel"><td><b>${n.state === 'out_of_turns' ? 'Návrh po koupi' : 'Návrh'}</b></td>${[...Array(NEGO_SLOTS).keys()].map((sl) => c.fixed.has(sl)
    ? `<td class="ng ok">✓ ${name(c.fixed.get(sl))}</td>` : `<td><b>${name(c.suggestion.get(sl))}</b></td>`).join('')}</tr>`;
  if (sugRow) sug = `<p class="muted">Možných kombinací: ${fmt(c.cands)}${c.sure ? ' – <b>jisté řešení</b>' : ''}${c.winP != null ? ` · šance na výhru se zbývajícími tahy: <b>${Math.round(c.winP * 100)} %</b>` : ''}.</p>`;
  const cost = n.goods.map((g) => `${goodIcon(g, 22)} ${fmt(n.costs[g])}${S.resources[g] != null ? ` <span class="muted">(máte ${fmt(S.resources[g])})</span>` : ''}`).join(' · ');
  // Tahy zdarma = zdroj negotiation_game_turn (3 + bonus z hospody); pak hra nabízí další tah za diamanty (cenu server předem neposílá).
  const turnsInfo = n.state === 'out_of_turns'
    ? `<div class="turns out">💎 Tahy došly – další tah ${n.offer != null ? `za <b>${fmt(n.offer)}</b> diamantů` : 'za diamanty'}</div>`
    : left == null ? '' : n.state === 'ongoing' && left === 0
    ? '<div class="turns out">💎 Tahy zdarma došly – další tah už je za diamanty</div>'
    : `<div class="turns${n.state === 'ongoing' && left === 1 ? ' last' : ''}">Tahy zdarma: <b>${left}</b>${n.turns.length ? ` z ${left + n.turns.length}` : ''}${n.state === 'ongoing' && left === 1 ? ' – poslední zdarma!' : ''}</div>`;
  const gbgWarn = n.inGbg ? '<p class="hi">⚠ GBG je soutěžní režim – pomocník je zapnutý na vaše riziko (pravidla InnoGames).</p>' : '';
  return `${gbgWarn}${turnsInfo}<p>Zboží: ${cost}</p>
    <table class="neg"><thead>${head}</thead><tbody>${rows}${sugRow}</tbody></table>${sug}
    <p class="muted">✓ správně · ↔ chce jiná postava · ✗ nikdo další nechce. Návrh jen radí – tah zadáváte ve hře sami.</p>`;
}

function viewStock() {
  const r = S.resources;
  let html = '';
  // Zboží podle věků (pořadí věků podle goodsList).
  const eras = new Map();
  for (const [id, era] of S.goodsEra) { if (!eras.has(era)) eras.set(era, []); eras.get(era).push(id); }
  if (eras.size) {
    const rows = [...eras.entries()].reverse().map(([era, ids]) => {
      const sum = ids.reduce((a, id) => a + (r[id] || 0), 0);
      const min = Math.min(...ids.map((id) => r[id] || 0));
      return `<tr class="${era === S.player?.era ? 'sel' : ''}"><td><b>${esc(ERA[era] || era)}</b></td>
        <td>${ids.map((id) => `<span class="good ${(r[id] || 0) === min && sum ? 'low' : ''}" title="${esc(S.goodsName.get(id) || id)}">${esc(S.goodsName.get(id) || id)} <b>${fmt(r[id] || 0)}</b></span>`).join('')}</td>
        <td class="num">${fmt(sum)}</td></tr>`;
    }).join('');
    html += `<h4>Zboží podle věků</h4><table class="stock"><thead><tr><th>Věk</th><th>Zboží</th><th>Celkem</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Zvýrazněný řádek = váš věk. Podtržené je zboží, kterého máte v daném věku nejméně.</p>`;
  }
  // Části
  const fr = [...(S.frags?.values() || [])].map((f) => ({ ...f, can: Math.floor(f.stock / f.need), pct: f.stock / f.need }));
  if (fr.length) {
    const ready = fr.filter((f) => f.can > 0).sort((a, b) => b.can - a.can || a.name.localeCompare(b.name));
    const rest = fr.filter((f) => f.can === 0).sort((a, b) => b.pct - a.pct);
    const list = fragFilter === 'ready' ? ready : fragFilter === 'near' ? rest.filter((f) => f.pct >= 0.5) : [...ready, ...rest];
    const btn = (k, label) => `<button class="fbtn ${fragFilter === k ? 'on' : ''}" data-frag="${k}">${label}</button>`;
    html += `<h4>Části (fragmenty)</h4>
      <p>${btn('ready', `Lze sestavit (${ready.length})`)}${btn('near', `Přes polovinu (${rest.filter((f) => f.pct >= 0.5).length})`)}${btn('all', `Vše (${fr.length})`)}</p>
      ${list.length ? `<table><thead><tr><th>Co vznikne</th><th>Mám / potřeba</th><th>Sestavím</th><th>Chybí</th></tr></thead><tbody>${
        list.map((f) => `<tr><td>${esc(f.name)}</td><td class="num">${fmt(f.stock)} / ${fmt(f.need)}</td>
          <td class="num ${f.can ? 'hi' : 'muted'}">${f.can ? f.can + '×' : Math.floor(f.pct * 100) + ' %'}</td>
          <td class="num">${f.can ? `<span class="muted">zbyde ${fmt(f.stock % f.need)}</span>` : fmt(f.need - f.stock)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Nic.</p>'}`;
  } else {
    html += '<p class="muted">Části se načtou s inventářem (po načtení hry).</p>';
  }
  return html || '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
}

// ---------- Výzkum: kolik surovin a FP chybí k dokončení věku ----------
// Strom technologií z metadat hry („research“) + postup hráče (ResearchService.getProgress).
// Postup jako FoE Helper: u každé nevyzkoumané technologie požadavky (requirements) + zbývající FP;
// z rozhodovacích bodů Hvězdného věku se bere zvolená větev (jinak první – ceny jsou stejné).
let techEra = null;
function techList() {
  const out = [];
  for (const t of S.research.meta || []) {
    if (t.id === 'root') continue;
    out.push(t);
    const br = t.branches;
    if (Array.isArray(br) && br.length) {
      const b = br.find((x) => S.research.chosen.has(x.id)) || br[0];
      for (const n of b.nodes || []) out.push({ ...n, era: n.era || t.era, branchOf: t.id });
    }
  }
  return out;
}
const techResearch = (t) => { const [id, amount] = Object.entries(t.researchCost?.resources || {})[0] || []; return { id, amount: amount || 0 }; };
function viewResearch() {
  const R = S.research;
  if (!R.meta) return '<p class="muted">Strom výzkumu hra posílá při načtení – obnovte hru (F5).</p>';
  const list = techList().filter((t) => t.era && !t.isTeaser);
  const prog = R.progress || {};
  const done = new Set(prog.unlockedNodes?.length ? prog.unlockedNodes : prog.unlockedTechnologies || []);
  const paid = new Map((prog.inProgressTechnologies || []).map((x) => [x.tech_id, x.currentSP ?? Object.values(x.researchCostPaid?.resources || {})[0] ?? 0]));
  const eras = [...new Set(list.map((t) => t.era))];
  const cur = Math.max(0, eras.indexOf(S.player?.era));
  if (techEra == null || !eras.includes(techEra)) techEra = eras[Math.min(cur + 1, eras.length - 1)];
  const tgt = eras.indexOf(techEra);
  const sel = {}, cum = {};
  let nSel = 0, nCum = 0, nOpt = 0;
  for (const t of list) {
    const ei = eras.indexOf(t.era);
    if (ei > tgt || done.has(t.id)) continue;
    if (!t.branchOf && !(t.children || []).length && ei >= cur && cfg.techOpt) { nOpt++; continue; }
    const dem = { ...((t.requirements || t.cost)?.resources || {}) };
    delete dem.__class__;
    const rc = techResearch(t);
    if (rc.id && rc.amount > 0) dem[rc.id] = (dem[rc.id] || 0) + Math.max(0, rc.amount - (paid.get(t.id) || 0));
    for (const [k, v] of Object.entries(dem)) { if (!v) continue; cum[k] = (cum[k] || 0) + v; if (ei === tgt) sel[k] = (sel[k] || 0) + v; }
    nCum++; if (ei === tgt) nSel++;
  }
  const stock = (id) => (id === 'strategy_points' ? (S.resources.strategy_points || 0) + (S.packageFP || 0) : S.resources[id] || 0);
  const base = ['strategy_points', 'money', 'supplies'];
  const order = [...base, ...[...S.goodsEra.keys()].filter((id) => cum[id] || sel[id]), ...Object.keys(cum).filter((id) => !base.includes(id) && !S.goodsEra.has(id))];
  const ids = [...new Set(order)].filter((id) => cum[id]);
  const LBL = { strategy_points: 'FP', money: 'Mince', supplies: 'Zásoby' };
  // Zboží, na které máte ve městě výrobnu (metadata výroben nebo právě běžící výroba).
  const prodGoods = new Set();
  for (const e of S.entities.values()) {
    for (const g of S.entGoods.get(e.cityentity_id) || []) prodGoods.add(g);
    for (const g of Object.keys(e.state?.current_product?.product?.resources || {})) prodGoods.add(g);
  }
  // Denní produkce FP (jako Přehled výroby) → odhad, za kolik dní FP nasbíráte.
  let fpDay = 0;
  try { fpDay = dailyOverview().tot.strategy_points || 0; } catch { /* bez metadat */ }
  const fpMiss = Math.max(0, (cum.strategy_points || 0) - stock('strategy_points'));
  const rows = ids.map((id) => {
    const miss = Math.max(0, cum[id] - stock(id)), ge = S.goodsEra.get(id);
    const pg = ge && prodGoods.has(id) ? ' <span title="Máte ve městě výrobnu tohoto zboží.">🏭</span>' : ge && miss ? ' <span class="muted" title="Výrobnu nemáte – zboží je potřeba sehnat (obchod, cech, události).">⇄</span>' : '';
    return `<tr class="${miss ? '' : 'muted'}"><td>${esc(LBL[id] || resLabel(id))}${pg}${ge && ge !== techEra ? ` <span class="muted">· ${esc(ERA[ge] || ge)}</span>` : ''}</td>
      <td class="num">${sel[id] ? fmt(sel[id]) : ''}</td><td class="num">${fmt(cum[id])}</td><td class="num">${fmt(stock(id))}</td>
      <td class="num ${miss ? 'hi' : ''}">${miss ? fmt(miss) : '✓'}</td></tr>`;
  }).join('');
  const nav = (i, txt) => (i >= 0 && i < eras.length ? `<button class="fbtn" data-techera="${esc(eras[i])}">${txt}</button>` : '');
  return `<div class="cfg"><div>${nav(tgt - 1, '◀')} <b>${esc(ERA[techEra] || techEra)}</b> ${nav(tgt + 1, '▶')}
      <span class="muted">· váš věk ${esc(ERA[S.player?.era] || S.player?.era || '?')}</span></div>
    <div><label><input type="checkbox" data-cfg="techOpt" ${cfg.techOpt ? 'checked' : ''}> vynechat volitelné technologie (slepé větve) od vašeho věku</label>${nOpt ? ` <span class="muted">(vynecháno ${nOpt})</span>` : ''}</div></div>
    ${R.progress ? '' : '<p class="hi">Postup výzkumu ještě nepřišel – počítá se celý strom. Otevřete ve hře výzkum nebo obnovte hru.</p>'}
    <p><span class="chip">zbývá technologií ve věku: <b>${nSel}</b></span><span class="chip">celkem do konce věku: <b>${nCum}</b></span>${fpMiss && fpDay > 0 ? `<span class="chip" title="Chybějící FP / denní produkce FP ve městě (Přehled výroby, bez balíčků a jiných zdrojů).">FP při ${fmt(Math.round(fpDay))} FP/den: ~<b>${fmt(Math.ceil(fpMiss / fpDay))}</b> dní</span>` : ''}</p>
    ${ids.length ? `<table><thead><tr><th>Surovina</th><th>Věk</th><th>Celkem</th><th>Máte</th><th>Chybí</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">Vše vyzkoumáno 🎉</p>'}
    <p class="muted">„Věk“ = zbývající technologie vybraného věku, „Celkem“ = vše nevyzkoumané až do konce vybraného věku (včetně starších věků). FP včetně balíčků; u rozpracované technologie se odečte už vložené. 🏭 = zboží vyrábíte ve městě, ⇄ = výrobnu nemáte, je potřeba ho sehnat.</p>`;
}

// ---------- O rozšíření ----------
const REPO = 'https://github.com/jbasta74/foe-reader';
const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch { return '?'; } })();
// ---------- Záložka Statistiky ----------
let bonusMsg = '', bonusCode = '';
let statSel = null, statMetric = 'gbg:0', statFilter = '', statMsg = '';
const OWN_METRICS = {
  'all:0': 'Útok útočníka – Všude', 'all:1': 'Obrana útočníka – Všude', 'gbg:0': 'Útok útočníka – GBG', 'gbg:1': 'Obrana útočníka – GBG',
  'ge:0': 'Útok útočníka – Expedice', 'ge:1': 'Obrana útočníka – Expedice', 'all:3': 'Obrana obránce – Všude',
  gbl: 'Součet úrovní VB', fp: 'Bonus produkce FP',
};
const gbLevels = (sn) => (sn.gb || []).reduce((a, g) => a + (g.l || 0), 0);
function metricVal(sn, m) {
  if (m === 'gbl') return gbLevels(sn);
  if (m === 'fp') return sn.fp || 0;
  const [a, i] = m.split(':');
  return sn.army?.[a]?.[+i] ?? null;
}
const shortDate = (d) => { const [y, mo, da] = d.split('-'); return `${+da}. ${+mo}.${y !== String(new Date().getFullYear()) ? ' ' + y : ''}`; };
const pair = (arr, i = 0) => (arr ? `${fmt(arr[i])} / ${fmt(arr[i + 1])}` : '–');
const diff = (a, b) => { if (a == null || b == null || a === b) return ''; const d = a - b; return ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${fmt(d)}</span>`; };

// Jednoduchý spojnicový graf (SVG) – body = dny.
function lineChart(points) {
  if (points.length < 2) return '<p class="muted">Graf bude, až budou data aspoň ze dvou dnů.</p>';
  const W = 520, H = 120, P = 6;
  const vals = points.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = points.map((p, i) => [P + (i * (W - 2 * P)) / (points.length - 1), H - P - ((p[1] - lo) * (H - 2 * P)) / span]);
  return `<svg viewBox="0 0 ${W} ${H + 16}" style="width:100%;max-width:${W}px;display:block;background:#f3ead6;border-radius:6px">
    <polyline fill="none" stroke="#b0410f" stroke-width="2" points="${xy.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ')}"/>
    ${xy.map((q, i) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="2.5" fill="#2b2116"><title>${esc(shortDate(points[i][0]))}: ${fmt(points[i][1])}</title></circle>`).join('')}
    <text x="${P}" y="12" font-size="10" fill="#7a6a50">${fmt(hi)}</text><text x="${P}" y="${H - 8}" font-size="10" fill="#7a6a50">${fmt(lo)}</text>
    <text x="${P}" y="${H + 12}" font-size="10" fill="#7a6a50">${esc(shortDate(points[0][0]))}</text>
    <text x="${W - P}" y="${H + 12}" font-size="10" fill="#7a6a50" text-anchor="end">${esc(shortDate(points[points.length - 1][0]))}</text></svg>`;
}
// ---------- Expedice ----------
// Postup: id místa = 2 × setkání (sudé = boj/vyjednávání, liché = truhla), 32 míst na úroveň, úrovně 0–4 (log 23. 10.: id 159 = konec 5. úrovně).
const loadGeLog = () => { try { return JSON.parse(localStorage.getItem('foeReaderGeChests') || '[]'); } catch { return []; } };
function viewGE() {
  const g = S.ge;
  if (!g?.prog && !g?.ov) return '<p class="muted">Otevřete ve hře expedici – ukáže se postup, odměny a body cechu.</p>';
  const ov = g.ov || {}, p = g.prog || {}, id = p.currentEntityId ?? 0, now = nowServer();
  const lvl = Math.floor(id / 32), inLvl = Math.floor((id % 32) / 2), done = Math.floor(id / 2), chest = id % 2 === 1;
  const bar = (v, max, col = '#b5651d') => `<div style="background:#efe3c8;border-radius:4px;height:8px;margin:3px 0"><div style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%;height:8px;border-radius:4px;background:${col}"></div></div>`;
  let h = '';
  if (ov.state) h += `<p>${ov.state === 'active' ? `Expedice běží · konec za <b>${dur(ov.nextStateTime - now)}</b>` : `Expedice není aktivní · začne za ${dur(ov.nextStateTime - now)}`}${ov.currentTrial ? ` · zkouška <b>${ov.currentTrial}</b>` : ''}${ov.championship?.rank ? ` · pořadí v šampionátu <b>${ov.championship.rank}.</b>` : ''}</p>`;
  h += `<div class="tiles">
    ${tile('Úroveň', `${Math.min(lvl + 1, 5)} / 5`, '')}
    ${tile('Setkání v úrovni', `${Math.min(16, inLvl + (chest ? 1 : 0))} / 16`, chest ? 'teď truhla' : '')}
    ${tile('Celkem setkání', `${Math.min(80, done + (chest ? 1 : 0))} / 80`, '')}
    ${S.resources.guild_expedition_attempt != null ? tile('Pokusy', fmt(S.resources.guild_expedition_attempt), '') : ''}
  </div>${bar(done + (chest ? 1 : 0), 80)}`;
  const c = g.contrib, up = c?.upcomingReward || ov.upcomingReward, pts = c?.currentExpeditionPoints ?? ov.expeditionPoints;
  if (up && pts != null) h += `<h4>Body cechu</h4><p>${fmt(pts)} / ${fmt(up.requiredPoints)} do další odměny cechu (${fmt(up.amount)}, stupeň ${up.index + 1})${c?.expeditionPoints != null ? ` · váš příspěvek <b>${fmt(c.expeditionPoints)}</b>` : ''}</p>${bar(pts, up.requiredPoints, '#2e6db4')}`;
  const enc = ov.section?.encounters || [], rew = ov.section?.rewards || [];
  if (enc.length || rew.length) {
    const items = [...enc.map((e) => ({ id: e.id, txt: `⚔ boj${e.battleType ? ` (${esc({ attack: 'útok', defense: 'obrana' }[e.battleType] || e.battleType)})` : ''}` })),
      ...rew.map((r) => ({ id: r.id, txt: `🎁 ${esc(r.reward?.name || '')}` }))].sort((a, b) => a.id - b.id);
    h += `<h4>Aktuální úsek</h4><table><tbody>${items.map((x) => `<tr class="${x.id === id ? 'sel' : x.id < id ? 'muted' : ''}"><td>${Math.floor(x.id / 2) + 1}.</td><td>${x.txt}</td></tr>`).join('')}</tbody></table>`;
  }
  const log = loadGeLog().slice(-30).reverse();
  if (log.length) h += `<h4>Poslední truhly</h4><table><tbody>${log.map((x) => `<tr><td class="muted" style="white-space:nowrap">${new Date(x.t).toLocaleString(LOC(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(x.name)}</td></tr>`).join('')}</tbody></table>`;
  h += '<p class="muted">Postup se aktualizuje s každým setkáním; úsek a body cechu po otevření mapy expedice. Vyjednávání radí okno 🤝.</p>';
  return h;
}

// ---------- Kvantové invaze ----------
// Quantum Pass: body, stupeň, postup k další odměně, nevyzvednuté odměny.
// Stupeň má práh v bodech (po 250); náhled (s každou akcí v QI) nese další odměnu a body v rozpracovaném stupni,
// přehled (otevření okna passu) všechny stupně a co je vyzvednuté.
function qiPassHtml(now) {
  const P = S.qiPass;
  if (!P?.teaser && !P?.ov) return '<p class="muted">Quantum Pass: ukáže se po otevření QI ve hře (celý přehled po otevření okna passu).</p>';
  const gp = P.ov?.prizes?.grandPrizes || [];
  const thr = new Map(gp.map((p) => [p.prizeId || 0, p.totalNeedPoints || 0]));
  const t0 = P.teaser?.[0], step = t0?.totalNeedPoints || 250;
  const thrOf = (id) => (thr.has(id) ? thr.get(id) : Math.floor((id || 0) / 3) * step);
  let total = P.total;
  if (t0 && (P.total == null || (P.teaserT || 0) > (P.totalT || 0))) total = Math.max(0, thrOf(t0.prizeId || 0) - step + (t0.currentPoints || 0));
  const levelsAll = gp.length ? [...new Set(gp.map((p) => p.totalNeedPoints || 0))].sort((a, b) => a - b) : null;
  const reached = levelsAll ? levelsAll.filter((x) => x <= total).length : null;
  const owned = new Set((P.types || []).filter((x) => x.unlocked).map((x) => x.type));
  const TYPE = { grand_prize: 'zdarma', event_pass: 'Quantum Pass', golden_event_pass: 'zlatý pass' };
  const cur = t0 ? t0.currentPoints || 0 : null;
  const unclaimed = gp.filter((p) => (p.totalNeedPoints || 0) <= total && !p.claimed && owned.has(p.type));
  const maxThr = levelsAll ? levelsAll[levelsAll.length - 1] : null;
  const bar = (v, max) => `<div style="background:#efe3c8;border-radius:4px;height:8px;margin:3px 0"><div style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%;height:8px;border-radius:4px;background:#7b4fb5"></div></div>`;
  let h = `<h4>${esc(P.ov?.name || 'Quantum Pass')}</h4><div class="tiles">
    ${tile('Body passu', total != null ? fmt(total) : '–', maxThr ? `z ${fmt(maxThr)}` : '')}
    ${reached != null ? tile('Stupeň', `${reached} / ${levelsAll.length}`, '') : ''}
    ${cur != null ? tile('Do další odměny', `${fmt(cur)} / ${fmt(step)}`, `chybí ${fmt(step - cur)}`) : ''}
    ${P.endsAt ? tile('Pass končí', P.endsAt > now ? 'za ' + durLong(P.endsAt - now) : 'skončil', '') : ''}
  </div>${cur != null ? bar(cur, step) : ''}`;
  if (P.teaser?.length) h += `<p><b>Další odměny:</b> ${P.teaser.map((p) => `<span class="chip${owned.has(p.type) ? '' : ' muted'}" title="${esc(TYPE[p.type] || p.type)}${owned.has(p.type) ? '' : ' – nemáte'}">${owned.has(p.type) ? '' : '🔒 '}${esc(p.reward?.name || '?')}</span>`).join('')}</p>`;
  if (P.ov) h += `<p>${unclaimed.length ? `<span class="hi">Nevyzvednuté odměny: <b>${unclaimed.length}</b></span> – ${unclaimed.slice(0, 6).map((p) => esc(p.reward?.name || '?')).join(', ')}${unclaimed.length > 6 ? ' …' : ''}` : '<span class="ok">Všechny dosažené odměny jsou vyzvednuté.</span>'}
    ${maxThr && total < maxThr ? ` · do posledního stupně chybí <b>${fmt(maxThr - total)}</b> bodů` : ''}</p>`;
  return h + '<p class="muted">Body se obnovují s každou akcí v QI; stupně a vyzvednuté odměny podle posledního otevření okna passu. 🔒 = odměna placeného passu, který nemáte.</p>';
}
function viewQI() {
  const r = S.resources, now = nowServer();
  let h = '';
  const st = S.qiState;
  if (st) {
    const c = st.__class__ || '';
    h += `<p>${/Running/.test(c) && st.endsAt ? `QI běží · konec za <b>${dur(st.endsAt - now)}</b>` : /Pending/.test(c) && st.startsAt ? `QI začne za <b>${dur(st.startsAt - now)}</b>` : /Finished/.test(c) && st.nextStartsAt ? `QI skončily · další začnou za ${dur(st.nextStartsAt - now)}` : esc(c)}</p>`;
  }
  const next = S.timers.find((t) => t.type === 'outpostProduction' && t.gridId === 'guild_raids');
  const { per, other } = armyFrom(S.boosts, S.entities.values());
  const qa = areaValues(per, 'guild_raids');
  h += `<div class="tiles">
    ${tile('Akce', r.guild_raids_action_points != null ? fmt(r.guild_raids_action_points) : '–', other['guild_raids_action_points_collection|all'] ? `sběr +${fmt(other['guild_raids_action_points_collection|all'])}` : '')}
    ${tile('Měna QI', r.guild_raids_currency != null ? fmt(r.guild_raids_currency) : '–', '')}
    ${tile('Produkce v QI', next ? (next.at > now ? 'za ' + dur(next.at - now) : 'hotová') : '–', '')}
  </div>`;
  h += qiPassHtml(now);
  h += `<h4>Armáda v QI</h4><table><thead><tr><th>Útok útočníka</th><th>Obrana útočníka</th><th>Útok obránce</th><th>Obrana obránce</th></tr></thead>
    <tbody><tr>${['aa', 'ad', 'da', 'dd'].map((k) => `<td class="num">${fmt(qa[k])} %</td>`).join('')}</tr></tbody></table>`;
  const qb = Object.entries(other).filter(([k]) => k.startsWith('guild_raids_'));
  if (qb.length) h += `<h4>Bonusy pro QI</h4><table><tbody>${qb.map(([k, v]) => `<tr><td>${esc(BOOST_NAME[k.split('|')[0]] || k.split('|')[0])}</td><td class="num">${fmt(v)}</td></tr>`).join('')}</tbody></table>`;
  const goods = Object.entries(r).filter(([k, v]) => k.startsWith('guild_raids_') && !['guild_raids_action_points', 'guild_raids_currency'].includes(k) && v > 0);
  if (goods.length) h += `<h4>Suroviny QI</h4><p>${goods.map(([k, v]) => `<span class="chip">${esc(resLabel(k).replace(/^guild_raids_/, ''))} <b>${fmt(v)}</b></span>`).join('')}</p>`;
  const qr = S.qiRows?.rows;
  if (qr?.length) {
    h += `<h4>Aktivita cechu v QI</h4><table><thead><tr><th>Člen</th><th class="num">Akce</th><th class="num">Postup</th></tr></thead><tbody>${
      qr.slice().sort((a, b) => (b.progressContribution || 0) - (a.progressContribution || 0)).map((x) => `<tr class="${x.player?.player_id === myId() ? 'me' : ''}"><td>${x.player?.player_id === myId() ? '👤 ' : ''}${esc(x.player?.name || '?')}</td>
        <td class="num">${fmt(x.actionPoints || 0)}</td><td class="num">${fmt(x.progressContribution || 0)}</td></tr>`).join('')}</tbody></table>`;
  } else h += '<p class="muted">Aktivita členů se ukáže po otevření přehledu aktivity v QI ve hře (ukládá se i do Statistiky → Cech).</p>';
  return h;
}
