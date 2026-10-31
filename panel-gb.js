// FoE Reader – panel-gb.js
// Kalkulačka náhozů a kalkulačka cizích VB.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ---------- Kalkulačka náhozů (P1–P5 × koeficient, text do vlákna) ----------
function nahozCalc(rows, entity, ownerName) {
  if (!rows || !entity) return null;
  const gold = isGoldLevel(entity, rows);
  const arcMode = cfg.arcFactor === 'arc';
  const f1000 = Math.round(factorNow(gold) * 1000); // celočíselně kvůli zaokrouhlení (285 × 1,9 = 541,5 → 542)
  const total = entity.state?.forge_points_for_level_up;
  const ownerRow = rows.find((r) => r.rank == null && r.player?.player_id != null);
  const ownerFp = ownerRow?.forge_points || 0;
  // Počet odměňovaných míst není pevný (zlatý stupeň VB má 7 míst) – bereme všechna, která server pošle.
  const places = rows.filter((r) => r.rank && r.reward?.strategy_point_amount > 0).sort((a, b) => a.rank - b.rank).map((r) => {
    const base = r.reward.strategy_point_amount || 0;
    // Hra odměnu s bonusem Archy zaokrouhluje na pětky (175 × 1,99 = 348,25 → 350). Pevné koeficienty cechu na celá čísla.
    const val = arcMode ? roundReward((base * f1000) / 1000) : Math.round((base * f1000) / 1000);
    const holder = r.player?.player_id != null ? { name: r.player.name, fp: r.forge_points || 0 } : null;
    return { rank: r.rank, base, val, holder, filled: !!holder && holder.fp >= val };
  });
  // Zajištění míst: místo je jisté, když po vložení náhozů (v pořadí P1, P2, …) zbývá v budově tak málo FP,
  // že ho nikdo nepředběhne – ani nejsilnější dosavadní přispěvatel na nižších místech (remíza zůstává tomu, kdo vložil dřív).
  // Majitel zajišťuje vlastním vkladem: needOwner = kolik FP ještě musí vložit, aby místo zezelenalo.
  const invested = Math.max(entity.state?.invested_forge_points || 0, rows.reduce((a, r) => a + (r.forge_points || 0), 0));
  if (total != null) {
    let left = total - invested;
    for (const x of places) {
      if (x.filled) { x.safe = true; x.needOwner = 0; continue; }
      left -= x.val - (x.holder?.fp || 0);
      const rival = Math.max(0, ...rows.filter((r) => r.player?.player_id != null && r.rank != null && r.rank > x.rank
        && r.player.player_id !== ownerRow?.player?.player_id).map((r) => r.forge_points || 0));
      x.fits = left >= 0;
      x.needOwner = Math.max(0, rival + left - x.val);
      x.safe = x.fits && x.needOwner === 0;
    }
  }
  const sumP = places.reduce((a, x) => a + x.val, 0);
  const ownShare = total != null ? Math.max(0, total - sumP) : null;
  const free = places.filter((x) => !x.filled && x.val > 0);
  const text = `${ownerName} ${entName(entity.cityentity_id)} ${entity.level}→${entity.level + 1} ` + free.map((x) => `P${x.rank}(${x.val})`).join(' ');
  return { gold, total, ownerFp, places, sumP, ownShare, ownLeft: ownShare != null ? Math.max(0, ownShare - ownerFp) : null, text: text.trim() };
}

// Volba koeficientu: rychlé předvolby + vlastní hodnota (pamatuje se).
const FACTORS = [1.8, 1.85, 1.9, 1.92, 1.95, 2.0];
function arcFactorNow(gold) {
  const arc = arcBonus(gold);
  return Math.round((1 + arc / 100) * 1000) / 1000;
}
function factorNow(gold) {
  if (cfg.arcFactor === 'arc') return arcFactorNow(gold) || 1;
  return +cfg.arcFactor || 1.9;
}
function factorPicker(gold) {
  // Tlačítko „Arc“ = skutečný bonus vaší Archy pro stupeň dané úrovně (měď / zlato); přepíná se samo.
  const arcF = arcFactorNow(gold);
  const auto = cfg.arcFactor === 'arc';
  const arcBtn = arcF ? `<button class="fbtn arc ${auto ? 'on' : ''}" data-factor="arc" title="${gold ? 'Zlatý' : 'Měděný'} bonus příspěvků vaší Archy ${fmt(arcBonus(gold))} % (${gold ? 'úrovně nad 100' : 'úrovně do 100'}) – mění se samo">Arc ${gold ? '🥇' : '🥉'} ${dec(arcF)}</button>` : '';
  return arcBtn + FACTORS.map((f) => `<button class="fbtn ${!auto && +cfg.arcFactor === f ? 'on' : ''}" data-factor="${f}">${dec(f.toFixed(2).replace(/0$/, ''))}</button>`).join('')
    + ` <input type="number" data-cfg="arcFactor" value="${factorNow(gold)}" step="0.01" min="1" max="3" style="width:60px" title="Vlastní koeficient">`;
}

