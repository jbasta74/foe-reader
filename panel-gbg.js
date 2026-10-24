// FoE Reader – panel-gbg.js
// GBG: přehled, opotřebení, provincie, mapa (schéma).
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ---------- GBG ----------
function viewGBG() {
  let html = '';
  const lb = S.gbgLeaderboard;
  const bg = S.gbg;
  if (bg) {
    const parts = bg.battlegroundParticipants || [];
    const pname = (id) => parts.find((p) => p.participantId === id)?.clan?.name || `#${id}`;
    const provs = bg.map?.provinces || [];
    const owned = {};
    for (const p of provs) if (p.ownerId != null) owned[p.ownerId] = (owned[p.ownerId] || 0) + 1;
    const me = bg.currentParticipantId ?? bg.currentPlayerParticipantId;
    const now = nowServer();
    const att = bg.currentPlayerParticipant?.attrition;
    html += `<p>${esc(bg.league?.name || '')}${bg.endsAt ? ` · konec za ${dur(bg.endsAt - now)}` : ''}${att ? ` · opotřebení ${att.level}` : ''}</p>`;
    html += `<h4>Cechy na mapě</h4><table><thead><tr><th>Cech</th><th>Body vítězství</th><th>Provincie</th></tr></thead><tbody>${
      parts.slice().sort((a, b) => (b.victoryPoints || 0) - (a.victoryPoints || 0)).map((p) =>
        `<tr class="${p.participantId === me ? 'sel' : ''}"><td>${esc(p.clan?.name || p.participantId)}</td>
         <td class="num">${fmt(p.victoryPoints || 0)}</td><td class="num">${owned[p.participantId] || 0}</td></tr>`).join('')}</tbody></table>`;
    const prog = (p, pred) => (p.conquestProgress || []).filter(pred).filter((c) => c.progress > 0);
    const attacking = provs.filter((p) => prog(p, (c) => c.participantId === me).length)
      .map((p) => ({ p, c: prog(p, (c) => c.participantId === me)[0] }))
      .sort((a, b) => b.c.progress / b.c.maxProgress - a.c.progress / a.c.maxProgress);
    if (attacking.length) {
      html += `<h4>Kde útočíme (celý cech)</h4><table><thead><tr><th>Provincie</th><th>Vlastník</th><th>Postup</th><th>1 min</th><th>5 min</th></tr></thead><tbody>${
        attacking.map(({ p, c }) => `<tr><td>${btype(p)} ${esc(provLabel(p.id ?? 0))}</td><td>${esc(pname(p.ownerId))}</td><td class="num">${fmt(c.progress)} / ${fmt(c.maxProgress)}</td>
          <td class="num">${plus(gain(p.id ?? 0, me, 1))}</td><td class="num">${plus(gain(p.id ?? 0, me, 5))}</td></tr>`).join('')}</tbody></table>
        <p class="muted">Sloupce 1 a 5 min = o kolik postoupil celý cech (bitva +1, vyjednávání +2). Přibývá-li víc, než děláte sám, jede tam někdo s vámi. Počítá se od otevření mapy GBG.</p>`;
    }
    html += viewAttrition();
    html += `<p>${[['list', 'Seznam provincií'], ['map', 'Mapa (schéma)']].map(([k, l]) => `<button class="fbtn ${gbgView === k ? 'on' : ''}" data-gbgview="${k}">${l}</button>`).join('')}</p>`;
    html += gbgView === 'map' ? viewGbgMap(provs, me, pname, now) : viewProvinces(provs, me, pname, now);
    const defending = provs.filter((p) => p.ownerId === me && prog(p, (c) => c.participantId !== me).length);
    if (defending.length) {
      html += `<h4>Kde útočí na nás</h4><table><thead><tr><th>Provincie</th><th>Útočník</th><th>Postup</th><th>1 min</th><th>5 min</th></tr></thead><tbody>${
        defending.flatMap((p) => prog(p, (c) => c.participantId !== me).map((c) =>
          `<tr><td>${btype(p)} ${esc(provLabel(p.id ?? 0))}</td><td>${esc(pname(c.participantId))}</td><td class="num hi">${fmt(c.progress)} / ${fmt(c.maxProgress)}</td>
           <td class="num">${plus(gain(p.id ?? 0, c.participantId, 1))}</td><td class="num">${plus(gain(p.id ?? 0, c.participantId, 5))}</td></tr>`)).join('')}</tbody></table>`;
    }
  }
  if (lb?.length) {
    const prev = S.gbgLbPrev;
    const rows = lb.map((r) => {
      const key = r.player?.player_id ?? r.player?.name;
      const cur = { b: r.battlesWon || 0, n: r.negotiationsWon || 0, a: r.attrition || 0 };
      const old = prev?.rows.get(key);
      return { name: r.player?.name || r.name, ...cur, total: cur.b + 2 * cur.n,
        db: old ? cur.b - old.b : 0, dn: old ? cur.n - old.n : 0, da: old ? cur.a - old.a : 0 };
    }).sort((a, b) => ((b.db + 2 * b.dn) - (a.db + 2 * a.dn)) || (b.total - a.total));
    const d = (n) => (n > 0 ? ` <span class="hi">+${fmt(n)}</span>` : '');
    const mins = prev ? Math.max(1, Math.round((S.gbgLbSnap.time - prev.time) / 60000)) : null;
    const active = rows.filter((r) => r.db + r.dn > 0);
    html += `<h4>Členové cechu</h4>
      <p class="muted">${prev ? `Červeně = přírůstek za ${mins} min (od minulého otevření žebříčku). Aktivních: ${active.length}.` : 'Otevřete žebříček ve hře ještě jednou později – ukáže se, kdo mezitím bojoval.'}</p>
      <table><thead><tr><th>Hráč</th><th>Bitvy</th><th>Vyjednávání</th><th>Opotřebení</th><th>Celkem*</th></tr></thead><tbody>${
      rows.map((r) => `<tr class="${prev && r.db + r.dn > 0 ? 'sel' : ''}"><td>${esc(r.name)}</td><td class="num">${fmt(r.b)}${d(r.db)}</td><td class="num">${fmt(r.n)}${d(r.dn)}</td>
        <td class="num">${fmt(r.a)}${d(r.da)}</td><td class="num">${fmt(r.total)}</td></tr>`).join('')}</tbody></table>
      <p class="muted">* bitva = 1, vyjednávání = 2. Kde kdo bojuje, server neposílá – jen postup celého cechu po provinciích (tabulka „Kde útočíme“).</p>`;
  } else if (bg) {
    html += '<p class="muted">Žebříček členů se objeví po otevření žebříčku v GBG.</p>';
  }
  if (!html) html = '<p class="muted">Otevřete ve hře mapu GBG.</p>';
  return html;
}

