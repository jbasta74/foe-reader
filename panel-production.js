// FoE Reader – panel-production.js
// Bonusy, snímky statistik, produkce, denní přehled výroby, rating efektivity.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
// ---------- Bonusy ----------
const BOOST_PARTS = {
  att_boost_attacker: ['aa'], def_boost_attacker: ['ad'], att_boost_defender: ['da'], def_boost_defender: ['dd'],
  att_def_boost_attacker: ['aa', 'ad'], att_def_boost_defender: ['da', 'dd'],
  att_def_boost_attacker_defender: ['aa', 'ad', 'da', 'dd'],
};
// Bonusy Velkých budov NEJSOU v BoostService.getAllBoosts – jsou jen v entity.bonuses
// (bonusCategory = passiveBonus). Mapování ověřeno proti radnici.
const GB_BOOST_PARTS = {
  military_boost: ['aa', 'ad'],            // Zeus, Saturn VI Gate CENTAURUS
  advanced_tactics: ['aa', 'ad', 'da', 'dd'], // Space Carrier, HYDRA, Himeji
  fierce_resistance: ['da', 'dd'],         // Observatory, PEGASUS
  attacker_defense_boost: ['ad'],          // Château (Exp.), Himeji (GBG)
  defender_attack_boost: ['da'],           // Archa (GBG), Blue Galaxy (Exp.)
  defense_boost: ['dd'],                   // Observatory (GBG), Zeus (Exp.)
  attacker_attack_boost: ['aa'], defender_defense_boost: ['dd'],
  attack_boost: ['aa'],                    // Zeus – násobitel útoku v expedici
};
const FEATURE = { all: 'Všude', battleground: 'GBG', guild_expedition: 'Expedice', guild_raids: 'Kvantové invaze' };
const BOOST_NAME = {
  forge_points_production: 'Produkce FP', coin_production: 'Produkce mincí', supply_production: 'Produkce zásob',
  goods_production: 'Produkce zboží', guild_raids_action_points_collection: 'QI akce – sběr',
  guild_raids_action_points_capacity: 'QI akce – kapacita', guild_raids_supplies_production: 'QI zásoby – produkce',
  guild_raids_supplies_start: 'QI zásoby – start', guild_raids_coins_production: 'QI mince – produkce',
  guild_raids_coins_start: 'QI mince – start', guild_raids_goods_start: 'QI zboží – start', guild_raids_units_start: 'QI jednotky – start',
  antiques_dealer_slot: 'Antikvář – sloty', army_scout_time: 'Čas průzkumu', construction_time: 'Čas stavby',
  cop_playthrough_reward: 'Odměna za průchod CoP', item_exchange_gemstone_value: 'Výměna předmětů – drahokamy',
  item_exchange_tradecoin_value: 'Výměna předmětů – obch. mince', outpost_cooldown_time: 'Základna – cooldown',
  pvp_arena_attempt_refill_interval: 'PvP aréna – doplnění pokusů', recruitment_time: 'Čas rekrutace',
  tavern_shop_price: 'Hospoda – sleva v obchodě', tavern_silver_collect_bonus: 'Hospoda – bonus stříbra',
  tavern_visit_fp_drop: 'Hospoda – FP při návštěvě', tavern_visit_silver_drop: 'Hospoda – stříbro při návštěvě',
};

// Sečte vojenské bonusy ze seznamu Boostů a pasivní bonusy Velkých budov.
// per[oblast] = {aa, ad, da, dd}, other['typ|oblast'] = hodnota.
function armyFrom(list, ents) {
  const per = {}, other = {}, gbSum = { aa: 0, ad: 0, da: 0, dd: 0 }, mult = {};
  Object.defineProperty(per, 'mult', { value: mult, enumerable: false });
  for (const b of list) {
    const parts = BOOST_PARTS[b.type];
    if (parts) {
      const f = (per[b.targetedFeature || 'all'] ||= { aa: 0, ad: 0, da: 0, dd: 0 });
      for (const p of parts) f[p] += b.value || 0;
    } else if (b.type) {
      const k = `${b.type}|${b.targetedFeature || 'all'}`;
      other[k] = (other[k] || 0) + (b.value || 0);
    }
  }
  for (const e of ents) {
    if (e.type !== 'greatbuilding') continue;
    for (const bo of entBonuses(e)) {
      const parts = GB_BOOST_PARTS[bo.type];
      if (!parts || bo.bonusCategory?.value !== 'passiveBonus') continue;
      const feat = bo.targetedFeature || 'all';
      // Násobitel (isBonusMultiplier): navýší celkový bonus v oblasti o value % – ověřeno proti radnici 20. 10.
      // (expedice: Zeus 2 + Virtual Future 1 → útok útočníka ×1,03: 33 222 → 34,2K jako ve hře)
      if (bo.isBonusMultiplier) { const m = (mult[feat] ||= { aa: 0, ad: 0, da: 0, dd: 0 }); for (const p of parts) m[p] += bo.value || 0; continue; }
      const f = (per[feat] ||= { aa: 0, ad: 0, da: 0, dd: 0 });
      for (const p of parts) { f[p] += bo.value || 0; if (feat === 'all') gbSum[p] += bo.value || 0; }
    }
  }
  return { per, other, gbSum };
}
// Výsledná síla v oblasti = „Všude“ + bonus pro oblast (v Kvantových invazích jen vlastní bonusy).
const ARMY_AREAS = ['all', 'battleground', 'guild_expedition', 'guild_raids'];
function areaValues(per, f) {
  const base = per.all || { aa: 0, ad: 0, da: 0, dd: 0 };
  const m = per.mult || {};
  const factor = (k) => 1 + ((m.all?.[k] || 0) + (f !== 'all' ? m[f]?.[k] || 0 : 0)) / 100;
  if (f === 'all') return Object.fromEntries(['aa', 'ad', 'da', 'dd'].map((k) => [k, Math.round(base[k] * factor(k))]));
  return Object.fromEntries(['aa', 'ad', 'da', 'dd'].map((k) => [k, Math.round(((f === 'guild_raids' ? 0 : base[k]) + (per[f]?.[k] || 0)) * factor(k))]));
}