function viewNahoz(c, title) {
  if (!c) return '';
  return `<div class="cfg"><div><b>${esc(title)}</b> · koeficient ${factorPicker(c.gold)}</div>
    <div class="copyrow"><input type="text" class="copytext" readonly value="${esc(c.text)}"><button data-act="copy" data-text="${esc(c.text)}">Kopírovat</button></div></div>
    <table><thead><tr><th>Místo</th><th>Odměna</th><th>Nához</th><th>Stav</th><th>Zajištění</th></tr></thead><tbody>${
      c.places.map((x) => `<tr class="${x.filled ? 'muted' : x.safe ? 'safe' : ''}"><td>P${x.rank}</td><td class="num">${fmt(x.base)}</td><td class="num"><b>${fmt(x.val)}</b></td>
        <td>${x.holder ? `${esc(x.holder.name)} ${fmt(x.holder.fp)}${x.filled ? ' ✓' : ' (málo)'}` : 'volné'}</td>
        <td>${x.filled ? '' : x.safe ? '🔒 zajištěno' : x.fits === false ? '<span class="muted">nevejde se</span>' : x.needOwner != null ? `vložte ještě <b>${fmt(x.needOwner)}</b>` : ''}</td></tr>`).join('')}
      <tr><td colspan="2">Vlastní podíl (celkem ${fmt(c.total)} − náhozy ${fmt(c.sumP)})</td><td class="num"><b>${fmt(c.ownShare)}</b></td>
        <td colspan="2">vloženo ${fmt(c.ownerFp)}, zbývá <b>${fmt(c.ownLeft)}</b></td></tr>
    </tbody></table>`;
}

// ---------- VB přátel (kalkulátor) ----------
// Bonus příspěvků: měděný (contribution_boost) platí pro stavbu úrovní do 100, zlatý
// (contribution_boost_gold) pro úrovně nad 100. Sčítá se ze všech budov (Archa, Shattered Horizon Siphon …).
function arcBonus(gold) {
  const type = gold ? 'contribution_boost_gold' : 'contribution_boost';
  let sum = 0;
  for (const e of S.entities.values()) for (const b of entBonuses(e)) if (b.type === type) sum += b.value || 0;
  return sum;
}
// Zaokrouhlení na násobky 5 jako ve hře (i základní odměny ze serveru jsou po 5).
const round5 = (x) => Math.round(Math.round(x * 1000) / 5000) * 5;
// Zlatý stupeň: rozhodují plánky v odměnách (věkové VB, např. Saturn VI Gate, zůstávají měděné i nad úr. 100).
// Bez pořadí odhad podle úrovně (cílová úroveň nad 100).
function isGoldLevel(gb, rows) {
  const t = rankingTier(rows, gb?.level);
  if (t) return t === 'gold';
  return gbNewRules() && gb?.level != null && gb.level > 100; // zlatá od úrovně 101; staré servery zlatý bonus nemají
}