// ---------- GBG: opotřebení ----------
let attrTarget = null;
function viewAttrition() {
  const a = S.attrition;
  if (!a) return '';
  const reset = S.timers.find((t) => t.type === 'battlegroundsAttrition')?.at;
  const lvl = a.level || 0; // úroveň 0 server neposílá (chybí pole) – po resetu by jinak vyšlo NaN
  const target = attrTarget ?? lvl + 20;
  const need = Math.max(0, target - lvl);
  const rows = [100, 60, 20].map((c) => `<tr><td>${c} %</td><td class="num">${fmt(Math.ceil(need / (c / 100)))}</td></tr>`).join('');
  return `<h4>Opotřebení</h4>
    <table><tbody>
      <tr><td>Úroveň</td><td class="num"><b>${fmt(lvl)}</b></td></tr>
      <tr><td>Bonus bránících armád</td><td class="num">${fmt(a.defendingArmyBonus)} %</td></tr>
      <tr><td>Násobitel vyjednávání</td><td class="num">${fmt(a.negotiationMultiplier)} %</td></tr>
      ${reset ? `<tr><td>Reset</td><td class="num">za ${dur(reset - nowServer())}</td></tr>` : ''}
    </tbody></table>
    <p>Kolik bitev do úrovně <input type="number" data-input="attrTarget" value="${target}" min="${lvl}" style="width:70px"> (průměrně, podle šance provincie):</p>
    <table><thead><tr><th>Šance na opotřebení</th><th>Bitev</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Šanci ukazuje sloupec „Opotř.“ v tabulce provincií. Jak roste bonus obránců s úrovní, server neposílá, proto ho nepočítám dopředu.</p>`;
}

