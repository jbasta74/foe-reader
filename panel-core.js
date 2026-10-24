// FoE Reader – panel-core.js
// Stav, zpracování zpráv, vyjednávání, příhody, upozornění, oznámení Chromu, pomocné funkce.
// Soubory panel-*.js se načítají v pořadí z manifestu a sdílejí globální rozsah izolovaného světa content scriptu.
'use strict';
const SOURCE = 'foe-reader';
const RING_MAX = 400;

// ===================== Stav =====================
const S = {
  player: null,            // user_data
  entities: new Map(),     // id -> CityMapEntity
  names: new Map(),        // cityentity_id -> název
  gbInfo: new Map(),       // cityentity_id -> {name, max_level}
  resources: {},           // id -> množství
  goodsEra: new Map(),     // good_id -> era
  goodsName: new Map(),    // good_id -> název
  players: new Map(),      // player_id -> {name, ...}
  taverns: [],             // OtherTavernState[]
  log: new Map(),          // key -> {count, bytes, last, time}
  ring: [],                // posledních N zpráv (pro export)
  serverOffset: 0,         // serverTime - localTime (s)
  boosts: [],              // Boost[] z BoostService.getAllBoosts
  foreignGB: null,         // naposledy otevřená cizí VB (CityMapEntity)
  gbRanking: null,         // pořadí přispěvatelů otevřené VB
  otherGBs: null,          // {playerId, list} – přehled VB jiného hráče
  gbg: null,               // GuildBattlegroundService.getBattleground
  gbgLeaderboard: null,    // GuildBattlegroundService.getPlayerLeaderboard
  gbgState: null,          // GuildBattlegroundStateService.getState
};
S.alerts = [];            // [{t, kind, text, urgent}]
S.unread = 0;
S.attrition = null;       // GuildBattlegroundAttrition
S.timers = [];            // TimerService.getTimers
S.ent = new Map();        // metadata budov: id -> {w, l, road, type}
S.grids = {};             // gridId -> {unlocked, blocked} (odemčená plocha)
S.inv = new Map();        // celý inventář: id -> {name, stock, item}
S.ascKit = new Map();     // ID pozvednuté (limitované) budovy -> {id, name} sady, která ji vytvoří
S.myTavern = null;        // {unlocked, sitting}
S.entProd = new Map();    // metadata budov: id -> {Věk: [{time, products}]} (produkce podle věku)
S.entBoost = new Map();   // metadata budov: id -> {Věk: [BoostHint]} (bonusy podle věku, pro odhad cizích měst)
S.metaSeen = new Set();   // id budov, jejichž metadata už přišla
S.metaRev = 0;
S.visit = null;           // naposledy navštívené město {pid, data, t}
const myId = () => S.player?.player_id;