// Kalkulátor pro naposledy otevřenou cizí VB (null = není).
function foreignCalcHtml() {
  let html = '';
  const gb = S.foreignGB;
  const rk = S.gbRanking?.rankings;
  if (gb || rk) {
    const gold = isGoldLevel(gb, rk);
    const arc = arcBonus(gold);
    const owner = gb ? (S.players.get(gb.player_id)?.name || `#${gb.player_id}`) : '?';
    const inv = gb?.state?.invested_forge_points || 0;
    const need = gb?.state?.forge_points_for_level_up;
    const remaining = need != null ? need - inv : null;
    const others = (rk || []).filter((r) => r.player?.player_id !== myId() && r.player?.player_id !== gb?.player_id);
    const mine = (rk || []).find((r) => r.player?.player_id === myId())?.forge_points || 0;
    const places = (rk || []).filter((r) => r.rank && r.reward?.strategy_point_amount > 0) // místa jen s plánky (P7 u zlaté) vynechat
      .sort((a, b) => a.rank - b.rank);
    html += `<p><b>${esc(gb ? entName(gb.cityentity_id) : 'Otevřená VB')}</b> · ${esc(owner)}${gb ? ` · úr. ${gb.level}` : ''}<br>
      Chybí: <b>${remaining != null ? fmt(remaining) : '?'}</b> FP · bonus Archy ${fmt(arc)} % (${gold ? 'zlatý' : 'měděný'}) · váš vklad ${fmt(mine)}${S.packageFP != null ? ` · máte ${fmt((S.resources.strategy_points || 0) + S.packageFP)} FP` : ''}</p>`;
    // Nához podle zvoleného koeficientu (Arc / 1,9 / vlastní) – přepočítá se hned po přepnutí.
    const nc = gb && rk ? nahozCalc(rk, gb, S.players.get(gb.player_id)?.name || S.gbRanking?.ownerName || '') : null;
    const nahozOf = new Map((nc?.places || []).map((x) => [x.rank, x.val]));
    if (nc) html += `<div class="cfg"><div>Nához – koeficient ${factorPicker(nc.gold)}</div></div>`;
    if (places.length) {
      // Po vlastním náhozu: nejlepší místo, které už máte jisté (nikdo vás nepředběhne), je zelené „✓ vaše“;
      // horší místa jsou přeškrtnutá (dvě místa mít nejde), lepší místa ukazují, kolik přidat na posun výš.
      const costOf = (i) => (remaining != null ? Math.max(0, Math.ceil((remaining + (others[i]?.forge_points || 0) - mine) / 2)) : null);
      const doneIdx = mine > 0 ? places.findIndex((p, i) => costOf(i) === 0) : -1;
      const myRank = (rk || []).find((r) => r.player?.player_id === myId())?.rank;
      html += `<table><thead><tr><th>Místo</th><th>Drží (bez vás)</th><th>Odměna FP</th><th>Medaile</th><th title="Kolik na místo vložit při náhozu podle zvoleného koeficientu">Nához ×${dec(factorNow(gold))}</th><th>Zajistit za</th><th>Zisk</th></tr></thead><tbody>${
        places.map((p, i) => {
          const holder = others[i]?.forge_points || 0;
          const base = p.reward.strategy_point_amount || 0;
          const withArc = roundReward(base * (1 + arc / 100)); // stejně jako hra (prasátko)
          const medBase = p.reward.resources?.medals || 0;
          const medArc = Math.round(medBase * (1 + arc / 100)); // bonus Archy platí i na medaile
          const cost = costOf(i);
          const possible = cost != null && cost <= remaining;
          const profit = possible ? withArc - cost - mine : null; // celý vklad vč. již vloženého
          const done = i === doneIdx, gone = doneIdx >= 0 && i > doneIdx;
          const cls = done ? 'done' : gone ? 'gone' : possible ? '' : 'muted';
          const costTxt = done ? '✓ vaše' : !possible ? 'nelze' : mine > 0 && !gone ? `+${fmt(cost)}` : fmt(cost);
          return `<tr class="${cls}"${done ? ' title="Místo máte jisté – nikdo vás už nepředběhne."' : gone ? ' title="Horší než místo, které už máte."' : mine > 0 && possible ? ` title="Přidat k vašim ${fmt(mine)} FP"` : ''}><td>${p.rank}.${p.rank === myRank ? ' 👤' : ''}</td><td class="num">${fmt(holder)}</td>
            <td class="num">${fmt(base)} → <b>${fmt(withArc)}</b></td>
            <td class="num" title="${medBase ? `${fmt(medBase)} bez bonusu Archy` : ''}">${medBase ? fmt(medArc) : ''}</td>
            <td class="num"${nahozOf.has(p.rank) ? ` title="Při náhozu dostanete ${fmt(withArc)} FP: ${withArc - nahozOf.get(p.rank) >= 0 ? '+' : ''}${fmt(withArc - nahozOf.get(p.rank))}"` : ''}><b>${nahozOf.has(p.rank) ? fmt(nahozOf.get(p.rank)) : ''}</b></td>
            <td class="num">${costTxt}</td>
            <td class="num ${profit > 0 ? 'hi' : ''}">${profit != null ? (profit > 0 ? '+' : '') + fmt(profit) : ''}</td></tr>`;
        }).join('')}</tbody></table>
        <p class="muted">„Zajistit za“ = kolik FP ještě vložit, aby vás na daném místě už nikdo nepředběhl. Zisk počítá s celým vaším vkladem.${mine > 0 ? ' 👤 = vaše současné místo; zeleně ✓ místo, které máte jisté; přeškrtnutá místa jsou horší než to vaše.' : ''}</p>`;
    } else if (rk) {
      html += '<p class="muted">Pořadí přišlo, ale bez odměn – pošlete mi log, upravím čtení.</p>';
    }
  } else {
    return null;
  }
  if (gb && rk) {
    const c = nahozCalc(rk, gb, S.players.get(gb.player_id)?.name || S.gbRanking.ownerName || '');
    if (c && c.text) html += `<div class="cfg"><div><b>Text do vlákna</b> <span class="muted">(koeficient ${dec(factorNow(c.gold))})</span></div>
      <div class="copyrow"><input type="text" class="copytext" readonly value="${esc(c.text)}"><button data-act="copy" data-text="${esc(c.text)}">Kopírovat</button></div></div>`;
  }
  return html;
}
function otherGBsHtml() {
  let html = '';
  {
    const list = S.otherGBs.list.map((g) => ({
      name: g.name || entName(g.city_entity_id || g.cityentity_id),
      level: g.level, max: g.maxLevel ?? g.max_level,
      left: g.max_progress != null && g.current_progress != null ? g.max_progress - g.current_progress : null,
      owner: g.player?.name, myRank: g.rank, myFp: g.forge_points,
    })).sort((a, b) => (a.left ?? 1e15) - (b.left ?? 1e15));
    html += `<h4>VB hráče ${esc(list[0].owner || '')}</h4><table><thead><tr><th>Budova</th><th>Úr.</th><th>Chybí FP</th><th>Vy</th></tr></thead><tbody>${
      list.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.level ?? ''}${g.max ? ' / ' + g.max : ''}</td><td class="num">${fmt(g.left)}</td>
        <td class="num">${g.myRank ? `${g.myRank}. místo · ${fmt(g.myFp)} FP` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  return html;
}