// ---------- GBG: provincie a sledování ----------
// Typ boje v provincii: isAttackBattleType = červená (útočná, bojuje se proti útočné armádě), jinak modrá (obranná).
const btype = (p) => (p?.isSpawnSpot ? '' : p?.isAttackBattleType
  ? '<span class="bt red" title="Červená provincie – útočný typ boje">⚔</span>'
  : '<span class="bt blue" title="Modrá provincie – obranný typ boje">🛡</span>');
// ---------- Mapa GBG (schéma) ----------
// Souřadnice server neposílá – kruhové schéma podle názvů: číslice = kruh od středu, pořadí v kruhu podle id.
let gbgView = 'list';
const CLAN_COLS = ['#2e7d32', '#c0392b', '#2e6db4', '#e67e22', '#8e44ad', '#16a085', '#b8860b', '#7f8c8d'];
function viewGbgMap(provs, me, pname, now) {
  const parts = (S.gbg.battlegroundParticipants || []).slice().sort((a, b) => (a.participantId === me ? -1 : b.participantId === me ? 1 : a.participantId - b.participantId));
  const col = new Map(parts.map((p, i) => [p.participantId, CLAN_COLS[i % CLAN_COLS.length]]));
  const ringOf = (id) => { const m = String(provLabel(id) || '').match(/^[A-Z]?(\d)/); return m ? +m[1] : null; };
  const rings = new Map();
  for (const p of provs) { const id = p.id ?? 0, r = ringOf(id); if (r == null) continue; (rings.get(r) || rings.set(r, []).get(r)).push(p); }
  if (!rings.size) return '<p class="muted">Pro tuto mapu neumím schéma nakreslit (chybí názvy provincií).</p>';
  const R = Math.max(...rings.keys()), S0 = 300, C = S0 / 2, step = (C - 6) / R, watch = loadWatch();
  const pt = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
  let g = '';
  for (const [r, list] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const n = list.length, r0 = n === 1 ? 0 : (r - 1) * step, r1 = r * step;
    list.forEach((p, i) => {
      const id = p.id ?? 0, a0 = -Math.PI / 2 + (i / n) * 2 * Math.PI, a1 = -Math.PI / 2 + ((i + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
      const own = p.ownerId === me, base = !!p.isSpawnSpot, locked = (p.lockedUntil || 0) > now;
      const atk = (p.conquestProgress || []).some((c) => c.progress > 0 && c.participantId === me);
      const hit = own && (p.conquestProgress || []).some((c) => c.progress > 0);
      const fill = col.get(p.ownerId) || '#bbb';
      const d = n === 1 ? `M${C - r1},${C}a${r1},${r1} 0 1,0 ${2 * r1},0a${r1},${r1} 0 1,0 ${-2 * r1},0Z`
        : (() => { const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0), big = a1 - a0 > Math.PI ? 1 : 0;
          return `M${x0.toFixed(1)},${y0.toFixed(1)}A${r1},${r1} 0 ${big},1 ${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}${r0 ? `A${r0},${r0} 0 ${big},0 ${x3.toFixed(1)},${y3.toFixed(1)}` : ''}Z`; })();
      const tip = `<b>${esc(provLabel(id))}</b><br>${own ? 'my' : esc(pname(p.ownerId))}${base ? ' · základna' : ''}<br>${p.isAttackBattleType ? '⚔ červená (útočná)' : '🛡 modrá (obranná)'}${locked ? `<br>odemkne se za ${dur(p.lockedUntil - now)}` : base ? '' : '<br><b>odemčená</b>'}${p.victoryPoints != null ? `<br>${fmt(p.victoryPoints)} bodů` : ''}${watch.has(id) ? '<br>★ sledovaná' : ''}`;
      g += `<path d="${d}" fill="${fill}" fill-opacity="${base ? 0.95 : locked ? 0.35 : 0.8}" stroke="${hit ? '#ff0' : atk ? '#000' : '#fbf6ec'}" stroke-width="${hit || atk ? 2.5 : 1}"
        ${own || base ? '' : `data-watch="${id}" style="cursor:pointer"`} data-tip="${esc(tip)}"/>`;
      const [lx, ly] = n === 1 ? [C, C] : pt((r0 + r1) / 2, am);
      const short = (String(provLabel(id)).match(/^([A-Z]\d[A-Z]?)/) || [])[1] || id;
      g += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="middle" font-size="${n > 20 ? 7 : 9}" fill="#fff" style="pointer-events:none;font-weight:700">${base ? '⌂' : watch.has(id) ? '★' : esc(short)}</text>`;
      if (!base) { const [bx, by] = n === 1 ? [C, C + 10] : pt(r1 - 5, am); g += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="2.6" fill="${p.isAttackBattleType ? '#c0392b' : '#2e6db4'}" stroke="#fff" stroke-width=".8" style="pointer-events:none"/>`; }
    });
  }
  const counts = {}; for (const p of provs) if (p.ownerId != null) counts[p.ownerId] = (counts[p.ownerId] || 0) + 1;
  return `<svg viewBox="0 0 ${S0} ${S0}" width="100%" style="max-width:520px;display:block;margin:0 auto">${g}</svg>
    <div class="legend" style="justify-content:center">${parts.map((p) => `<span><i style="background:${col.get(p.participantId)};height:10px;width:10px"></i>${esc(p.participantId === me ? 'my' : p.clan?.name || p.participantId)} (${counts[p.participantId] || 0})</span>`).join('')}</div>
    <p class="muted">Schéma (ne přesná mapa ze hry): kruhy podle čísla v názvu provincie. Bledá = zamčená, ⌂ základna, ★ sledovaná, černý okraj = útočíme, žlutý = útočí na nás;
      tečka ⚔ červená / 🛡 modrá. Klik na provincii ji označí ★ ke sledování; po najetí myší podrobnosti.</p>`;
}
function viewProvinces(provs, me, pname, now) {
  const watch = loadWatch();
  const names = provNames();
  const data = provData();
  const mine = new Set(provs.filter((p) => p.ownerId === me).map((p) => p.id ?? 0));
  const isNeighbour = (id) => (gameProv(id)?.conn || data[id]?.[2] || []).some((n) => mine.has(n)); // sousedství ze hry, jinak z tabulky
  const list = provs.map((p) => {
    const id = p.id ?? 0, own = p.ownerId === me;
    // isSpawnSpot = základna cechu (startovní provincie), na tu se útočit nedá
    return { p, id, own, base: !!p.isSpawnSpot, left: (p.lockedUntil || 0) - now, near: !own && !p.isSpawnSpot && isNeighbour(id) };
  }).sort((a, b) => (watch.has(b.id) - watch.has(a.id)) || (a.own - b.own) || (a.base - b.base) || (b.near - a.near)
    || (Math.max(0, a.left) - Math.max(0, b.left)) || (a.id - b.id));
  return `<h4>Provincie (★ = upozornit ${cfg.gbgWatchLead ? cfg.gbgWatchLead + ' min před' : 'při'} odemknutí)</h4>
    <table class="prov"><thead><tr><th></th><th>Název</th><th>Vlastník</th><th>Sousedí</th><th>Odemčeno</th><th>Opotř.</th><th>Body</th></tr></thead><tbody>${
    list.map(({ p, id, left, own, near, base }) => `<tr class="${watch.has(id) ? 'sel' : own || base ? 'muted' : ''}">
      <td style="white-space:nowrap">${own || base ? '' : `<button class="star" data-watch="${id}" title="Sledovat">${watch.has(id) ? '★' : '☆'}</button>`}${btype(p)}</td>
      <td title="${esc(provFull(id))} · #${id}"><input type="text" class="pname" data-prov="${id}" value="${esc(names[id] || '')}" placeholder="#${id}" maxlength="30"></td>
      <td>${own ? 'my' : esc(pname(p.ownerId))}</td>
      <td>${near ? '<span class="hi">s námi</span>' : ''}</td>
      <td class="num">${base ? 'základna' : left > 0 ? 'za ' + dur(left) : own ? '' : '<b>teď</b>'}</td>
      <td class="num">${p.gainAttritionChance != null ? p.gainAttritionChance + ' %' : '–'}</td>
      <td class="num">${fmt(p.victoryPoints)}</td></tr>`).join('')
  }</tbody></table>
    <p class="muted"><span class="bt red">⚔</span> červená (útočná) · <span class="bt blue">🛡</span> modrá (obranná) provincie. „Sousedí s námi“ = hraničí s některou naší provincií, dá se na ni tedy útočit. Název lze přepsat (uloží se). Celý název a číslo se ukážou po najetí myší.</p>`;
}