// ===================== Handlery =====================
// Klíč = "RequestClass.requestMethod". Odpovědi chodí v dávkách,
// proto se třídí podle odpovědi, ne podle toho, co klient poslal.
const H = {
  'StartupService.getData'(d) {
    S.player = d.user_data || S.player;
    if (S.player?.player_id && globalThis.FOE_STATS) FOE_STATS.init(location.hostname.split('.')[0], S.player.player_id, S.player.user_name);
    for (const e of d.city_map?.entities || []) S.entities.set(e.id, e);
    if (d.city_map?.unlocked_areas) S.grids.main = { unlocked: d.city_map.unlocked_areas, blocked: d.city_map.blocked_areas || [] };
    for (const g of d.goodsList || []) { S.goodsEra.set(g.id, g.era); S.goodsName.set(g.id, g.name); }
  },
  'TimeService.updateTime'(d) {
    if (d && d.time) S.serverOffset = d.time - Date.now() / 1000;
  },
  'NegotiationGameService.submitTurn'(d) { negoTurn(d); },
  // Koupený tah za diamanty (log 23. 10.: nabídka quest:turnAfterGameLost, 10 💎) – vyjednávání pokračuje.
  'ResourceShopService.buyOffer'(d) {
    const o = Array.isArray(d) ? d[0] : d;
    if (o?.gains?.resources?.negotiation_game_turn && S.nego?.state === 'out_of_turns') {
      S.nego.state = 'ongoing'; S.nego.bought = (S.nego.bought || 0) + (o.gains.resources.negotiation_game_turn || 1);
      S.nego.paid = (S.nego.paid || 0) + (o.costsOptions?.[0]?.resources?.premium || 0);
      negoCalc();
    }
  },
  // Zprávy: kategorie konverzace (social = soukromé, guild = cechovní) chodí těsně před samotnou zprávou.
  'ConversationService.getConversationUpdate'(d) { if (d?.conversationId != null && d.category) (S.convCat ||= new Map()).set(d.conversationId, d.category); },
  'ConversationService.getNewMessage'(d) { newMessage(d); },
  // Příhody ve městě: typ, druh místa, vzácnost, čas objevení/zmizení (i budoucí). Odměna až po vybrání.
  'HiddenRewardService.getOverview'(d) {
    if (Array.isArray(d?.hiddenRewards)) S.incidents = { list: d.hiddenRewards, time: Date.now() };
  },
  // Odměna z vybrané příhody: [[GenericReward…], 'living_city']
  'RewardService.collectReward'(d) {
    if (!Array.isArray(d) || d[1] !== 'living_city' || !Array.isArray(d[0])) return;
    const log = loadIncLog();
    log.push({ t: Date.now(), r: d[0].map((x) => ({ id: x.subType || x.id, name: x.name, n: x.amount || 1 })) });
    saveIncLog(log.slice(-300));
  },
  'ResourceService.getPlayerResourceBag'(d) {
    Object.assign(S.resources, d?.resources?.resources || {});
  },
  'ResourceService.getPlayerResources'(d) {
    Object.assign(S.resources, d?.resources || {});
  },
  'InventoryService.getGreatBuildings'(d) {
    for (const g of d || []) S.gbInfo.set(g.cityentity_id, { name: g.name, max_level: g.max_level });
  },
  'OtherPlayerService.getSocialList'(d) {
    for (const list of ['friends', 'guildMembers', 'neighbours']) {
      for (const p of d?.[list] || []) {
        const prev = S.players.get(p.player_id) || {};
        S.players.set(p.player_id, { ...prev, name: p.name, score: p.score, [list]: true });
      }
    }
  },
  'FriendsTavernService.getOtherTavernStates'(d) {
    if (Array.isArray(d)) S.taverns = d;
  },
  // FP v balíčcích: spočítáno z inventáře hned po načtení (balíčky 10 FP, 100 FP …).
  'InventoryService.getItems'(d) {
    if (!Array.isArray(d)) return;
    S.fpPacks = new Map();
    S.frags = new Map();
    S.inv = new Map();
    for (const it of d) { takeFpPack(it); takeFragment(it); takeInv(it); }
    sumFpPacks();
    S.invLoaded = true;
  },
  'InventoryService.getItem'(d) { if (d) { if (takeFpPack(d)) sumFpPacks(); takeFragment(d); takeInv(d); } },
  // Změna počtu kusů (např. po vložení FP do VB).
  'InventoryService.updateItem'(d) {
    const list = Array.isArray(d) ? d : [d];
    let hit = false;
    for (const u of list) {
      const pk = u && S.fpPacks?.get(u.id);
      if (pk && typeof u.amount === 'number') { pk.stock = u.amount; hit = true; }
      const fr = u && S.frags?.get(u.id);
      if (fr && typeof u.amount === 'number') fr.stock = u.amount;
      const iv = u && S.inv.get(u.id);
      if (iv && typeof u.amount === 'number') iv.stock = u.amount;
    }
    if (hit) sumFpPacks();
  },
  // Server posílá součet i sám (po otevření VB / vložení FP) – má přednost.
  'GreatBuildingsService.getAvailablePackageForgePoints'(d) {
    if (Array.isArray(d) && typeof d[0] === 'number') S.packageFP = d[0];
  },
  'BoostService.getAllBoosts'(d) {
    if (Array.isArray(d)) S.boosts = d;
  },
  // Návštěva cizího města: hráč + jeho mapa. Bonusy se odhadnou z metadat budov (hra je načítá postupně),
  // proto se snímek přepočítává ještě chvíli po návštěvě (viz statsTick).
  'OtherPlayerService.visitPlayer'(d) {
    const op = d?.other_player || d?.otherPlayer;
    const pid = op?.player_id;
    if (pid == null || pid === myId() || !Array.isArray(d?.city_map?.entities)) return;
    S.visit = { pid, data: d, t: Date.now(), rev: -1 };
    const prev = S.players.get(pid) || {};
    S.players.set(pid, { ...prev, name: op.name ?? prev.name });
  },
  // --- VB jiných hráčů (struktura podle FoE Helperu, ověřit na logu) ---
  'GreatBuildingsService.getConstruction'(d) {
    // Pořadí třídí genericScan (moje vs. cizí VB) – tady ho nepřepisovat.
    // Stupeň VB přímo z odměn (plánky mají tier); platí pro budovu z právě odeslaného dotazu.
    const ent = S.gbReq && S.entities.get(S.gbReq.entityId);
    const top = rankingTier(d?.rankings, ent?.level);
    if (top && S.gbReq && Date.now() - S.gbReq.time < 15000) {
      (S.gbTierSeen ||= new Map()).set(S.gbReq.entityId, { tier: top, level: ent?.level });
    }
  },
  'GreatBuildingsService.getConstructionRanking'(d) {
    // pořadí zpracuje genericScan podle __class__ (GreatBuildingRankingRow)
  },
  'GreatBuildingsService.getOtherPlayerOverview'(d) {
    if (Array.isArray(d)) S.otherGBs = { list: d, time: Date.now() };
  },
  // --- GBG (struktura podle FoE Helperu, ověřit na logu) ---
  'GuildBattlegroundService.getBattleground'(d) {
    // Hra mapu posílá při vstupu do GBG – okno GBG se může otevřít samo (jen při novém vstupu, ne při každém obnovení).
    if (cfg.gbgPopup && Date.now() - (S.gbgSeenAt || 0) > 180000) setTimeout(() => openTabWin('gbg'), 50);
    S.gbgSeenAt = Date.now();
    S.gbg = d;
    if (d?.currentPlayerParticipant?.attrition) S.attrition = d.currentPlayerParticipant.attrition;
  },
  // Průběžné změny provincií chodí přes WebSocket (chybějící id = provincie 0).
  'GuildBattlegroundService.getProvinces'(d) {
    const provs = S.gbg?.map?.provinces;
    if (!provs || !Array.isArray(d)) return;
    for (const p of d) {
      const id = p.id ?? 0;
      const i = provs.findIndex((x) => (x.id ?? 0) === id);
      const before = i >= 0 ? provs[i] : null;
      const after = before ? { ...before, ...p } : p;
      if (i >= 0) provs[i] = after; else provs.push(after);
      checkProvinceChange(before, after);
    }
  },
  // Žebříček členů: uložíme snímek a rozdíl proti minulému otevření (kdo byl mezitím aktivní).
  'GuildBattlegroundService.getPlayerLeaderboard'(d) {
    if (!Array.isArray(d)) return;
    const snap = { time: Date.now(), rows: new Map(d.map((r) => [r.player?.player_id ?? r.player?.name,
      { b: r.battlesWon || 0, n: r.negotiationsWon || 0, a: r.attrition || 0 }])) };
    // Dva snímky těsně po sobě (hra posílá žebříček vícekrát) nepočítat jako nové srovnání.
    if (S.gbgLbSnap && snap.time - S.gbgLbSnap.time > 20000) S.gbgLbPrev = S.gbgLbSnap;
    S.gbgLbSnap = snap;
    S.gbgLeaderboard = d;
    guildPut(d.map((r) => ({ pid: r.player?.player_id, name: r.player?.name, gbgB: r.battlesWon || 0, gbgN: r.negotiationsWon || 0, gbgA: r.attrition || 0, gbgS: S.gbg?.endsAt || null })));
  },
  // --- Přehled cechu: členové, expedice, kvantové invaze (ukládá se po dnech do statistik) ---
  'ClanService.getOwnClanData'(d) {
    if (!Array.isArray(d?.members)) return;
    S.clan = { id: d.id, name: d.name, members: d.members.map((m) => m.player_id), time: Date.now() };
    guildPut(d.members.map((m) => ({ pid: m.player_id, name: m.name, score: m.score ?? null, won: m.won_battles ?? null, era: m.era || null, active: m.is_active !== false })));
  },
  'GuildExpeditionService.getContributionList'(d) {
    if (!Array.isArray(d)) return;
    guildPut(d.map((r) => ({ pid: r.player?.player_id, name: r.player?.name, geP: r.expeditionPoints || 0, geE: r.solvedEncounters || 0, geT: r.currentTrial || 0, geW: S.geWeek || null })));
  },
  'GuildRaidsService.getState'(d) { if (d?.__class__) S.qiState = d; },
  'GuildRaidsService.getMemberActivityOverview'(d) {
    const rows = d?.rows || (Array.isArray(d) ? d : null);
    if (!rows) return;
    S.qiRows = { rows, time: Date.now() };
    guildPut(rows.map((r) => ({ pid: r.player?.player_id, name: r.player?.name, qiA: r.actionPoints || 0, qiP: r.progressContribution || 0 })));
  },
  'GuildExpeditionService.getOverview'(d) {
    if (d?.nextStateTime) S.geWeek = d.state === 'inactive' ? d.nextStateTime - 86400 : d.nextStateTime;
    S.ge = { ...(S.ge || {}), ov: d, prog: d?.progress || S.ge?.prog, time: Date.now() };
  },
  'GuildExpeditionService.getState'(d) { const x = Array.isArray(d) ? d[0] : d; if (x?.currentEntityId != null) S.ge = { ...(S.ge || {}), prog: x }; },
  'GuildExpeditionService.receiveContributionNotification'(d) { if (d?.upcomingReward) S.ge = { ...(S.ge || {}), contrib: d }; },
  'GuildExpeditionService.openChest'(d) {
    if (!d?.name) return;
    const log = loadGeLog(); log.push({ t: Date.now(), name: d.name, id: d.subType || d.id, n: d.amount || 1 });
    try { localStorage.setItem('foeReaderGeChests', JSON.stringify(log.slice(-200))); } catch { /* plné */ }
  },
  'GuildBattlegroundStateService.getState'(d) { S.gbgState = d; },
  // Časovače: u produkce osady / QI je `time` počet sekund do další hotové produkce,
  // u ostatních absolutní čas. Relativní převedeme na absolutní serverový čas.
  // Mapa jiné "mřížky" než hlavního města – osada (cultural_outpost) apod. Přijde po otevření osady.
  'CityMapService.getCityMap'(d) {
    if (!d || !Array.isArray(d.entities)) return;
    S.mapRev = (S.mapRev || 0) + 1;
    if (d.unlocked_areas) S.grids[d.gridId] = { unlocked: d.unlocked_areas, blocked: d.blocked_areas || [] };
    if (d.gridId === 'main') { for (const e of d.entities) S.entities.set(e.id, e); return; }
    S.outpost = { gridId: d.gridId, entities: new Map(d.entities.map((e) => [e.id, e])), time: Date.now() };
  },
  'OutpostService.getAll'(d) { if (Array.isArray(d)) S.outposts = d; },
  'AdvancementService.getAll'(d) { if (Array.isArray(d)) S.advancements = d; },
  'ResourceService.getResourceDefinitions'(d) {
    if (!Array.isArray(d)) return;
    S.resName ||= new Map();
    for (const r of d) if (r?.id) S.resName.set(r.id, r.name || r.id);
  },
  // Události od ostatních hráčů – živě přes WebSocket (newEvent) i zpětně z historie událostí.
  'OtherPlayerService.newEvent'(d) { for (const e of Array.isArray(d) ? d : [d]) playerEvent(e, true); },
  'OtherPlayerService.getEventsPaginated'(d) {
    const evs = Array.isArray(d) ? d : d?.events;
    if (Array.isArray(evs)) for (const e of evs.slice().reverse()) playerEvent(e, false);
  },
  'TimerService.getTimers'(d) {
    if (!Array.isArray(d)) return;
    const now = nowServer();
    S.timers = d.map((t) => ({ ...t, at: t.time < 1e9 ? now + t.time : t.time }));
  },
  // Průběžný počet obsazených židlí: [majitel, židlí, obsazeno] (chodí přes WebSocket).
  'FriendsTavernService.getSittingPlayersCount'(d) {
    if (!Array.isArray(d) || d.length < 3) return;
    const [owner, unlocked, sitting] = d;
    if (owner === myId()) {
      const wasFull = S.myTavern && S.myTavern.sitting >= S.myTavern.unlocked;
      S.myTavern = { unlocked, sitting };
      if (!wasFull && sitting >= unlocked && cfg.tavOwnFull) alert('tav', 'Vaše hospoda je plná – můžete vybrat stříbro.');
      return;
    }
    const t = S.taverns.find((x) => x.ownerId === owner);
    if (!t) return;
    const wasFull = t.state === 'noChair';
    t.unlockedChairCount = unlocked; t.sittingPlayerCount = sitting;
    if (wasFull && sitting < unlocked) {
      delete t.state;
      if (cfg.tavFree) alert('tav', `Uvolnila se židle u ${playerName(owner)} (${sitting}/${unlocked}).`);
    } else if (!t.state && sitting >= unlocked) {
      t.state = 'noChair';
    }
  },
};