function viewBoosts() {
  if (!S.boosts.length) return '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
  const { per, other, gbSum } = armyFrom(S.boosts, S.entities.values());
  const feats = ['all', ...new Set([...Object.keys(per), ...Object.keys(per.mult)].filter((f) => f !== 'all'))];
  const row = (f) => {
    const v = areaValues(per, f), m = per.mult[f] || {};
    return `<tr><td>${esc(FEATURE[f] || f)}</td>${['aa', 'ad', 'da', 'dd'].map((k) => `<td class="num">${fmt(v[k])} %${m[k] ? ` <span class="muted" title="násobitel z Velkých budov">×${dec((1 + m[k] / 100).toFixed(2))}</span>` : ''}</td>`).join('')}</tr>`;
  };
  const others = Object.entries(other).sort((a, b) => a[0].localeCompare(b[0]));
  return `<h4>Armáda (oblast = „Všude“ + bonus pro oblast, × násobitel z VB; QI jen vlastní)</h4>
    <table><thead><tr><th>Oblast</th><th>Útok útočníka</th><th>Obrana útočníka</th><th>Útok obránce</th><th>Obrana obránce</th></tr></thead>
    <tbody>${feats.map(row).join('')}</tbody></table>
    <h4>Ostatní bonusy</h4>
    <table><tbody>${others.map(([k, v]) => { const [t, f] = k.split('|');
      return `<tr><td>${esc(BOOST_NAME[t] || t)}${f !== 'all' ? ` <span class="muted">(${esc(FEATURE[f] || f)})</span>` : ''}</td><td class="num">${fmt(v)}</td></tr>`; }).join('')}</tbody></table>
    <p class="muted">${S.boosts.length} bonusů ze seznamu + Velké budovy (útočník ${fmt(gbSum.aa)} / ${fmt(gbSum.ad)}, obránce ${fmt(gbSum.da)} / ${fmt(gbSum.dd)} „Všude“).</p>`;
}

// ---------- Statistiky: snímky vlastního města a navštívených měst ----------
const ERAS = ['StoneAge', 'BronzeAge', 'IronAge', 'EarlyMiddleAge', 'HighMiddleAge', 'LateMiddleAge', 'ColonialAge',
  'IndustrialAge', 'ProgressiveEra', 'ModernEra', 'PostModernEra', 'ContemporaryEra', 'TomorrowEra', 'FutureEra',
  'ArcticFuture', 'OceanicFuture', 'VirtualFuture', 'SpaceAgeMars', 'SpaceAgeAsteroidBelt', 'SpaceAgeVenus',
  'SpaceAgeJupiterMoon', 'SpaceAgeTitan', 'SpaceAgeSpaceHub'];
// Bonusy budovy z metadat po věcích: nový formát components[Věk].boosts.boosts, starý abilities[BoostAbility].boostHints.
function boostMeta(o) {
  let out = null;
  for (const [era, c] of Object.entries(o.components || {})) {
    const b = c?.boosts?.boosts;
    if (Array.isArray(b) && b.length) (out ||= {})[era] = b.map((x) => ({ type: x.type, value: x.value || 0, targetedFeature: x.targetedFeature || 'all' }));
  }
  for (const ab of o.abilities || []) {
    if (ab?.__class__ !== 'BoostAbility') continue;
    for (const h of ab.boostHints || []) for (const [era, x] of Object.entries(h.boostHintEraMap || {})) {
      if (x?.type && x.value) ((out ||= {})[era] ||= []).push({ type: x.type, value: x.value, targetedFeature: x.targetedFeature || 'all' });
    }
  }
  return out;
}
// Bonusy jedné budovy ve městě. Víceérové budovy: entity.level = index věku; jinak věk z metadat nebo věk hráče.
// Ověřeno na vlastním městě proti BoostService.getAllBoosts (475 z 476 budov přesně).
function entityBoosts(e, era) {
  const m = S.entBoost.get(e.cityentity_id);
  if (!m) return [];
  let ek = /MultiAge/.test(e.cityentity_id) && Number.isInteger(e.level) ? ERAS[e.level] : null;
  if (!ek) { const ks = Object.keys(m).filter((k) => k !== 'AllAge'); ek = ks.length === 1 ? ks[0] : era; }
  return [...(m[ek] || []), ...(ek !== 'AllAge' ? m.AllAge || [] : [])];
}
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const AREA_SHORT = { all: 'all', battleground: 'gbg', guild_expedition: 'ge', guild_raids: 'qi' };
const packArmy = (per) => Object.fromEntries(ARMY_AREAS.map((f) => { const v = areaValues(per, f); return [AREA_SHORT[f], [v.aa, v.ad, v.da, v.dd]]; }));
function gbListOf(ents) {
  const out = [];
  for (const e of ents) {
    if (e.type !== 'greatbuilding') continue;
    out.push({ id: e.cityentity_id, n: S.gbInfo.get(e.cityentity_id)?.name || S.names.get(e.cityentity_id) || e.cityentity_id,
      l: e.level || 0, m: e.max_level || null, inv: e.state?.invested_forge_points ?? null });
  }
  return out.sort((a, b) => b.l - a.l);
}
const arcOf = (ents) => { let c = 0, g = 0; for (const e of ents) for (const b of entBonuses(e)) { if (b.type === 'contribution_boost') c += b.value || 0; if (b.type === 'contribution_boost_gold') g += b.value || 0; } return { c, g }; };
const otherNum = (other, type) => other[`${type}|all`] || 0;