function takeFpPack(it) {
  const gain = it?.item?.__class__ === 'ForgePointPackagePayload' ? it.item.resource_package?.gain : null;
  if (!gain) return false;
  (S.fpPacks ||= new Map()).set(it.id, { gain, stock: it.inStock || 0 });
  return true;
}
// Části (fragmenty): kolik mám, kolik je potřeba na sestavení a co z nich vznikne.
function takeFragment(it) {
  const rw = it?.item?.__class__ === 'FragmentItemPayload' ? it.item.reward : null;
  if (!rw?.requiredAmount) return false;
  (S.frags ||= new Map()).set(it.id, {
    name: rw.assembledReward?.name || String(it.name || '').replace(/^Fragments? of /, ''),
    kind: rw.assembledReward?.type || '', stock: it.inStock || 0, need: rw.requiredAmount,
    rid: rw.assembledReward?.id || String(rw.id || '').replace(/^fragment#/, ''),
  });
  return true;
}
function takeInv(it) {
  if (it?.id != null && it.item) S.inv.set(it.id, { name: it.name, stock: it.inStock || 0, item: it.item });
}

// --- Limitované (pozvednuté) budovy ---
// Aktivní mají state.decaysAt, vypršelé decayedFromCityEntityId (= ID pozvednuté verze).
// Sadu na pozvednutí určujeme z metadat building_upgrades, jinak odhadem z ID budovy.
function ascKitFor(ascId) {
  const m = S.ascKit.get(ascId);
  if (m) return m;
  const fam = String(ascId).replace(/^[A-Z]_[A-Za-z]+_/, '').replace(/\d+(TEMP)?$/, '');
  return { id: 'upgrade_kit_ascended_' + fam, name: null };
}
function limitedList() {
  const out = [];
  for (const e of S.entities.values()) {
    const at = e.state?.decaysAt, from = e.decayedFromCityEntityId;
    if (!at && !from) continue;
    const ascId = from || e.cityentity_id;
    const kit = ascKitFor(ascId);
    let kits = 0, spare = 0, kitName = kit.name, frag = null;
    for (const v of S.inv.values()) {
      if (v.item.upgradeItemId === kit.id) { kits += v.stock; kitName ||= v.name; }
      else if (v.item.cityEntityId === ascId) spare += v.stock;
    }
    for (const f of (S.frags || new Map()).values()) if (f.rid === kit.id || f.rid === ascId) frag = f;
    out.push({ id: e.id, name: entName(e.cityentity_id), ascName: entName(ascId), at: at || null, decayed: !!from, kits, kitName, spare, frag });
  }
  return out.sort((a, b) => (a.decayed - b.decayed) || ((a.at || 0) - (b.at || 0)));
}
const limSupply = (l) => [
  l.kits ? `sada ${l.kits}×` : '', l.spare ? `budova ve skladu ${l.spare}×` : '',
  l.frag ? `fragmenty ${l.frag.stock}/${l.frag.need}` : '',
].filter(Boolean).join(', ');
const limCan = (l) => l.kits > 0 || l.spare > 0 || (l.frag && l.frag.stock >= l.frag.need);
function sumFpPacks() {
  let sum = 0;
  for (const pk of S.fpPacks.values()) sum += pk.gain * pk.stock;
  S.packageFP = sum;
}

// Budovy osad mají v ID název kultury (H_Aztecs_Townhall), budovy města věk nebo MultiAge/AllAge.
const OUTPOST_ID = /^[A-Z]_(Aztecs|Vikings|Japanese|Egyptians|Mughals|Polynesia|Pirates)_/;
function isOutpostEntity(x) {
  return !!S.outpost?.entities.has(x.id) || OUTPOST_ID.test(x.cityentity_id || '');
}

// Obecné zachycení: kdekoli přijde CityMapEntity (např. po sbírání produkce
// nebo vložení FP), aktualizuje se mapa města. Cizí budovy jdou zvlášť.
function genericScan(d) {
  let arr = null;
  if (Array.isArray(d)) arr = d;
  else if (d && Array.isArray(d.updatedEntities)) arr = d.updatedEntities;
  else if (d && d.__class__ === 'CityMapEntity') arr = [d];
  // Pořadí přispěvatelů VB a přehledy VB poznáme podle __class__, ať přijdou v jakékoli zprávě
  // (např. odpověď po vložení FP).
  const rows = Array.isArray(d) ? d : (d && Array.isArray(d.rankings) ? d.rankings : null);
  if (rows && rows.length) {
    const cls = rows[0]?.__class__;
    if (cls === 'GreatBuildingRankingRow') {
      // První řádek bez pořadí je majitel; budovu poznáme podle plánků v odměně.
      const ownerRow = rows.find((r) => r.rank == null && r.player?.player_id != null);
      let building = rows.map((r) => r.reward?.blueprintRewards?.[0]?.building_id).find(Boolean);
      const req = S.gbReq && Date.now() - S.gbReq.time < 15000 ? S.gbReq : null;
      // Řádek majitele server posílá jen tehdy, když má majitel něco vloženo. Bez něj:
      // 1) dotaz hry (entityId, playerId), 2) jinak – cizí VB vždy těsně předchází zpráva
      // s její budovou (getOtherPlayerCityMapEntity); když nepřišla a tu budovu mám, je moje.
      const foreignJustOpened = S.foreignGB && Date.now() - (S.foreignGBAt || 0) < 5000 && (!building || S.foreignGB.cityentity_id === building);
      const iHaveIt = !!building && [...S.entities.values()].some((e) => e.type === 'greatbuilding' && e.cityentity_id === building);
      const isOwn = ownerRow ? ownerRow.player.player_id === myId()
        : req ? req.playerId === myId()
        : iHaveIt && !foreignJustOpened;
      if (isOwn) {
        const ent = req && S.entities.get(req.entityId);
        if (ent?.type === 'greatbuilding') building = ent.cityentity_id;
        S.ownRanking = { rankings: rows, building, time: Date.now() };
        gbOpened('own');
        return;
      }
      S.gbRanking = { rankings: rows, building, ownerName: ownerRow?.player?.name, time: Date.now() };
      gbOpened('foreign');
      // Promítnout vlastní vklad a místo i do přehledu VB hráče.
      const me = rows.find((r) => r.player?.is_self || r.player?.player_id === myId());
      const row = S.foreignGB && S.otherGBs?.list?.find((g) => g.entity_id === S.foreignGB.id);
      if (me && row) { row.rank = me.rank; row.forge_points = me.forge_points; }
    }
    else if (cls === 'GreatBuildingContributionRow') S.otherGBs = { list: rows, time: Date.now() };
  }
  if (!arr) return;
  for (const x of arr) {
    if (!x || x.__class__ !== 'CityMapEntity' || x.id == null) continue;
    S.mapRev = (S.mapRev || 0) + 1;
    if (x.player_id != null && myId() != null && x.player_id !== myId()) {
      if (x.type === 'greatbuilding') {
        S.foreignGB = x; S.foreignGBAt = Date.now();
        const row = S.otherGBs?.list?.find((g) => g.entity_id === x.id);
        if (row && x.state?.invested_forge_points != null) {
          row.current_progress = x.state.invested_forge_points;
          row.max_progress = x.state.forge_points_for_level_up ?? row.max_progress;
          row.level = x.level ?? row.level;
        }
      }
    } else if (isOutpostEntity(x)) {
      S.outpost?.entities.set(x.id, x);
    } else {
      S.entities.set(x.id, x);
    }
  }
}

function handleMessage(channel, r) {
  if (!r || !r.requestClass) return;
  const key = `${r.requestClass}.${r.requestMethod}`;
  const d = r.responseData;
  let bytes = 0;
  try { bytes = JSON.stringify(d).length; } catch { /* ignore */ }

  const l = S.log.get(key) || { count: 0, bytes: 0, channel };
  l.count++; l.bytes = bytes; l.last = d; l.time = Date.now(); l.channel = channel;
  S.log.set(key, l);

  S.ring.push({ t: Date.now(), channel, key, data: d });
  if (S.ring.length > RING_MAX) S.ring.shift();

  try { if (d?.__class__ === 'NegotiationGame') negoStart(d); H[key] && H[key](d); genericScan(d); if (/Battleground/.test(key)) scanAttrition(d, 0); }
  catch (e) { console.warn('[FoE Reader] handler', key, e); }
}

// ===================== Vyjednávání =====================
// Jen radí – tah zadává hráč ve hře. V GBG je ve výchozím stavu vypnuté (stejně jako ve FoE Helperu),
// zapnout jde v nastavení (cfg.negoGbg) – GBG je soutěžní režim, riziko vůči pravidlům Inno nese hráč.
S.nego = null;
const NEGO_SLOTS = 5;
function negoStart(d) {
  const inGbg = d.context === 'guildBattleground';
  if (inGbg && !cfg.negoGbg) { S.nego = { gbg: true, t: Date.now() }; return; }
  const costs = d.possibleCosts?.resources || {};
  const goods = Object.keys(costs);
  S.nego = { context: d.context, inGbg, goods, costs, turns: [], state: 'ongoing', t: Date.now(), calc: null };
  negoCalc();
  if (cfg.negoPopup) setTimeout(() => openTabWin('neg'), 50);
  else if (open && tab !== 'neg' && tabVisible('neg')) tab = 'neg';
}
function negoTurn(d) {
  const n = S.nego;
  if (!n || n.gbg || !d?.turnResult?.slots) return;
  const solved = new Set();
  for (const t of n.turns) for (const [sl, st] of t.result) if (st === 'correct') solved.add(sl);
  const guess = new Map(), result = new Map();
  for (const x of d.turnResult.slots) {
    const sl = x.slotId || 0; // slot 0 server posílá bez slotId
    const gi = n.goods.indexOf(x.resourceId);
    if (gi < 0) continue;
    guess.set(sl, gi); result.set(sl, x.state);
  }
  n.turns.push({ open: [...Array(NEGO_SLOTS).keys()].filter((x) => !solved.has(x)), guess, result });
  n.state = d.state || 'ongoing';
  // Došly tahy: hra nabídne další tah za diamanty (cena až teď v d.offer) – návrh počítáme dál pro případ, že ho koupíte.
  if (n.state === 'out_of_turns') n.offer = d.offer?.costsOptions?.[0]?.resources?.premium ?? null;
  negoCalc();
}
function negoCalc() {
  const n = S.nego;
  if (!n || n.gbg || !['ongoing', 'out_of_turns'].includes(n.state) || !globalThis.FOE_NEGO) return;
  n.calc = null;
  setTimeout(() => { // výpočet mimo zpracování zprávy
    try {
      const left = n.state === 'out_of_turns' ? 1 : S.resources.negotiation_game_turn; // i v GBG (log 19. 10.: hra ho při zahájení nastaví na 3)
      n.calc = globalThis.FOE_NEGO.solve({ nGoods: n.goods.length, slots: NEGO_SLOTS, turns: n.turns, turnsLeft: left > 0 ? left : null });
    } catch (e) { console.warn('[FoE Reader] vyjednávání', e); n.calc = { error: String(e) }; }
    scheduleRender();
  }, 0);
}

// ===================== Příhody =====================
const INC_KEY = 'foeReaderIncidents';
const loadIncLog = () => { try { return JSON.parse(localStorage.getItem(INC_KEY) || '[]'); } catch { return []; } };
const saveIncLog = (l) => { try { localStorage.setItem(INC_KEY, JSON.stringify(l)); } catch { /* ignore */ } };
const INC_NAMES = {
  fallen_tree: 'spadlý strom', fisherman: 'rybář', castaway: 'trosečník', flotsam: 'vyplavené zboží', fruit_vendor: 'prodavač ovoce',
  kite: 'drak', treasure_chest: 'truhla s pokladem', sos: 'vzkaz v láhvi', crates: 'bedny', beehive: 'úl', broken_cart: 'rozbitý vůz',
  chest: 'truhla', clothesline: 'šňůra s prádlem', wine_cask: 'sud vína', dinosaur_bones: 'kosti dinosaura', stick_hut: 'chýše z větví',
  rubble: 'sutiny', pothole: 'výmol', broken_carriage: 'rozbitý kočár', statue: 'socha', whirlpool: 'vír', shipwreck: 'vrak lodi',
};
const INC_PLACES = { cityRoadSmall: 'cesta', cityRoadBig: 'dvouproudá cesta', nature: 'příroda', shore: 'pobřeží', water: 'voda' };
// Obrázky příhod (převzaté z FoE Helperu, AGPL-3.0) jsou součástí rozšíření: img/incidents/<typ>.png
const INC_IMGS = new Set(["Shard_01", "Shard_02", "Shard_03", "ages_birthday_gift_1", "ages_birthday_gift_2", "ages_birthday_gift_3", "ge_relic_common", "ge_relic_rare", "ge_relic_uncommon", "incident_beach_gear", "incident_beehive", "incident_blocked_road_1x1", "incident_blocked_road_2x2", "incident_broken_cart", "incident_car_accident", "incident_castaway", "incident_chest", "incident_clothesline", "incident_crates", "incident_dinosaur_bones", "incident_empty_clothesline", "incident_fallen_tree_1x1", "incident_fallen_tree_2x2", "incident_fisherman", "incident_floating_chest", "incident_flotsam", "incident_fruit_vendor", "incident_hero", "incident_kite", "incident_mammoth_bones", "incident_musician", "incident_overgrowth", "incident_pothole_1x1", "incident_pothole_2x2", "incident_quicksand", "incident_rhino", "incident_sculptor", "incident_shipwreck", "incident_sos", "incident_statue", "incident_stick_hut", "incident_treasure_chest", "incident_wine_cask", "spring_cherry_tree"]);
function incImg(type, h = 44) {
  const t = /outpost/.test(type) ? 'Shard_' + String(type).slice(-2) : type;
  if (!INC_IMGS.has(t) || !globalThis.chrome?.runtime?.getURL) return '';
  return `<img src="${chrome.runtime.getURL('img/incidents/' + t + '.png')}" alt="" style="max-height:${h}px;max-width:${h * 1.6}px;vertical-align:middle">`;
}
const incName = (type) => {
  const k = String(type).replace(/^incident_/, '').replace(/_\d+x\d+$/, '');
  return INC_NAMES[k] || k.replace(/_/g, ' ');
};

// Událost od jiného hráče. live = přišla právě teď; jinak jde o záznam z historie (jen doplnit do seznamu).
S.seenEvents = new Set();
function playerEvent(e, live) {
  if (!e || !e.type) return;
  if (e.id != null) { if (S.seenEvents.has(e.id)) return; S.seenEvents.add(e.id); }
  const who = e.other_player?.name || '?';
  const when = live ? '' : ` (${e.date || 'dříve'})`;
  if (e.type === 'trade_accepted' && cfg.tradeOn) {
    const o = e.offer || {}, n = e.need || {};
    const txt = o.good_id && n.good_id
      ? `Obchod: ${who} vzal vaši nabídku – dali jste ${fmt(o.value)}× ${resLabel(o.good_id)}, dostali jste ${fmt(n.value)}× ${resLabel(n.good_id)}${when}.`
      : `Obchod: ${who} vzal vaši nabídku${when}.`;
    alert('trade', txt, false, !(live && cfg.tradeSound));
  } else if (e.type === 'trade_offer_expired' && cfg.tradeExpired && live) {
    // Nabídky často vyprší hromadně – sloučit do jednoho řádku.
    expiredBuf.push(e);
    clearTimeout(expiredTimer);
    expiredTimer = setTimeout(flushExpired, 4000);
  } else if (e.type === 'great_building_contribution' && cfg.gbContribOn && live) {
    alert('gb', `VB ${e.great_building_name || ''} hráče ${who} dosáhla úr. ${e.level != null ? e.level : '?'}${e.rank ? ` – máte ${e.rank}. místo a odměnu za příspěvek` : ''}.`, false, true);
  }
}

let expiredBuf = [], expiredTimer = null;
function flushExpired() {
  const list = expiredBuf; expiredBuf = [];
  if (!list.length) return;
  const back = {};
  for (const e of list) if (e.offer?.good_id) back[e.offer.good_id] = (back[e.offer.good_id] || 0) + (e.offer.value || 0);
  const n = list.length;
  alert('trade', `${n === 1 ? 'Vypršela 1 nabídka' : n < 5 ? `Vypršely ${n} nabídky` : `Vypršelo ${n} nabídek`} na trhu – vrátilo se ${resList(back)}.`, false, true);
}

function scanAttrition(o, depth) {
  if (!o || typeof o !== 'object' || depth > 4) return;
  if (o.__class__ === 'GuildBattlegroundAttrition') { S.attrition = o; return; }
  for (const v of Array.isArray(o) ? o : Object.values(o)) if (v && typeof v === 'object') scanAttrition(v, depth + 1);
}

// Odchozí dotazy hry: zajímá nás jen, kterou VB hráč právě otevřel.
function handleRequest(r) {
  if (r?.requestClass) {
    S.ring.push({ t: Date.now(), channel: 'req', key: `${r.requestClass}.${r.requestMethod}`, data: r.requestData });
    if (S.ring.length > RING_MAX) S.ring.shift();
  }
  if (r?.requestClass === 'ConversationService' && ['markMessageRead', 'getConversation'].includes(r.requestMethod) && Array.isArray(r.requestData)) messageRead(r.requestData[0]);
  if (r?.requestClass === 'GreatBuildingsService' && r.requestMethod === 'getConstruction' && Array.isArray(r.requestData)) {
    S.gbReq = { entityId: r.requestData[0], playerId: r.requestData[1], time: Date.now() };
  }
}

function handleMetadata(m) {
  const d = m.data;
  // Názvy provincií GBG přímo ze hry (metadata guild_battleground_maps, načítají se při otevření GBG)
  if (/^guild_battleground_maps/.test(m.metadataId || '')) { S.gbgMapsMeta = d; parseGbgMaps(d); }
  S.metaRev++;
  const take = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.id && o.name) S.names.set(o.id, o.name);
    if (o.id && (o.components || o.abilities || o.width)) { S.metaSeen.add(o.id); const bm = boostMeta(o); if (bm) S.entBoost.set(o.id, bm); const pm = prodMeta(o); if (pm) S.entProd.set(o.id, pm); }
    // rozměry a potřeba cesty (starý formát width/length, nový components.AllAge)
    const sz = o.components?.AllAge?.placement?.size;
    if (o.id && (o.width || sz)) {
      S.ent.set(o.id, {
        w: +(o.width || sz?.x || 1), l: +(o.length || sz?.y || 1), type: o.type || '',
        road: +(o.components?.AllAge?.streetConnectionRequirement?.requiredLevel || o.requirements?.street_connection_level || 0),
      });
    }
    // great_building_tiers: stupně VB (měď/stříbro/zlato) podle úrovně
    if (o.__class__ === 'GreatBuildingTierMetadata' && o.tier?.value) {
      S.gbTiers = (S.gbTiers || []).filter((t) => t.tier !== o.tier.value).concat({ tier: o.tier.value, name: o.name, from: o.startLevel, to: o.endLevel });
    }
    // building_upgrades: sada, jejíž poslední krok je časově omezená budova
    const steps = o.upgradeSteps, kit = o.upgradeItem;
    if (kit?.id && Array.isArray(steps) && steps.length > 1 && /ascended/i.test(kit.id)) {
      for (const b of steps[steps.length - 1].buildingIds || []) S.ascKit.set(b, { id: kit.id, name: kit.name });
    }
  };
  if (Array.isArray(d)) d.forEach(take); else take(d);
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const p = ev.data;
  if (!p || p.source !== SOURCE) return;
  if (p.channel === 'req') { p.messages.forEach(handleRequest); return; }
  if (p.channel === 'assets') { for (const m of p.messages) if (m.goodsSprite) S.goodsSprite = m.goodsSprite; scheduleRender(); return; }
  if (p.channel === 'metadata') p.messages.forEach(handleMetadata);
  else for (const r of p.messages) handleMessage(p.channel, r);
  scheduleRender();
});

// ===================== Upozornění =====================
const CFG_KEY = 'foeReaderSettings', WATCH_KEY = 'foeReaderWatch';
const CFG_DEFAULT = {
  sound: true, gbgAttack: true, gbgWatch: true, gbgWatchLead: 1,
  tavFree: true, tavAgain: true, tavOwnFull: true, prodOn: true, prodMin: 20, prodOutpost: true,
  arcFactor: 'arc', // 'arc' = podle bonusu vlastní Archy (mění se samo), jinak pevné číslo
  tradeOn: true, tradeSound: false, tradeExpired: true, gbContribOn: true,
  limOn: true, limLead: 24, limInv: true,
  hiddenTabs: [], // záložky vypnuté v Nastavení (ℹ️)
  gbCalcPopup: true,
  gbgPopup: true,
  sysWatch: true, sysUrgent: false, sysMsg: false, sysProd: false, sysLim: false, sysTav: false, sysTrade: false, // systémová oznámení Chromu // okno GBG se otevře samo při vstupu do GBG
  uiBar: true, barVertical: false, // nástrojová lišta s ikonami (jinak jen tlačítko s panelem záložek)
  msgSocial: true, msgGuild: false, msgSound: true, // upozornění na nové zprávy
  negoGbg: false, // pomocník vyjednávání i v GBG (na vlastní riziko)
  lang: 'cs', // jazyk panelu: 'cs' | 'en'
  negoPopup: true, // okno Vyjednávání se otevře samo při zahájení vyjednávání // okno kalkulačky VB se otevře samo s otevřením budovy
};
const cfg = (() => {
  try { return { ...CFG_DEFAULT, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...CFG_DEFAULT }; }
})();
// 0.3.20: koeficient „Arc“ se nově ukládá jako 'arc' (sleduje bonus Archy). Starší uložená hodnota z tlačítka Arc (např. 1,99) se převede.
if (typeof cfg.arcFactor === 'number' && !cfg.arcMigrated && ![1.8, 1.85, 1.9, 1.92, 1.95, 2].includes(cfg.arcFactor)) cfg.arcFactor = 'arc';
cfg.arcMigrated = true;
// Jazyk panelu: texty jsou v kódu česky, při angličtině se hotové HTML přeloží (i18n.js).
const L = (h) => (cfg.lang === 'en' && globalThis.FOE_I18N?.tr ? globalThis.FOE_I18N.tr(h) : h);
const saveCfgLocal = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ } };
// Nastavení se navíc synchronizuje přes účet prohlížeče a do složky se statistikami (viz stats.js).
// Každá položka má čas poslední změny (cfg._kt), synchronizace pak slučuje po položkách:
// z jiného počítače se převezme jen to, co se tam změnilo později (dřív celé nastavení přepsalo i třeba koeficient Archy).
const cfgSnap = () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== '_t' && k !== '_kt'))));
let cfgLast = cfgSnap();
const saveCfg = () => {
  const now = Date.now(), kt = (cfg._kt ||= {});
  for (const k of Object.keys(cfg)) if (k !== '_t' && k !== '_kt' && JSON.stringify(cfg[k]) !== JSON.stringify(cfgLast[k])) kt[k] = now;
  cfg._t = now; cfgLast = cfgSnap();
  saveCfgLocal(); globalThis.FOE_STATS?.saveSettings(cfg);
};
globalThis.FOE_STATS?.initSettings(cfg, (nc) => {
  const kt = (cfg._kt ||= {});
  let changed = false;
  for (const [k, v] of Object.entries(nc || {})) {
    if (k === '_t' || k === '_kt') continue;
    const t = nc._kt?.[k] || 0;
    if (t > (kt[k] || 0)) { cfg[k] = v; kt[k] = t; changed = true; }
  }
  if (!changed) return;
  cfgLast = cfgSnap(); saveCfgLocal(); renderTabs(); scheduleRender();
});