function ownSnapshot() {
  const ents = [...S.entities.values()];
  const { per, other } = armyFrom(S.boosts, ents);
  const me = S.players.get(myId());
  return { t: Date.now(), name: S.player.user_name, guild: S.player.clan_name || null, era: S.player.era || null,
    score: me?.score ?? null, army: packArmy(per), fp: otherNum(other, 'forge_points_production'),
    goods: otherNum(other, 'goods_production'), arc: arcOf(ents), gb: gbListOf(ents), buildings: ents.length };
}
function visitSnapshot(v) {
  const d = v.data, op = d.other_player || d.otherPlayer || {};
  const era = typeof op.era === 'string' ? op.era : op.era?.era || null;
  const ents = d.city_map.entities;
  const list = [];
  let known = 0, unknown = 0;
  for (const e of ents) {
    if (e.type === 'greatbuilding' || e.type === 'street' || /^S_/.test(e.cityentity_id || '')) continue;
    if (S.metaSeen.has(e.cityentity_id)) known++; else unknown++;
    list.push(...entityBoosts(e, era));
  }
  const { per, other } = armyFrom(list, ents);
  return { t: v.t, name: op.name || null, guild: op.clan_name || op.clan?.name || null, era,
    score: op.score ?? op.points ?? null, army: packArmy(per), fp: otherNum(other, 'forge_points_production'),
    goods: otherNum(other, 'goods_production'), arc: arcOf(ents), gb: gbListOf(ents), buildings: ents.length,
    known, unknown, gbBonus: ents.some((e) => e.type === 'greatbuilding' && entBonuses(e).length) };
}
// Volá se z překreslování: snímek návštěvy se přepočítá, dokud přicházejí metadata (do 2 min),
// vlastní snímek nejvýš jednou za 10 minut (jeden záznam na den, platí poslední).
function guildPut(rows) {
  rows = rows.filter((r) => r.pid != null);
  if (rows.length && globalThis.FOE_STATS?.ready()) FOE_STATS.putGuild(dayKey(), rows);
}
let lastOwnSnap = 0;
function statsTick() {
  const st = globalThis.FOE_STATS;
  if (!st?.ready()) return;
  const v = S.visit;
  if (v && v.rev !== S.metaRev && Date.now() - v.t < 120000) {
    v.rev = S.metaRev;
    v.snap = visitSnapshot(v);
    st.putVisit(v.pid, dayKey(v.t), v.snap);
  }
  if (S.player && S.boosts.length && S.entities.size && Date.now() - lastOwnSnap > 600000) {
    lastOwnSnap = Date.now();
    st.putOwn(dayKey(), ownSnapshot());
  }
}

// ---------- Produkce ----------
// Vrátí produkty budovy: [{res:{id:n}, guild:bool, motivated:bool, random:bool, label}]
function entityProducts(e) {
  const st = e.state || {}, out = [];
  const po = st.productionOption;
  if (po?.products) {
    for (const p of po.products) {
      const motivated = !!p.onlyWhenMotivated;
      if (p.playerResources?.resources) out.push({ res: p.playerResources.resources, motivated });
      else if (p.guildResources?.resources) out.push({ res: p.guildResources.resources, guild: true, motivated });
      else if (p.reward) out.push({ label: p.reward.name, motivated, random: !!p.isRandom });
    }
  }
  const cp = st.current_product;
  if (cp) {
    const list = cp.products || [cp];
    for (const p of list) {
      if (p.product?.resources) out.push({ res: p.product.resources });
      else if (p.resources?.resources) out.push({ res: p.resources.resources });
      else if (p.goods) out.push({ res: Object.fromEntries(p.goods.map((g) => [g.good_id, g.value])), guild: true });
      else if (p.amount && p.name) out.push({ label: `${p.amount}× ${p.name}` });
    }
  }
  return out;
}

const resLabel = (id) => S.resName?.get(id) || S.goodsName.get(id) || id;
function sumProducts(ents) {
  const sum = {};
  for (const e of ents) for (const p of entityProducts(e)) if (p.res) for (const [k, v] of Object.entries(p.res)) sum[k] = (sum[k] || 0) + v;
  return sum;
}
const resList = (o) => Object.entries(o).map(([k, v]) => `${fmt(v)}× ${resLabel(k)}`).join(', ') || '–';