// Sledované provincie – platí pro jednu bitvu (mapa + konec sezóny).
const watchKey = () => (S.gbg ? `${S.gbg.map?.id}|${S.gbg.endsAt}` : null);
function loadWatch() {
  try { const w = JSON.parse(localStorage.getItem(WATCH_KEY) || '{}'); return new Set(w.key === watchKey() ? w.ids : []); } catch { return new Set(); }
}
function saveWatch(set) { try { localStorage.setItem(WATCH_KEY, JSON.stringify({ key: watchKey(), ids: [...set] })); } catch { /* ignore */ } }

// Názvy provincií server neposílá – uživatel si je doplní sám (ukládá se pro každou mapu zvlášť).
const NAMES_KEY = 'foeReaderProvNames';
// Vestavěná tabulka (provinces.js): id -> [zkratka, název, sousedé]. Vlastní název ji přebije.
const provData = () => (globalThis.FOE_PROVINCES || {})[S.gbg?.map?.id || ''] || {};
function provNames() {
  const map = S.gbg?.map?.id || '';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(NAMES_KEY) || '{}')[map] || {}; } catch { /* ignore */ }
  // výchozí = celý název jako ve hře („B4: Bliclatan“); metadata hry mají přednost před tabulkou
  const built = Object.fromEntries(Object.entries(provData()).map(([id, v]) => [id, v[1]]));
  for (const [id, g] of Object.entries(S.gbgNames?.[map] || {})) if (g.name || g.short) built[id] = g.name || g.short;
  for (const [id, n] of Object.entries(saved)) if (n) built[id] = n;
  return built;
}
function setProvName(id, name) {
  const map = S.gbg?.map?.id || '';
  try {
    const all = JSON.parse(localStorage.getItem(NAMES_KEY) || '{}');
    (all[map] ||= {})[id] = name.trim();
    localStorage.setItem(NAMES_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
// Z metadat hry: pro každou mapu id provincie -> {short, name}. Tvar dat neznáme jistě, proto hledáme
// obecně: objekt mapy (id = název mapy) a v něm pole provincií s číselným id a textovým názvem.
S.gbgNames = {};
function parseGbgMaps(d) {
  const out = {};
  const walk = (o, mapId, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) {
      const provs = o.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && (x.name || x.title || x.provinceName));
      if (mapId && provs.length >= 20) {
        for (const [i, x] of o.entries()) {
          if (!x || typeof x !== 'object') continue;
          const id = Number.isInteger(x.id) ? x.id : Number.isInteger(x.provinceId) ? x.provinceId : (x.id == null && x.provinceId == null ? i : null);
          if (id == null) continue;
          (out[mapId] ||= {})[id] = { short: x.shortName || x.short_name || x.abbreviation || '', name: x.name || x.title || x.provinceName, conn: Array.isArray(x.connections) ? x.connections : null };
        }
        return;
      }
      for (const x of o) walk(x, mapId, depth + 1);
      return;
    }
    const mid = typeof o.id === 'string' && /archipelago|_map|island/i.test(o.id) ? o.id : mapId;
    for (const [k, v] of Object.entries(o)) walk(v, /archipelago/.test(k) ? k : mid, depth + 1);
  };
  try { walk(d, null, 0); } catch { /* ignore */ }
  if (Object.keys(out).length) S.gbgNames = out;
}
const gameProv = (id) => S.gbgNames?.[S.gbg?.map?.id || '']?.[id];
const provLabel = (id) => {
  const own = (() => { try { return JSON.parse(localStorage.getItem(NAMES_KEY) || '{}')[S.gbg?.map?.id || '']?.[id]; } catch { return null; } })();
  if (own) return own;
  // Jako ve hře: „B4: Bliclatan“ (zkratky typu B4B jsou jen konvence FoE Helperu, hra je nezná).
  const g = gameProv(id);
  if (g) return g.name || g.short;
  return provData()[id]?.[1] || provNames()[id] || `#${id}`;
};
const provFull = (id) => gameProv(id)?.name || provData()[id]?.[1] || '';

// Zvuk přes WebAudio – prohlížeč ho povolí až po prvním kliknutí na stránku/panel.
let audio = null;
function ensureAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* ignore */ }
}
window.addEventListener('pointerdown', ensureAudio, { capture: true });
function beep(urgent) {
  if (!cfg.sound || !audio) return;
  const tones = urgent ? [880, 660, 880, 660] : [660, 880];
  tones.forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const t0 = audio.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.17);
  });
}

// silent = jen zapsat do seznamu (bez zvuku a bez blikání tlačítka)
function alert(kind, text, urgent = false, silent = false) {
  S.alerts.unshift({ t: Date.now(), kind, text, urgent, silent });
  if (S.alerts.length > 60) S.alerts.pop();
  if (!alertsVisible()) { S.unread++; if (!silent) S.unreadLoud = (S.unreadLoud || 0) + 1; }
  if (!silent) beep(urgent);
  // Oznámení Chromu: naléhavé události GBG (útok, ztráta) a zprávy; sledované provincie řeší naplánovaný alarm.
  const watchMsg = kind === 'gbg' && /odemkne|odemčená/.test(text);
  const SYS = { msg: cfg.sysMsg, prod: cfg.sysProd, lim: cfg.sysLim, tav: cfg.sysTav, trade: cfg.sysTrade };
  if ((kind === 'gbg' && urgent && cfg.sysUrgent && !watchMsg) || SYS[kind]) sysSend({ type: 'notify', title: 'FoE Reader', message: text });
  updateBadge();
  scheduleRender();
}

// Upozornění se počítají jako přečtená, když je vidět záložka 🔔 – v panelu nebo v samostatném okně.
const alertsVisible = () => (open && tab === 'alerts') || tabWins.has('alerts');
function updateBadge() {
  if (!root) return;
  const btn = root.getElementById('toggle');
  btn.textContent = cfg.uiBar ? '⠿' : S.unread ? `⠿ FoE Reader 🔔${S.unread}` : '⠿ FoE Reader';
  renderIcons();
  btn.classList.toggle('alert', (S.unreadLoud || 0) > 0);
  const tb = root.querySelector('[data-tab="alerts"]');
  if (tb) tb.textContent = S.unread ? `🔔 ${S.unread}` : '🔔';
  clampHost();
}