function viewOutpost(now) {
  const timers = S.timers.filter((t) => t.type === 'outpostProduction');
  const tline = (grid) => { const t = timers.find((x) => x.gridId === grid); return t ? (t.at > now ? 'za ' + dur(t.at - now) : '<span class="hi">hotová</span>') : null; };
  let html = '';
  const qi = tline('guild_raids');
  if (qi) html += `<p><b>Kvantové invaze:</b> další produkce ${qi}</p>`;
  const op = S.gridMap?.cultural_outpost;
  const info = (S.outposts || []).find((o) => o.gridId === 'cultural_outpost' && o.startedAt && !o.finishedAt);
  if (!op) {
    const t = tline('cultural_outpost');
    return html + (t ? `<p><b>Osada${info ? ' – ' + esc(info.name) : ''}:</b> další produkce ${t} <span class="muted">(pro přehled budov osadu ve hře otevřete)</span></p>` : '');
  }
  const ents = [...op.entities.values()];
  const prod = ents.filter((e) => e.state?.__class__ === 'ProducingState' && e.state.next_state_transition_at);
  const ready = prod.filter((e) => e.state.next_state_transition_at <= now);
  const idle = ents.filter((e) => e.state?.__class__ === 'IdleState' && ['cultural_goods_production', 'residential'].includes(e.type));
  const unconn = ents.filter((e) => e.state?.__class__ === 'UnconnectedState');
  html += `<h4>Osada${info ? ' – ' + esc(info.name) : ''}</h4><p>
    ${ready.length ? `<span class="chip hi">k vybrání: ${ready.length}</span>` : ''}<span class="chip">vyrábí: ${prod.length - ready.length}</span>
    ${idle.length ? `<span class="chip hi">stojí: ${idle.length}</span>` : ''}${unconn.length ? `<span class="chip hi">nepřipojeno: ${unconn.length}</span>` : ''}</p>`;
  // Suroviny osady
  if (info) {
    const ids = [info.primaryResourceId, 'diplomacy', ...(info.goodsResourceIds || [])];
    html += `<p>${ids.map((id) => `<span class="good">${esc(resLabel(id))} <b>${fmt(S.resources[id] || 0)}</b></span>`).join('')}</p>`;
  }
  // Další odemčení
  const next = (S.advancements || []).find((a) => !a.isUnlocked);
  if (next) {
    const req = Object.entries(next.requirements?.resources || {}).filter(([k]) => k !== '__class__');
    html += `<p><b>Další odemčení: ${esc(next.name)}</b><br>${req.map(([k, v]) => {
      const have = S.resources[k] || 0;
      return `<span class="good ${have >= v ? '' : 'hi'}">${esc(resLabel(k))} ${fmt(have)} / ${fmt(v)}${have >= v ? ' ✓' : ''}</span>`; }).join('')}</p>`;
  }
  // Kdy bude hotovo
  const groups = new Map();
  for (const e of prod) { const k = Math.ceil(e.state.next_state_transition_at / 60) * 60; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const rows = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  if (rows.length) html += `<table><thead><tr><th>Hotovo</th><th>Budov</th><th>Co</th></tr></thead><tbody>${
    rows.map(([t, es]) => `<tr><td>${t > now ? 'za ' + dur(t - now) : '<span class="hi">teď</span>'}</td><td class="num">${es.length}</td><td>${esc(resList(sumProducts(es)))}</td></tr>`).join('')}</tbody></table>`;
  return html + '<p class="muted">Stav osady se obnoví při jejím otevření ve hře a při výběru nebo spuštění produkce.</p>';
}

// ---------- Denní produkce budov (z metadat podle věku budovy) – podklad pro Přehled výroby a Rating ----------
function prodMeta(o) {
  let out = null;
  for (const [era, c] of Object.entries(o.components || {})) {
    const opts = c?.production?.options;
    if (Array.isArray(opts) && opts.length) (out ||= {})[era] = opts.map((op) => ({ time: op.time || 86400, products: op.products || [] }));
  }
  return out;
}
// Věk budovy: víceérové budovy mají v entity.level index věku, jinak jediný věk v metadatech, jinak věk hráče.
function entEra(e, m, era) {
  if (/MultiAge/.test(e.cityentity_id) && Number.isInteger(e.level) && ERAS[e.level]) return ERAS[e.level];
  const ks = Object.keys(m || {}).filter((k) => k !== 'AllAge');
  return ks.length === 1 ? ks[0] : ks.includes(era) ? era : ks[ks.length - 1];
}
const GOOD_KEY = {
  random_good_of_age: 'g_cur', all_goods_of_age: 'g_cur', random_good_of_previous_age: 'g_prev', all_goods_of_previous_age: 'g_prev',
  random_good_of_next_age: 'g_next', all_goods_of_next_age: 'g_next', random_special_good_up_to_age: 'g_spec',
};
// Konkrétní zboží (živá data) podle věku vůči věku hráče.
function goodKey(id) {
  if (GOOD_KEY[id]) return GOOD_KEY[id];
  const ge = S.goodsEra.get(id);
  if (!ge) return id;
  const d = ERAS.indexOf(ge) - ERAS.indexOf(S.player?.era);
  return d === 0 ? 'g_cur' : d === -1 ? 'g_prev' : d === 1 ? 'g_next' : 'g_other';
}
// Přičte jeden produkt (formát metadat i živého stavu) do denního souhrnu bag s násobkem k.
function addProduct(bag, p, k) {
  if (!p) return;
  if (p.type === 'random' && Array.isArray(p.products)) { for (const x of p.products) addProduct(bag, x.product, k * (x.dropChance || 0)); return; }
  const pr = p.playerResources?.resources;
  if (pr) for (const [id, v] of Object.entries(pr)) { const key = goodKey(id); bag.res[key] = (bag.res[key] || 0) + v * k; }
  const gr = p.guildResources?.resources;
  if (gr) for (const v of Object.values(gr)) bag.res.guild = (bag.res.guild || 0) + v * k;
  if (p.type === 'unit') bag.res.units = (bag.res.units || 0) + (p.amount || 0) * k;
  const rid = p.reward?.id;
  if (rid) {
    const parts = String(rid).split('#');
    const n = +parts[parts.length - 1] || 1;
    // FSP (okamžité dokončení speciální produkce): jako FoE Helper ve fragmentech, celý předmět = 30 fragmentů
    if (String(rid).includes('rush_event_buildings_instant')) bag.res.fsp = (bag.res.fsp || 0) + (parts[0] === 'fragment' ? n : 30 * n) * k;
    if (parts[0] === 'fragment') { const it = parts.slice(1, -1).join('#') || parts[1]; bag.frags[it] = (bag.frags[it] || 0) + n * k; bag.res.frags = (bag.res.frags || 0) + n * k; }
    else if (parts[0] === 'era_unit' || /unit_chest(\d+)$/.test(parts[0])) bag.res.units = (bag.res.units || 0) + (parts[0] === 'era_unit' ? n : +parts[0].match(/(\d+)$/)[1]) * k;
    else if (parts[0] === 'blueprint') bag.res.blueprints = (bag.res.blueprints || 0) + n * k;
    else { const nm = p.reward.name || parts[0]; bag.other[nm] = (bag.other[nm] || 0) + k; }
  }
}
// Denní produkce budovy (vše za 24 h, s motivací – jako FoE Helper). Velké budovy a budovy s volbou výroby (zboží, zásoby)
// podle živého stavu, ostatní z metadat podle věku budovy; bez metadat ze živého stavu.
// Bonusy k produkci ze seznamu bonusů serveru (v %), platí pro budovy kromě VB a radnice (jako FoE Helper).
function prodBoostSums() {
  const out = {};
  for (const b of S.boosts || []) if ((b.targetedFeature || 'all') === 'all') out[b.type] = (out[b.type] || 0) + (b.value || 0);
  return out;
}
const NOT_BOOSTABLE = /CastleSystem|L_AllAge_EasterBonus1|L_AllAge_Expedition16|L_AllAge_ShahBonus17/;
function applyProdBoosts(bag, e, bs) {
  if (!bs || e.type === 'greatbuilding' || e.type === 'main_building' || NOT_BOOSTABLE.test(e.cityentity_id)) return;
  const r = bag.res, mul = (k, pct) => { if (r[k] && pct) r[k] = Math.round(r[k] * (1 + pct / 100)); };
  mul('strategy_points', bs.forge_points_production); mul('money', bs.coin_production); mul('supplies', bs.supply_production);
  for (const k of ['g_prev', 'g_cur', 'g_next', 'g_other']) mul(k, bs.goods_production);
  mul('guild', bs.guild_goods_production);
}
// Denní produkce budovy (vše za 24 h, s motivací – jako FoE Helper). Metadata podle věku budovy se slučují se živým stavem
// (vyšší hodnota vyhrává): živý stav obsahuje bonusy sad a řetězů a u motivovaných budov dvojnásobné mince.
// Velké budovy a budovy s volbou výroby (zboží, zásoby) podle toho, co právě vyrábějí. bs = bonusy k produkci (null = bez).
function buildingDaily(e, era = S.player?.era, bs = null) {
  const bag = { res: {}, frags: {}, other: {}, src: '' };
  const st = e.state || {};
  const m = S.entProd.get(e.cityentity_id);
  const opts = m ? m[entEra(e, m, era)] || m.AllAge : null;
  const live = { res: {}, frags: {}, other: {} };
  if (st.productionOption?.products) for (const p of st.productionOption.products) addProduct(live, p, 86400 / (st.productionOption.time || 86400));
  if (e.type !== 'greatbuilding' && opts?.length === 1) {
    for (const p of opts[0].products) addProduct(bag, p, 86400 / (opts[0].time || 86400));
    bag.src = 'meta';
    for (const part of ['res', 'frags', 'other']) for (const [k, v] of Object.entries(live[part])) if (v > (bag[part][k] || 0)) bag[part][k] = v;
  } else if (st.productionOption?.products) {
    Object.assign(bag, live); bag.src = 'live';
  } else if (st.current_product) {
    const cp = st.current_product, k = 86400 / (cp.production_time || 86400);
    for (const p of cp.products || [cp]) {
      if (p.goods) bag.res.guild = (bag.res.guild || 0) + p.goods.reduce((a, g) => a + (g.value || 0), 0) * k;
      const r = p.product?.resources || p.resources?.resources;
      if (r) for (const [id, v] of Object.entries(r)) { const key = goodKey(id); bag.res[key] = (bag.res[key] || 0) + v * k; }
    }
    bag.src = 'live';
  }
  if (bag.src) applyProdBoosts(bag, e, bs);
  return bag;
}
const PROD_CATS = [
  ['strategy_points', 'FP'], ['g_prev', 'Zboží – předchozí věk'], ['g_cur', 'Zboží – aktuální věk'], ['g_next', 'Zboží – další věk'],
  ['g_spec', 'Speciální zboží'], ['g_other', 'Zboží – jiné věky'], ['guild', 'Cechovní pokladna'], ['money', 'Mince'], ['supplies', 'Zásoby'],
  ['medals', 'Medaile'], ['units', 'Jednotky'], ['frags', 'Fragmenty'], ['blueprints', 'Plánky'],
];
let prodView = 'cycle', prodCat = 'strategy_points';
function dailyOverview() {
  const tot = {}, per = {}; // per[kat] = Map(název -> {n, v})
  let noData = 0;
  const frags = {}, other = {};
  const bs = cfg.prodBoosted !== false ? prodBoostSums() : null;
  for (const e of S.entities.values()) {
    if (['street', 'off_grid', 'hub_part', 'hub_main', 'decoration'].includes(e.type)) continue;
    const b = buildingDaily(e, S.player?.era, bs);
    if (!b.src) { if (S.ent.has(e.cityentity_id) && !S.metaSeen.has(e.cityentity_id)) noData++; continue; }
    const name = S.names.get(e.cityentity_id) || entName(e.cityentity_id);
    for (const [k, v] of Object.entries(b.res)) {
      if (!v) continue;
      tot[k] = (tot[k] || 0) + v;
      const mp = (per[k] ||= new Map()), x = mp.get(name) || { n: 0, v: 0 };
      x.n++; x.v += v; mp.set(name, x);
    }
    for (const [k, v] of Object.entries(b.frags)) frags[k] = (frags[k] || 0) + v;
    for (const [k, v] of Object.entries(b.other)) other[k] = (other[k] || 0) + v;
  }
  return { tot, per, frags, other, noData };
}
const fragName = (id) => [...(S.frags?.values() || [])].find((f) => f.rid && (f.rid === id || f.rid.startsWith(id)))?.name || id.replace(/_/g, ' ');
function viewDaily() {
  const o = dailyOverview();
  const r1 = (v) => fmt(Math.round(v * 10) / 10);
  let h = `<table class="log"><thead><tr><th>Druh</th><th class="num">Za den</th><th class="num">Budov</th></tr></thead><tbody>${
    PROD_CATS.filter(([k]) => o.tot[k]).map(([k, l]) => `<tr data-prodcat="${k}" class="${k === prodCat ? 'sel' : ''}"><td>${l}</td><td class="num"><b>${r1(o.tot[k])}</b></td>
      <td class="num">${[...o.per[k].values()].reduce((a, x) => a + x.n, 0)}</td></tr>`).join('')}</tbody></table>`;
  const list = o.per[prodCat];
  if (list) {
    const lab = PROD_CATS.find(([k]) => k === prodCat)?.[1] || prodCat;
    h += `<h4>${esc(lab)} – podle budov</h4><table><thead><tr><th>Budova</th><th class="num">Počet</th><th class="num">1 budova</th><th class="num">Celkem</th></tr></thead><tbody>${
      [...list.entries()].sort((a, b) => b[1].v - a[1].v).map(([n, x]) => `<tr><td>${esc(n)}</td><td class="num">${x.n}</td><td class="num">${r1(x.v / x.n)}</td><td class="num">${r1(x.v)}</td></tr>`).join('')}</tbody></table>`;
    if (prodCat === 'frags' && Object.keys(o.frags).length) h += `<p class="muted">${Object.entries(o.frags).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(fragName(k))}: ${r1(v)}`).join(' · ')}</p>`;
  }
  if (Object.keys(o.other).length) h += `<h4>Ostatní odměny (průměr za den)</h4><p>${Object.entries(o.other).map(([k, v]) => `${esc(k)}: ${r1(v)}`).join(' · ')}</p>`;
  const bs = prodBoostSums();
  h += `<p><label><input type="checkbox" data-cfg="prodBoosted" ${cfg.prodBoosted !== false ? 'checked' : ''}> včetně bonusů k produkci</label>
    <span class="muted">(FP +${fmt(bs.forge_points_production || 0)} %, zboží +${fmt(bs.goods_production || 0)} %, mince +${fmt(bs.coin_production || 0)} %, zásoby +${fmt(bs.supply_production || 0)} %${bs.guild_goods_production ? `, pokladna +${fmt(bs.guild_goods_production)} %` : ''})</span></p>
    <p class="muted">Za 24 h s motivací (jako FoE Helper), náhodné odměny jako průměr. Bonusy sad a řetězů jsou v číslech u budov, které právě vyrábějí (podle hry).
    Velké budovy a budovy s volbou výroby podle toho, co právě vyrábějí.${o.noData ? ` Chybí metadata u ${o.noData} budov.` : ''}</p>`;
  return h;
}

// ---------- Rating efektivity budov (postup jako FoE Helper: hodnota na pole / očekávaná hodnota na pole) ----------
// Výchozí očekávané hodnoty na pole převzaty z FoE Helperu (AGPL). Klíč: druh produkce nebo bonusu.
const RATE_TYPES = [
  ['strategy_points', 'FP', 8, true], ['forge_points_production', 'Bonus produkce FP', 0.25, true],
  ['g_prev', 'Zboží – předchozí věk', 7, true], ['g_cur', 'Zboží – aktuální věk', 6, true], ['g_next', 'Zboží – další věk', 5, true],
  ['goods_production', 'Bonus produkce zboží', 0.25, true], ['guild', 'Cechovní pokladna', 10, true], ['units', 'Jednotky', 4, true],
  ['fsp', 'Fragmenty FSP (okamžité dokončení)', 0.8, true], ['frags', 'Fragmenty (všechny)', 0.8, false], ['money', 'Mince', 0, false], ['supplies', 'Zásoby', 0, false], ['medals', 'Medaile', 0, false],
  ['aa-all', 'Útok útočníka – všude', 8, true], ['ad-all', 'Obrana útočníka – všude', 8, true],
  ['da-all', 'Útok obránce – všude', 8, true], ['dd-all', 'Obrana obránce – všude', 8, true],
  ['aa-battleground', 'Útok útočníka – GBG', 10, true], ['ad-battleground', 'Obrana útočníka – GBG', 10, true],
  ['da-battleground', 'Útok obránce – GBG', 10, true], ['dd-battleground', 'Obrana obránce – GBG', 10, true],
  ['aa-guild_expedition', 'Útok útočníka – expedice', 11, true], ['ad-guild_expedition', 'Obrana útočníka – expedice', 11, true],
  ['da-guild_expedition', 'Útok obránce – expedice', 11, true], ['dd-guild_expedition', 'Obrana obránce – expedice', 11, true],
  ['guild_raids_action_points_collection', 'QI akce – sběr', 8, true], ['guild_raids_coins_start', 'QI mince – start', 5000, true],
  ['guild_raids_supplies_start', 'QI zásoby – start', 5000, true],
  ['aa-guild_raids', 'Útok útočníka – QI', 0, false], ['ad-guild_raids', 'Obrana útočníka – QI', 0, false],
];
const rateW = () => { const w = cfg.ratingW || {}; return RATE_TYPES.map(([k, l, d, on]) => ({ k, l, per: w[k]?.per ?? d, on: w[k]?.on ?? on })); };
const RATE_SKIP = ['street', 'off_grid', 'hub_part', 'hub_main', 'main_building', 'greatbuilding', 'military', 'friends_tavern', 'outpost_ship'];
let rateSel = { size: 0, q: '', asc: true, settings: false, inv: false };
// Hodnoty budovy podle druhů ratingu (produkce za den + bonusy).
function rateValues(e, bs) {
  const b = buildingDaily(e, S.player?.era, bs), v = { ...b.res };
  // Bonusy budovy: přesně ze seznamu serveru (včetně sad a řetězů), jinak z metadat.
  const srv = (S.boosts || []).filter((x) => x.entityId === e.id && x.origin !== 'ally');
  for (const x of srv.length ? srv : entityBoosts(e, S.player?.era)) {
    const parts = BOOST_PARTS[x.type];
    if (parts) for (const p of parts) { const k = `${p}-${x.targetedFeature || 'all'}`; v[k] = (v[k] || 0) + (x.value || 0); }
    else v[x.type] = (v[x.type] || 0) + (x.value || 0);
  }
  return { v, src: b.src || (S.entBoost.has(e.cityentity_id) ? 'meta' : '') };
}
// Režim „jako FoE Helper“: základní produkce bez městských bonusů k produkci a včetně Velkých budov.
const rateBs = () => (cfg.rateFH ? null : cfg.prodBoosted !== false ? prodBoostSums() : null);
const rateSkip = (type) => RATE_SKIP.includes(type) && !(cfg.rateFH && type === 'greatbuilding');
function ratedBuildings() {
  const W = rateW().filter((t) => t.on && t.per > 0);
  const groups = new Map();
  const bs = rateBs();
  for (const e of S.entities.values()) {
    if (rateSkip(e.type)) continue;
    const sz = S.ent.get(e.cityentity_id);
    if (!sz) continue;
    const m = S.entProd.get(e.cityentity_id) || S.entBoost.get(e.cityentity_id);
    const era = m ? entEra(e, m, S.player?.era) : '';
    const key = `${e.cityentity_id}|${era}`;
    const g = groups.get(key);
    if (g) { g.n++; continue; }
    const { v, src } = rateValues(e, bs);
    // pole: plocha + podíl cesty (polovina u budov širokých 1 pole), jako FoE Helper
    const road = sz.road ? (sz.w === 1 || sz.l === 1 ? 0.5 : 1) * sz.road : 0;
    const tiles = sz.w * sz.l + road;
    const parts = W.map((t) => [t, (v[t.k] || 0) / tiles / t.per]).filter(([, x]) => x > 0);
    groups.set(key, { id: e.cityentity_id, era, name: S.names.get(e.cityentity_id) || entName(e.cityentity_id), n: 1, w: sz.w, l: sz.l, road, tiles, v, src,
      score: parts.reduce((a, [, x]) => a + x, 0), parts: parts.sort((a, b) => b[1] - a[1]) });
  }
  const out = [...groups.values()];
  // stejná budova v různých věcích: do názvu přidat věk
  const cnt = {};
  for (const b of out) cnt[b.name] = (cnt[b.name] || 0) + 1;
  for (const b of out) if (cnt[b.name] > 1 && b.era) b.name += ` (${ERA[b.era] || b.era})`;
  return out;
}
// Ohodnocení jedné budovy (sz = rozměry z metadat).
function rateOne(e, sz, W, bs) {
  const { v, src } = rateValues(e, bs);
  const road = sz.road ? (sz.w === 1 || sz.l === 1 ? 0.5 : 1) * sz.road : 0;
  const tiles = sz.w * sz.l + road;
  const parts = W.map((t) => [t, (v[t.k] || 0) / tiles / t.per]).filter(([, x]) => x > 0);
  return { v, src, road, tiles, w: sz.w, l: sz.l, score: parts.reduce((a, [, x]) => a + x, 0), parts: parts.sort((a, b) => b[1] - a[1]) };
}
// Budovy v inventáři: hodnotí se ve vašem věku (víceérové budovy se postaví ve věku hráče).
function ratedInventory() {
  const W = rateW().filter((t) => t.on && t.per > 0), bs = rateBs();
  const out = [], seen = new Set();
  let noMeta = 0;
  for (const it of S.inv.values()) {
    const id = it.item?.__class__ === 'BuildingItemPayload' ? it.item.cityEntityId : null;
    if (!id || seen.has(id) || !(it.stock > 0)) continue;
    seen.add(id);
    const sz = S.ent.get(id);
    if (!sz || rateSkip(sz.type)) { if (!sz) noMeta++; continue; }
    const e = { cityentity_id: id, type: sz.type, level: ERAS.indexOf(S.player?.era), state: {} };
    out.push({ id, name: it.name || S.names.get(id) || id, n: it.stock, ...rateOne(e, sz, W, bs) });
  }
  return { list: out, noMeta };
}
// Návrhy výměny: horší budovy ve městě se stejným půdorysem (jedna, nebo dvě vedle sebe), přínos = rozdíl celkové hodnoty (skóre × pole).
function swapSuggestions(b, city) {
  const fits = (x, w, l) => (x.w === w && x.l === l) || (x.w === l && x.l === w);
  const val = (x) => x.score * x.tiles, mine = val(b), res = [];
  const pool = city.filter((x) => x.score < b.score);
  for (const x of pool) if (fits(x, b.w, b.l)) res.push({ parts: [x], gain: mine - val(x) });
  for (const [W, Lt] of [[b.w, b.l], [b.l, b.w]]) {
    for (let i = 0; i < pool.length; i++) for (let j = i; j < pool.length; j++) {
      const x = pool[i], y = pool[j];
      if (i === j && x.n < 2) continue;
      for (const [xw, xl] of [[x.w, x.l], [x.l, x.w]]) for (const [yw, yl] of [[y.w, y.l], [y.l, y.w]]) {
        if (xw === W && yw === W && xl + yl === Lt) res.push({ parts: [x, y], gain: mine - val(x) - val(y) });
      }
    }
  }
  const uniq = new Map();
  for (const r of res) { const k = r.parts.map((x) => x.name).sort().join('+'); if (!uniq.has(k) || uniq.get(k).gain < r.gain) uniq.set(k, r); }
  return [...uniq.values()].filter((r) => r.gain > 0).sort((a, c) => c.gain - a.gain).slice(0, 3);
}
function viewRating() {
  if (!S.entities.size) return '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
  const all = ratedBuildings();
  const sizes = [...new Set(all.map((b) => b.w * b.l))].sort((a, b) => a - b);
  const q = rateSel.q.trim().toLowerCase();
  const list = all.filter((b) => (!rateSel.size || b.w * b.l === rateSel.size) && (!q || b.name.toLowerCase().includes(q)))
    .sort((a, b) => (rateSel.asc ? a.score - b.score : b.score - a.score));
  const r2 = (x) => (Math.round(x * 100) / 100).toLocaleString(LOC());
  const goods = (v) => (v.g_prev || 0) + (v.g_cur || 0) + (v.g_next || 0);
  let h = `<div style="margin-bottom:4px"><button class="fbtn ${!rateSel.settings && !rateSel.inv ? 'on' : ''}" data-rate="list">Výsledky</button><button class="fbtn ${rateSel.inv ? 'on' : ''}" data-rate="inv">Z inventáře</button><button class="fbtn ${rateSel.settings ? 'on' : ''}" data-rate="settings">Nastavení hodnot</button>
    <label style="margin-left:8px" title="Základní produkce bez vašich bonusů k produkci FP a zboží a včetně Velkých budov – výsledky srovnatelné s FoE Helperem."><input type="checkbox" data-cfg="rateFH" ${cfg.rateFH ? 'checked' : ''}> jako FoE Helper</label></div>`;
  if (rateSel.settings) {
    return h + `<p class="muted">Kolik dané věci má budova vyrobit na jedno pole (včetně podílu cesty), aby za ni dostala 1 bod. Skóre = součet bodů.</p>
      <table><thead><tr><th>Započítat</th><th>Druh</th><th class="num">Na pole</th></tr></thead><tbody>${rateW().map((t) =>
        `<tr><td><input type="checkbox" data-ratew="${t.k}" data-f="on" ${t.on ? 'checked' : ''}></td><td>${esc(t.l)}</td>
         <td class="num"><input type="number" step="0.05" min="0" style="width:80px" data-ratew="${t.k}" data-f="per" value="${Number.isFinite(+t.per) ? +t.per : 0}"></td></tr>`).join('')}</tbody></table>
      <p><button data-act="ratereset">Obnovit výchozí hodnoty</button></p>`;
  }
  if (rateSel.inv) {
    if (!S.invLoaded) return h + '<p class="muted">Inventář ještě nebyl načten – otevřete ho ve hře.</p>';
    const { list: inv, noMeta } = ratedInventory();
    const city = all.filter((b) => !b.limited);
    const r2i = (x) => (Math.round(x * 100) / 100).toLocaleString(LOC());
    return h + `<p class="muted">Budovy z inventáře ohodnocené ve vašem věku a návrhy, které horší budovy ve městě by mohly nahradit (stejný půdorys, jedna budova nebo dvě vedle sebe; přínos = rozdíl skóre × počet polí).</p>
      <table><thead><tr><th>Budova v inventáři</th><th class="num">Polí</th><th class="num">Skóre</th><th>Místo čeho</th></tr></thead><tbody>${
      inv.sort((a, b) => b.score - a.score).map((b) => { const sw = swapSuggestions(b, city);
        return `<tr><td>${esc(b.name)}${b.n > 1 ? ` <span class="muted">×${b.n}</span>` : ''}${b.src ? '' : ' <span class="muted">(bez dat)</span>'}</td><td class="num">${b.w}×${b.l}${b.road ? `+${r2i(b.road)}` : ''}</td>
          <td class="num"><b>${r2i(b.score)}</b></td><td style="font-size:11px">${sw.length ? sw.map((r) => `${r.parts.map((x) => esc(x.name)).join(' + ')} <span class="up">+${r2i(r.gain)}</span>`).join('<br>') : '<span class="muted">–</span>'}</td></tr>`; }).join('')}</tbody></table>
      ${noMeta ? `<p class="muted">U ${noMeta} budov z inventáře hra ještě nenačetla popis (rozměry, produkci) – načte ho třeba při otevření inventáře nebo při stavbě.</p>` : ''}`;
  }
  h += `<div class="copyrow" style="margin-bottom:4px;flex-wrap:wrap;align-items:center">
      <input class="pname" data-input="rateQ" placeholder="Hledat budovu" value="${esc(rateSel.q)}">
      <span><button class="fbtn ${!rateSel.size ? 'on' : ''}" data-ratesize="0">vše</button>${sizes.map((z) => `<button class="fbtn ${rateSel.size === z ? 'on' : ''}" data-ratesize="${z}">${z}</button>`).join('')}</span>
      <button class="fbtn" data-rate="sort">${rateSel.asc ? 'nejhorší nahoře ▲' : 'nejlepší nahoře ▼'}</button></div>
    <table><thead><tr><th>Budova</th><th class="num">Polí</th><th class="num">Skóre</th><th class="num">FP/den</th><th class="num">Zboží/den</th><th>Skladba skóre</th></tr></thead><tbody>${
    list.map((b) => `<tr title="${esc(b.id)}"><td>${esc(b.name)}${b.n > 1 ? ` <span class="muted">×${b.n}</span>` : ''}${b.src ? '' : ' <span class="muted">(bez dat)</span>'}</td>
      <td class="num">${b.w}×${b.l}${b.road ? `+${r2(b.road)}` : ''}</td><td class="num"><b>${r2(b.score)}</b></td>
      <td class="num">${b.v.strategy_points ? fmt(Math.round(b.v.strategy_points)) : ''}</td><td class="num">${goods(b.v) ? fmt(Math.round(goods(b.v))) : ''}</td>
      <td class="muted" style="font-size:11px">${b.parts.slice(0, 3).map(([t, x]) => `${esc(t.l)} ${r2(x)}`).join(' · ')}</td></tr>`).join('')}</tbody></table>
    <p class="muted">Postup jako FoE Helper: hodnota na pole (plocha + podíl cesty) / očekávaná hodnota na pole, sečteno přes zapnuté druhy. Produkce za 24 h s motivací
      ${cfg.rateFH ? '<b>bez bonusů k produkci (jako FoE Helper), včetně Velkých budov</b>' : cfg.prodBoosted !== false ? 'a s vašimi bonusy k produkci FP a zboží (vypnete volbou „jako FoE Helper“)' : 'bez bonusů k produkci'}; bonusy armády přesně podle hry (včetně sad a řetězů). Stejné budovy stejného věku jsou v jednom řádku. Hodnoty si upravíte v „Nastavení hodnot“.</p>`;
  return h;
}

function viewProduction() {
  const sw = `<p>${[['cycle', 'Aktuální cyklus'], ['daily', 'Denní přehled']].map(([k, l]) => `<button class="fbtn ${prodView === k ? 'on' : ''}" data-prodview="${k}">${l}</button>`).join('')}</p>`;
  if (prodView === 'daily') return sw + (S.entities.size ? viewDaily() : '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>');
  return sw + viewCycle();
}
function viewCycle() {
  const ents = [...S.entities.values()];
  if (!ents.length) return '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
  const now = nowServer();
  const sure = {}, extra = {}, guild = {};
  const groups = new Map(); // čas dokončení (min) -> {count, fp}
  let ready = 0;
  for (const e of ents) {
    const st = e.state || {};
    if (/Finished/i.test(st.__class__ || '')) ready++;
    if (st.__class__ !== 'ProducingState') continue;
    const motivatedNow = st.socialInteractionId === 'motivate';
    let fp = 0;
    for (const p of entityProducts(e)) {
      if (!p.res) continue;
      const target = p.guild ? guild : (p.motivated && !motivatedNow ? extra : sure);
      for (const [k, v] of Object.entries(p.res)) target[k] = (target[k] || 0) + v;
      if (!p.guild && (!p.motivated || motivatedNow)) fp += p.res.strategy_points || 0;
    }
    const at = st.next_state_transition_at;
    if (at) {
      const key = Math.ceil(at / 60) * 60;
      const g = groups.get(key) || { count: 0, fp: 0 };
      g.count++; g.fp += fp; groups.set(key, g);
    }
  }
  const goodsSum = (o) => Object.entries(o).filter(([k]) => S.goodsEra.has(k)).reduce((a, [, v]) => a + v, 0);
  const line = (label, o) => `<tr><td>${label}</td>
    <td class="num">${fmt(o.strategy_points || 0)}</td><td class="num">${fmt(o.money || 0)}</td>
    <td class="num">${fmt(o.supplies || 0)}</td><td class="num">${fmt(o.medals || 0)}</td><td class="num">${fmt(goodsSum(o))}</td></tr>`;
  const times = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  return `<p>${ready ? `<span class="chip">k vybrání: ${ready}</span>` : ''}<span class="chip">vyrábí: ${[...groups.values()].reduce((a, g) => a + g.count, 0)}</span></p>
    <h4>Aktuální cyklus (většinou 24 h) – hlavní město</h4>
    <table><thead><tr><th></th><th>FP</th><th>Mince</th><th>Zásoby</th><th>Medaile</th><th>Zboží</th></tr></thead><tbody>
    ${line('Jisté', sure)}${line('+ po motivaci', extra)}</tbody></table>
    <p class="muted">Cechovní pokladna: ${fmt(goodsSum(guild) + Object.entries(guild).filter(([k]) => !S.goodsEra.has(k)).reduce((a, [, v]) => a + v, 0))} ks zboží/surovin.</p>
    <h4>Kdy bude hotovo</h4>
    <table><thead><tr><th>Čas</th><th>Za</th><th>Budov</th><th>FP</th></tr></thead><tbody>${
    times.slice(0, 20).map(([t, g]) => `<tr><td>${new Date((t - S.serverOffset) * 1000).toLocaleString(LOC(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${dur(t - now)}</td><td class="num">${g.count}</td><td class="num">${g.fp ? fmt(g.fp) : ''}</td></tr>`).join('')
  }</tbody></table>${viewLimited(now)}${viewOutpost(now)}`;
}

function viewLimited(now) {
  const lims = limitedList();
  if (!lims.length) return '';
  const row = (l) => `<tr><td>${esc(l.name)}${l.decayed ? `<br><span class="muted">→ ${esc(l.ascName)}</span>` : ''}</td>
    <td>${l.decayed ? '<span class="hi">vypršela</span>' : `${l.at > now ? 'za ' + durLong(l.at - now) : 'právě teď'}<br><span class="muted">${new Date((l.at - S.serverOffset) * 1000).toLocaleString(LOC(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`}</td>
    <td>${limSupply(l) ? (l.decayed && limCan(l) ? '✅ ' : '') + esc(limSupply(l)) : '<span class="muted">nic</span>'}</td></tr>`;
  return `<h4>Limitované budovy</h4>
    <table><thead><tr><th>Budova</th><th>Stav</th><th>Ve skladu na obnovu</th></tr></thead><tbody>${lims.map(row).join('')}</tbody></table>
    ${S.invLoaded ? '' : '<p class="muted">Inventář ještě nebyl načten.</p>'}`;
}