// --- Nová zpráva (soukromá / cechovní). Když konverzaci máte ve hře otevřenou (hra ji hned označí jako přečtenou),
// upozornění se nezobrazí. ---
const msgPending = new Map(); // conversationId -> timeout
function newMessage(d) {
  const sender = d?.sender;
  if (!d || d.deleted || !sender || sender.player_id === myId()) return;
  const cat = S.convCat?.get(d.conversationId);
  const on = cat === 'guild' ? cfg.msgGuild : cat === 'social' ? cfg.msgSocial : false;
  if (!on) return;
  clearTimeout(msgPending.get(d.conversationId));
  msgPending.set(d.conversationId, setTimeout(() => {
    msgPending.delete(d.conversationId);
    const txt = String(d.text || (d.attachment ? '📎 příloha' : '')).replace(/\s+/g, ' ').slice(0, 90);
    alert('msg', `✉ ${cat === 'guild' ? 'Cech' : 'Zpráva'} – ${sender.name}: ${txt}`, false, !cfg.msgSound);
  }, 4000));
}
function messageRead(convId) { clearTimeout(msgPending.get(convId)); msgPending.delete(convId); }

// --- GBG: změna provincie (přes WebSocket) ---
function gbgMe() { return S.gbg?.currentParticipantId ?? S.gbg?.currentPlayerParticipantId; }
function clanName(id) { return S.gbg?.battlegroundParticipants?.find((p) => p.participantId === id)?.clan?.name || `#${id}`; }
// Historie přírůstků postupu: [{t, id, pid, d}] za posledních 15 minut.
S.gbgHist = [];
function recordProgress(before, after) {
  if (!before) return;
  const id = after.id ?? 0, t = Date.now();
  const prev = new Map((before.conquestProgress || []).map((c) => [c.participantId, c.progress || 0]));
  for (const c of after.conquestProgress || []) {
    const d = (c.progress || 0) - (prev.get(c.participantId) || 0);
    if (d > 0) S.gbgHist.push({ t, id, pid: c.participantId, d });
  }
  const cut = t - 15 * 60000;
  while (S.gbgHist.length && S.gbgHist[0].t < cut) S.gbgHist.shift();
}
// Přírůstek postupu cechu `pid` v provincii `id` za posledních `min` minut.
function gain(id, pid, min) {
  const cut = Date.now() - min * 60000;
  return S.gbgHist.reduce((a, h) => a + (h.id === id && h.pid === pid && h.t >= cut ? h.d : 0), 0);
}
const plus = (n) => (n ? `<span class="hi">+${fmt(n)}</span>` : '<span class="muted">0</span>');

function checkProvinceChange(before, after) {
  recordProgress(before, after);
  if (!before || !cfg.gbgAttack) return;
  const me = gbgMe(), id = after.id ?? 0;
  if (before.ownerId === me && after.ownerId !== me) { alert('gbg', `Ztratili jsme provincii ${provLabel(id)} (${clanName(after.ownerId)}).`, true); return; }
  if (before.ownerId !== me && after.ownerId === me) { alert('gbg', `Dobyli jsme provincii ${provLabel(id)}.`); return; }
  if (after.ownerId !== me) return;
  const prev = new Map((before.conquestProgress || []).map((c) => [c.participantId, c.progress]));
  for (const c of after.conquestProgress || []) {
    if (c.participantId === me || !(c.progress > 0)) continue;
    const was = prev.get(c.participantId) || 0;
    if (was === 0) alert('gbg', `Útok na naši provincii ${provLabel(id)}: ${clanName(c.participantId)} ${c.progress}/${c.maxProgress}.`, true);
    else if (was / c.maxProgress < 0.75 && c.progress / c.maxProgress >= 0.75)
      alert('gbg', `Provincie ${provLabel(id)} je skoro ztracená: ${clanName(c.participantId)} ${c.progress}/${c.maxProgress}.`, true);
  }
}

const GRID = { cultural_outpost: 'Osada', guild_raids: 'Kvantové invaze', era_outpost: 'Kolonie' };
// --- Kontroly podle času (sledované provincie, hospody, produkce) ---
let lastCheck = null;
const unlockAlerted = new Set();
const limAlerted = new Set();
// ---------- Systémová oznámení Chromu (background.js) ----------
// Bez spojení s rozšířením (test, nebo po aktualizaci rozšíření před F5) se tiše nic nestane.
function sysSend(msg) {
  if (msg.title) msg.title = L(msg.title);
  if (msg.message) msg.message = L(msg.message);
  try { const r = chrome.runtime?.sendMessage?.(msg); if (r?.catch) r.catch(() => {}); } catch { /* kontext rozšíření zneplatněn */ }
}
// Sledované provincie: alarm naplánuje background.js přes chrome.alarms – zazvoní přesně, i když prohlížeč kartu hry na pozadí přiškrtí.
const sysScheduled = new Map(); // klíč -> čas (ms)
function syncWatchAlarms() {
  const want = new Map();
  if (cfg.sysWatch && cfg.gbgWatch && S.gbg) {
    const lead = Math.max(0, +cfg.gbgWatchLead || 0) * 60, now = nowServer(), watch = loadWatch();
    for (const p of S.gbg.map?.provinces || []) {
      const id = p.id ?? 0;
      if (!watch.has(id) || !p.lockedUntil || p.lockedUntil <= now) continue;
      want.set(`${S.gbg.map?.id}|${S.gbg.endsAt}|${id}`, { when: Math.round((p.lockedUntil - lead - S.serverOffset) * 1000), p, id, lead });
    }
  }
  for (const k of [...sysScheduled.keys()]) if (!want.has(k)) { sysSend({ type: 'unschedule', key: k }); sysScheduled.delete(k); }
  for (const [k, x] of want) {
    if (sysScheduled.get(k) === x.when) continue;
    sysScheduled.set(k, x.when);
    sysSend({ type: 'schedule', key: k, when: x.when, title: 'FoE Reader – GBG',
      message: `Provincie ${provLabel(x.id)} (${clanName(x.p.ownerId)}) se odemkne ${x.lead ? `za ${Math.round(x.lead / 60)} min` : 'právě teď'}.` });
  }
}

let limInvDone = false;
function timeChecks() {
  const now = nowServer();
  syncWatchAlarms();
  // Sledované provincie: upozornit X minut před odemknutím.
  if (cfg.gbgWatch && S.gbg) {
    // Hlásí se jednou za každé zamčení – i když je provincie označena až v posledních minutách.
    const lead = Math.max(0, +cfg.gbgWatchLead || 0) * 60;
    const watch = loadWatch();
    for (const p of S.gbg.map?.provinces || []) {
      const id = p.id ?? 0;
      if (!watch.has(id) || !p.lockedUntil) continue;
      const key = `${id}|${p.lockedUntil}`;
      if (unlockAlerted.has(key) || now < p.lockedUntil - lead || now > p.lockedUntil + 60) continue;
      unlockAlerted.add(key);
      const left = p.lockedUntil - now;
      alert('gbg', left > 0 ? `Provincie ${provLabel(id)} (${clanName(p.ownerId)}) se odemkne za ${dur(left)}.` : `Provincie ${provLabel(id)} (${clanName(p.ownerId)}) je odemčená.`, true);
    }
  }
  // Limitované budovy: jednou předem (i hned po načtení, je-li to už v okně) a souhrn, co lze pozvednout.
  if (S.entities.size && S.invLoaded) {
    const lims = limitedList();
    if (cfg.limOn) {
      const lead = Math.max(0, +cfg.limLead || 0) * 3600;
      for (const l of lims) {
        if (l.decayed || !l.at || now >= l.at || now < l.at - lead) continue;
        const key = `${l.id}|${l.at}`;
        if (limAlerted.has(key)) continue;
        limAlerted.add(key);
        const sup = limSupply(l);
        alert('lim', `${l.name} vyprší za ${durLong(l.at - now)}. ${sup ? 'Na obnovu máte: ' + sup + '.' : 'Na obnovu nemáte nic ve skladu.'}`);
      }
    }
    if (cfg.limInv && !limInvDone) {
      limInvDone = true;
      const can = lims.filter((l) => l.decayed && limCan(l));
      if (can.length) alert('lim', `Vypršelé budovy, které lze pozvednout (${can.length}): ${[...can.reduce((m, l) => m.set(l.name, (m.get(l.name) || 0) + 1), new Map())].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ')}.`, false, true);
    }
  }
  if (lastCheck == null) { lastCheck = now; return; } // po načtení nehlásit staré události
  const from = lastCheck; lastCheck = now;
  const passed = (t) => t != null && t > from && t <= now;

  // Hospody: znovu k návštěvě.
  if (cfg.tavAgain) {
    const again = S.taverns.filter((t) => t.state === 'alreadyVisited' && passed(t.nextVisitTime));
    if (again.length) {
      const names = again.slice(0, 5).map((t) => playerName(t.ownerId)).join(', ');
      alert('tav', `Znovu lze navštívit ${again.length} ${again.length === 1 ? 'hospodu' : again.length < 5 ? 'hospody' : 'hospod'}: ${names}${again.length > 5 ? '…' : ''}`);
    }
  }
  // Limitované budovy: právě vypršela.
  if (cfg.limOn) {
    for (const l of limitedList()) {
      if (l.decayed || !passed(l.at)) continue;
      const sup = limSupply(l);
      alert('lim', `${l.name} právě vypršela. ${sup ? 'Na obnovu máte: ' + sup + '.' : 'Na obnovu nemáte nic ve skladu.'}`, true);
    }
  }
  // Produkce: dokončení velké skupiny budov.
  if (cfg.prodOn) {
    const groups = new Map();
    for (const e of S.entities.values()) {
      const at = e.state?.__class__ === 'ProducingState' ? e.state.next_state_transition_at : null;
      if (!passed(at)) continue;
      const k = Math.ceil(at / 60);
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    for (const n of groups.values()) if (n >= (+cfg.prodMin || 1)) alert('prod', `Hotová produkce: ${n} budov k vybrání.`);
  }
  // Osada a Kvantové invaze: jen časovač další hotové produkce (budovy server při načtení neposílá).
  if (cfg.prodOutpost) {
    // Známe-li budovy osady (po jejím otevření), hlásíme přesně; jinak jen podle časovače.
    const known = S.outpost?.gridId;
    if (known) {
      const done = [...S.outpost.entities.values()].filter((e) => e.state?.__class__ === 'ProducingState' && passed(e.state.next_state_transition_at));
      if (done.length) alert('prod', `${GRID[known] || known}: hotovo ${done.length} ${done.length === 1 ? 'budova' : done.length < 5 ? 'budovy' : 'budov'} (${resList(sumProducts(done))}).`);
    }
    for (const t of S.timers) {
      if (t.type === 'outpostProduction' && t.gridId !== known && passed(t.at)) alert('prod', `${GRID[t.gridId] || t.gridId}: produkce je hotová.`);
    }
  }
}
setInterval(timeChecks, 5000);

// ===================== Pomocné =====================
// Bonusy VB: beta posílá pole entity.bonuses, ostré servery jeden objekt entity.bonus (např. Archa 93,6 %).
// Nová pravidla VB (beta od 10/2026: měď/zlato, zaokrouhlení na pětky) poznáme podle tvaru dat Archy:
// nový formát má pole bonuses, starý (ostré servery) jeden objekt bonus. Bez Archy rozhodne svět (zz = beta).
function gbNewRules() {
  for (const e of S.entities.values()) {
    if (e.cityentity_id !== 'X_FutureEra_Landmark1') continue;
    if (Array.isArray(e.bonuses) && e.bonuses.length) return true;
    if (e.bonus) return false;
  }
  return /^zz/.test(location.hostname);
}
const roundReward = (x) => (gbNewRules() ? round5(x) : Math.round(x));
const entBonuses = (e) => [...(e.bonuses || []), ...(e.bonus && typeof e.bonus === 'object' ? [e.bonus] : [])];
const nf = new Intl.NumberFormat('cs-CZ');
const fmt = (n) => (n == null ? '–' : nf.format(n));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nowServer = () => Date.now() / 1000 + S.serverOffset;
function dur(sec) {
  if (sec <= 0) return 'teď';
  if (sec < 60) return '< 1 min';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function durLong(sec) {
  if (sec < 86400) return dur(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return `${d} d ${h} h`;
}
const playerName = (id) => S.players.get(id)?.name || `#${id}`;
// Stupeň platný pro stavbu další úrovně (při překryvu rozsahů vyhrává vyšší).
const TIER_RANK = { copper: 1, silver: 2, gold: 3 };
const TIER_ICON = { copper: '🥉', silver: '🥈', gold: '🥇' };
// Stupeň úrovně podle plánků v odměnách. Zlaté plánky dostávají jen některá místa a jejich počet roste s úrovní
// (log 17. 10.: úr. 100 → zlatý plánek jen P1, úroveň měděná; log 19. 10.: úr. 101 → P1–P3, úroveň už zlatá; úr. 182 → všechna místa).
// Proto: zlatá = v odměnách je zlatý plánek a úroveň je nad 100; bez úrovně = zlatý plánek má i jiné místo než P1.
// Věkové VB (Saturn VI Gate …) zlaté plánky nemají, zůstávají měděné i nad úr. 100.
function rankingTier(rows, level) {
  const tiersOf = (r) => (r.reward?.blueprintRewards || []).map((bp) => bp.tier?.value).filter(Boolean);
  const all = (rows || []).flatMap(tiersOf);
  if (!all.length) return null;
  const goldRanks = (rows || []).filter((r) => r.rank && tiersOf(r).includes('gold')).map((r) => r.rank);
  if (!goldRanks.length) return 'copper';
  if (level != null) return level > 100 ? 'gold' : 'copper';
  return goldRanks.some((k) => k >= 2) ? 'gold' : 'copper';
}
function gbTier(level, entityId) {
  const seen = S.gbTierSeen?.get(entityId);
  if (seen && (seen.level == null || seen.level === level)) return `<span title="podle odměn">${TIER_ICON[seen.tier] || ''}</span>`;
  const l = level; // zlatá od úrovně 101 (budova na úrovni 100 se staví ještě za měděné odměny)
  const hit = (S.gbTiers || []).filter((t) => l >= t.from && l <= t.to).sort((a, b) => (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0))[0];
  return hit ? `<span title="${esc(hit.name)} (úr. ${hit.from}–${hit.to})">${TIER_ICON[hit.tier] || esc(hit.name)}</span>` : '';
}
const entName = (id) => S.gbInfo.get(id)?.name || S.names.get(id) || id;
