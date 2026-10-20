// FoE Reader – panel.js
// Běží v izolovaném světě content scriptu. Přijímá zprávy z inject.js,
// třídí je podle requestClass.requestMethod, drží stav a kreslí panel.
(() => {
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
    negoCalc();
  }
  function negoCalc() {
    const n = S.nego;
    if (!n || n.gbg || n.state !== 'ongoing' || !globalThis.FOE_NEGO) return;
    n.calc = null;
    setTimeout(() => { // výpočet mimo zpracování zprávy
      try {
        const left = S.resources.negotiation_game_turn; // i v GBG (log 19. 10.: hra ho při zahájení nastaví na 3)
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
      if (o.id && (o.components || o.abilities || o.width)) { S.metaSeen.add(o.id); const bm = boostMeta(o); if (bm) S.entBoost.set(o.id, bm); }
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
    msgSocial: true, msgGuild: false, msgSound: true, // upozornění na nové zprávy
    negoGbg: false, // pomocník vyjednávání i v GBG (na vlastní riziko)
    negoPopup: true, // okno Vyjednávání se otevře samo při zahájení vyjednávání // okno kalkulačky VB se otevře samo s otevřením budovy
  };
  const cfg = (() => {
    try { return { ...CFG_DEFAULT, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...CFG_DEFAULT }; }
  })();
  // 0.3.20: koeficient „Arc“ se nově ukládá jako 'arc' (sleduje bonus Archy). Starší uložená hodnota z tlačítka Arc (např. 1,99) se převede.
  if (typeof cfg.arcFactor === 'number' && !cfg.arcMigrated && ![1.8, 1.85, 1.9, 1.92, 1.95, 2].includes(cfg.arcFactor)) cfg.arcFactor = 'arc';
  cfg.arcMigrated = true;
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
    if (!(open && tab === 'alerts')) { S.unread++; if (!silent) S.unreadLoud = (S.unreadLoud || 0) + 1; }
    if (!silent) beep(urgent);
    updateBadge();
    scheduleRender();
  }

  function updateBadge() {
    if (!root) return;
    const btn = root.getElementById('toggle');
    btn.textContent = S.unread ? `⠿ FoE Reader 🔔${S.unread}` : '⠿ FoE Reader';
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
  let limInvDone = false;
  function timeChecks() {
    const now = nowServer();
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
      : (S.outpost?.gridId === gridId ? [...S.outpost.entities.values()] : []);
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
    r.innerHTML = `<style>${css}
      :host{all:initial}
      .whead{display:flex;align-items:center;gap:8px;background:#2b2116;color:#f3d9a4;padding:5px 8px;cursor:move;user-select:none}
      .whead b{flex:1}
      .whead label{font-size:11px;cursor:pointer}
      .whead button{background:#4a3a26;color:#f3d9a4;border:1px solid #8a6a3a;border-radius:4px;padding:0 7px;cursor:pointer}
      .wbody{overflow:auto;padding:8px 10px;height:calc(100% - 30px)}
    </style><div class="whead" id="whead"><b>Kalkulačka VB</b>
      <label title="Otevřít samo s otevřením Velké budovy ve hře"><input type="checkbox" id="auto" ${cfg.gbCalcPopup ? 'checked' : ''}> otevírat samo</label>
      <button id="close" title="Zavřít">✕</button></div><div class="wbody" id="wbody"></div>`;
    document.documentElement.appendChild(h);
    toFront(h); h.addEventListener('pointerdown', () => toFront(h), true);
    calcWin = { host: h, root: r };
    const save = () => { const b = h.getBoundingClientRect(); try { localStorage.setItem(CALCWIN_KEY, JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height })); } catch { /* ignore */ } };
    r.getElementById('whead').addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button,input,label')) return;
      const sx = ev.clientX, sy = ev.clientY, b = h.getBoundingClientRect();
      const mv = (e) => { h.style.left = Math.max(0, b.left + e.clientX - sx) + 'px'; h.style.top = Math.max(0, b.top + e.clientY - sy) + 'px'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); save(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    r.getElementById('close').addEventListener('click', () => { save(); h.remove(); calcWin = null; });
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
    body.innerHTML = calcWinHtml();
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
    try { localStorage.setItem(MAPWIN_KEY, JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height, zoom: mapWin.zoom })); } catch { /* ignore */ }
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
      else if (b.dataset.z === 'close') { saveMapWin(); h.remove(); mapWin = null; }
    });
    new ResizeObserver(() => saveMapWin()).observe(h);
    renderMapWin(!localStorage.getItem(MAPWIN_KEY));
  }
  function renderMapWin(fit) {
    if (!mapWin) return;
    const r = mapWin.root;
    const M = Object.keys(S.grids).length ? mapModel(mapGrid) : null;
    r.getElementById('head').innerHTML = `<b>FoE Reader – mapa</b>${Object.keys(S.grids).length ? gridPicker().replace(/class="fbtn /g, 'class="') : ''}
      <span class="sp"></span><button data-z="out" title="Oddálit">−</button><button data-z="fit" title="Přizpůsobit oknu">⤢</button><button data-z="in" title="Přiblížit">+</button><button data-z="close" title="Zavřít">✕</button>`;
    const view = r.getElementById('view');
    if (!M) { r.getElementById('stats').innerHTML = ''; view.innerHTML = '<p style="color:#efe6d2;padding:10px">Pro tuto mapu zatím nejsou data.</p>'; return; }
    if (fit) {
      const W = M.maxX - M.minX + 1, Hh = M.maxY - M.minY + 1;
      mapWin.zoom = Math.max(3, Math.min(40, Math.floor(Math.min((view.clientWidth || 800) / W, (view.clientHeight || 500) / Hh))));
    }
    r.getElementById('stats').innerHTML = mapStats(M) + (M.missing ? `<span class="chip">${M.missing} budov bez rozměrů</span>` : '');
    const sl = view.scrollLeft, stp = view.scrollTop;
    view.innerHTML = mapSvg(M, mapWin.zoom);
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
    guild_raids_coins_start: 'QI mince – start', guild_raids_goods_start: 'QI zboží – start',
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
      return `<tr><td>${esc(FEATURE[f] || f)}</td>${['aa', 'ad', 'da', 'dd'].map((k) => `<td class="num">${fmt(v[k])} %${m[k] ? ` <span class="muted" title="násobitel z Velkých budov">×${(1 + m[k] / 100).toFixed(2).replace('.', ',')}</span>` : ''}</td>`).join('')}</tr>`;
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
    const op = S.outpost;
    const info = (S.outposts || []).find((o) => o.gridId === (op?.gridId || 'cultural_outpost') && o.startedAt && !o.finishedAt);
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

  function viewProduction() {
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
      times.slice(0, 20).map(([t, g]) => `<tr><td>${new Date((t - S.serverOffset) * 1000).toLocaleString('cs-CZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${dur(t - now)}</td><td class="num">${g.count}</td><td class="num">${g.fp ? fmt(g.fp) : ''}</td></tr>`).join('')
    }</tbody></table>${viewLimited(now)}${viewOutpost(now)}`;
  }

  function viewLimited(now) {
    const lims = limitedList();
    if (!lims.length) return '';
    const row = (l) => `<tr><td>${esc(l.name)}${l.decayed ? `<br><span class="muted">→ ${esc(l.ascName)}</span>` : ''}</td>
      <td>${l.decayed ? '<span class="hi">vypršela</span>' : `${l.at > now ? 'za ' + durLong(l.at - now) : 'právě teď'}<br><span class="muted">${new Date((l.at - S.serverOffset) * 1000).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>`}</td>
      <td>${limSupply(l) ? (l.decayed && limCan(l) ? '✅ ' : '') + esc(limSupply(l)) : '<span class="muted">nic</span>'}</td></tr>`;
    return `<h4>Limitované budovy</h4>
      <table><thead><tr><th>Budova</th><th>Stav</th><th>Ve skladu na obnovu</th></tr></thead><tbody>${lims.map(row).join('')}</tbody></table>
      ${S.invLoaded ? '' : '<p class="muted">Inventář ještě nebyl načten.</p>'}`;
  }

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
    const arcBtn = arcF ? `<button class="fbtn arc ${auto ? 'on' : ''}" data-factor="arc" title="${gold ? 'Zlatý' : 'Měděný'} bonus příspěvků vaší Archy ${fmt(arcBonus(gold))} % (${gold ? 'úrovně nad 100' : 'úrovně do 100'}) – mění se samo">Arc ${gold ? '🥇' : '🥉'} ${String(arcF).replace('.', ',')}</button>` : '';
    return arcBtn + FACTORS.map((f) => `<button class="fbtn ${!auto && +cfg.arcFactor === f ? 'on' : ''}" data-factor="${f}">${f.toFixed(2).replace(/0$/, '').replace('.', ',')}</button>`).join('')
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
      if (places.length) {
        html += `<table><thead><tr><th>Místo</th><th>Drží (bez vás)</th><th>Odměna FP</th><th>Zajistit za</th><th>Zisk</th></tr></thead><tbody>${
          places.map((p, i) => {
            const holder = others[i]?.forge_points || 0;
            const base = p.reward.strategy_point_amount || 0;
            const withArc = roundReward(base * (1 + arc / 100)); // stejně jako hra (prasátko)
            const cost = remaining != null ? Math.max(0, Math.ceil((remaining + holder - mine) / 2)) : null;
            const possible = cost != null && cost <= remaining;
            const profit = possible ? withArc - cost - mine : null; // celý vklad vč. již vloženého
            return `<tr class="${possible ? '' : 'muted'}"><td>${p.rank}.</td><td class="num">${fmt(holder)}</td>
              <td class="num">${fmt(base)} → <b>${fmt(withArc)}</b></td>
              <td class="num">${possible ? fmt(cost) : 'nelze'}</td>
              <td class="num ${profit > 0 ? 'hi' : ''}">${profit != null ? (profit > 0 ? '+' : '') + fmt(profit) : ''}</td></tr>`;
          }).join('')}</tbody></table>
          <p class="muted">„Zajistit za“ = kolik FP ještě vložit, aby vás na daném místě už nikdo nepředběhl. Zisk počítá s celým vaším vkladem.</p>`;
      } else if (rk) {
        html += '<p class="muted">Pořadí přišlo, ale bez odměn – pošlete mi log, upravím čtení.</p>';
      }
    } else {
      return null;
    }
    if (gb && rk) {
      const c = nahozCalc(rk, gb, S.players.get(gb.player_id)?.name || S.gbRanking.ownerName || '');
      if (c && c.text) html += `<div class="cfg"><div><b>Text do vlákna</b> · koeficient ${factorPicker(c.gold)}</div>
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
          attacking.map(({ p, c }) => `<tr><td>${esc(provLabel(p.id ?? 0))}</td><td>${esc(pname(p.ownerId))}</td><td class="num">${fmt(c.progress)} / ${fmt(c.maxProgress)}</td>
            <td class="num">${plus(gain(p.id ?? 0, me, 1))}</td><td class="num">${plus(gain(p.id ?? 0, me, 5))}</td></tr>`).join('')}</tbody></table>
          <p class="muted">Sloupce 1 a 5 min = o kolik postoupil celý cech (bitva +1, vyjednávání +2). Přibývá-li víc, než děláte sám, jede tam někdo s vámi. Počítá se od otevření mapy GBG.</p>`;
      }
      html += viewAttrition();
      html += viewProvinces(provs, me, pname, now);
      const defending = provs.filter((p) => p.ownerId === me && prog(p, (c) => c.participantId !== me).length);
      if (defending.length) {
        html += `<h4>Kde útočí na nás</h4><table><thead><tr><th>Provincie</th><th>Útočník</th><th>Postup</th><th>1 min</th><th>5 min</th></tr></thead><tbody>${
          defending.flatMap((p) => prog(p, (c) => c.participantId !== me).map((c) =>
            `<tr><td>${esc(provLabel(p.id ?? 0))}</td><td>${esc(pname(c.participantId))}</td><td class="num hi">${fmt(c.progress)} / ${fmt(c.maxProgress)}</td>
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
    const target = attrTarget ?? a.level + 20;
    const need = Math.max(0, target - a.level);
    const rows = [100, 60, 20].map((c) => `<tr><td>${c} %</td><td class="num">${fmt(Math.ceil(need / (c / 100)))}</td></tr>`).join('');
    return `<h4>Opotřebení</h4>
      <table><tbody>
        <tr><td>Úroveň</td><td class="num"><b>${fmt(a.level)}</b></td></tr>
        <tr><td>Bonus bránících armád</td><td class="num">${fmt(a.defendingArmyBonus)} %</td></tr>
        <tr><td>Násobitel vyjednávání</td><td class="num">${fmt(a.negotiationMultiplier)} %</td></tr>
        ${reset ? `<tr><td>Reset</td><td class="num">za ${dur(reset - nowServer())}</td></tr>` : ''}
      </tbody></table>
      <p>Kolik bitev do úrovně <input type="number" data-input="attrTarget" value="${target}" min="${a.level}" style="width:70px"> (průměrně, podle šance provincie):</p>
      <table><thead><tr><th>Šance na opotřebení</th><th>Bitev</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Šanci ukazuje sloupec „Opotř.“ v tabulce provincií. Jak roste bonus obránců s úrovní, server neposílá, proto ho nepočítám dopředu.</p>`;
  }

  // ---------- GBG: provincie a sledování ----------
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
        <td>${own || base ? '' : `<button class="star" data-watch="${id}" title="Sledovat">${watch.has(id) ? '★' : '☆'}</button>`}</td>
        <td title="${esc(provFull(id))} · #${id}"><input type="text" class="pname" data-prov="${id}" value="${esc(names[id] || '')}" placeholder="#${id}" maxlength="30"></td>
        <td>${own ? 'my' : esc(pname(p.ownerId))}</td>
        <td>${near ? '<span class="hi">s námi</span>' : ''}</td>
        <td class="num">${base ? 'základna' : left > 0 ? 'za ' + dur(left) : own ? '' : '<b>teď</b>'}</td>
        <td class="num">${p.gainAttritionChance != null ? p.gainAttritionChance + ' %' : '–'}</td>
        <td class="num">${fmt(p.victoryPoints)}</td></tr>`).join('')
    }</tbody></table>
      <p class="muted">„Sousedí s námi“ = hraničí s některou naší provincií, dá se na ni tedy útočit. Název lze přepsat (uloží se). Celý název a číslo se ukážou po najetí myší.</p>`;
  }

  // ---------- Upozornění ----------
  function viewAlerts() {
    const chk = (k, label) => `<label><input type="checkbox" data-cfg="${k}" ${cfg[k] ? 'checked' : ''}> ${label}</label>`;
    const num = (k, label, w = 50) => `<label>${label} <input type="number" data-cfg="${k}" value="${cfg[k]}" min="0" style="width:${w}px"></label>`;
    const ICON = { gbg: '⚔️', tav: '🍺', prod: '🏭', trade: '🤝', gb: '🏛️', lim: '⏳' };
    return `<div class="cfg">
        ${chk('sound', 'Zvuk')} <button data-act="testsound">Vyzkoušet zvuk</button>
        <div><b>GBG:</b> ${chk('gbgAttack', 'útok na naše provincie / ztráta')} ${chk('gbgWatch', 'sledované provincie')} ${num('gbgWatchLead', 'min předem')}</div>
        <div><b>Hospody:</b> ${chk('tavFree', 'uvolněná židle')} ${chk('tavAgain', 'znovu k návštěvě')} ${chk('tavOwnFull', 'moje hospoda plná')}</div>
        <div><b>Obchod:</b> ${chk('tradeOn', 'někdo vzal moji nabídku')} ${chk('tradeSound', 'se zvukem')} ${chk('tradeExpired', 'vypršené nabídky')}</div>
        <div><b>Moje VB:</b> ${chk('gbContribOn', 'někdo přispěl (tiše)')} ${chk('gbCalcPopup', 'otevřít kalkulačku VB v okně s otevřením budovy')}</div>
        <div><b>Vyjednávání:</b> ${chk('negoPopup', 'otevřít okno vyjednávání při zahájení')} ${chk('negoGbg', 'pomocník i v GBG')}</div>
        <div><b>Zprávy:</b> ${chk('msgSocial', 'soukromé')} ${chk('msgGuild', 'cechovní')} ${chk('msgSound', 'se zvukem')}</div>
        <div><b>Limitované budovy:</b> ${chk('limOn', 'vypršení')} ${num('limLead', 'hodin předem')} ${chk('limInv', 'po načtení: co lze pozvednout (tiše)')}</div>
        <div><b>Produkce:</b> ${chk('prodOn', 'město hotovo')} ${num('prodMin', 'od počtu budov')} ${chk('prodOutpost', 'osada a QI')}</div>
      </div>
      <h4>Poslední upozornění</h4>
      ${S.alerts.length ? `<table><tbody>${S.alerts.map((a) => `<tr><td class="muted" style="white-space:nowrap">${new Date(a.t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</td>
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
    const at = (t) => new Date((t - S.serverOffset) * 1000).toLocaleString('cs-CZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
        `<tr><td class="muted" style="white-space:nowrap">${new Date(x.t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${x.r.map((r) => esc(r.name)).join(', ')}</td></tr>`).join('')}</tbody></table></details>` : ''}
      <p class="muted">Obsah odměny server prozradí až po vybrání příhody. Deník se ukládá v prohlížeči.</p>`;
    return html;
  }

  function viewNego() {
    const n = S.nego;
    if (!n) return '<p class="muted">Začněte ve hře vyjednávání (expedice) – tady se ukáže návrh dalšího tahu.</p>';
    if (n.gbg) return '<p class="muted">Vyjednávání v GBG: pomocník je vypnutý – zapnete ho v záložce 🔔 → Vyjednávání.</p>';
    const name = (gi) => goodIcon(n.goods[gi]);
    const CLS = { correct: 'ok', wrong_person: 'wp', not_needed: 'nn' };
    const TXT = { correct: '✓', wrong_person: '↔', not_needed: '✗' };
    const left = S.resources.negotiation_game_turn;
    const head = `<tr><th></th>${[...Array(NEGO_SLOTS).keys()].map((i) => `<th>Postava ${i + 1}</th>`).join('')}</tr>`;
    const rows = n.turns.map((t, i) => `<tr><td>Tah ${i + 1}</td>${[...Array(NEGO_SLOTS).keys()].map((sl) => t.guess.has(sl)
      ? `<td class="ng ${CLS[t.result.get(sl)] || ''}">${TXT[t.result.get(sl)] || ''} ${name(t.guess.get(sl))}</td>` : '<td class="muted">–</td>').join('')}</tr>`).join('');
    let sug = '';
    const c = n.calc;
    if (n.state === 'won') sug = '<p class="hi">Vyjednávání vyhráno 🎉</p>';
    else if (n.state !== 'ongoing') sug = `<p class="muted">Konec vyjednávání (${esc(n.state)}).</p>`;
    else if (!c) sug = '<p class="muted">Počítám…</p>';
    else if (c.error) sug = `<p class="hi">Chyba výpočtu: ${esc(c.error)}</p>`;
    else if (!c.suggestion) sug = '<p class="hi">Žádná kombinace neodpovídá výsledkům – pošlete mi prosím log.</p>';
    let sugRow = '';
    if (c && c.suggestion && n.state === 'ongoing') sugRow = `<tr class="sel"><td><b>Návrh</b></td>${[...Array(NEGO_SLOTS).keys()].map((sl) => c.fixed.has(sl)
      ? `<td class="ng ok">✓ ${name(c.fixed.get(sl))}</td>` : `<td><b>${name(c.suggestion.get(sl))}</b></td>`).join('')}</tr>`;
    if (sugRow) sug = `<p class="muted">Možných kombinací: ${fmt(c.cands)}${c.sure ? ' – <b>jisté řešení</b>' : ''}${c.winP != null ? ` · šance na výhru se zbývajícími tahy: <b>${Math.round(c.winP * 100)} %</b>` : ''}.</p>`;
    const cost = n.goods.map((g) => `${goodIcon(g, 22)} ${fmt(n.costs[g])}${S.resources[g] != null ? ` <span class="muted">(máte ${fmt(S.resources[g])})</span>` : ''}`).join(' · ');
    // Tahy zdarma = zdroj negotiation_game_turn (3 + bonus z hospody); pak hra nabízí další tah za diamanty (cenu server předem neposílá).
    const turnsInfo = left == null ? '' : n.state === 'ongoing' && left === 0
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
    let h = `<p class="muted">Ukládání: ${store}${f.error ? ` · <span class="hi">${esc(f.error)}</span>` : ''}</p>${statMsg ? `<p class="hi">${esc(statMsg)}</p>` : ''}`;
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
          h += `<table><thead><tr><th>Den</th><th class="num">GBG útok / obr.</th><th class="num">Exp. útok / obr.</th><th class="num">Všude útok / obr.</th><th class="num">VB Σ</th></tr></thead><tbody>${
            days.slice().reverse().map((d, i, arr) => { const sn = sel.days[d], pv = sel.days[arr[i + 1]];
              return `<tr><td>${esc(shortDate(d))}</td><td class="num">${pair(sn.army?.gbg)}${diff(sn.army?.gbg?.[0], pv?.army?.gbg?.[0])}</td>
                <td class="num">${pair(sn.army?.ge)}</td><td class="num">${pair(sn.army?.all)}</td><td class="num">${fmt(gbLevels(sn))}${diff(gbLevels(sn), pv && gbLevels(pv))}</td></tr>`; }).join('')}</tbody></table>`;
        }
      }
    }
    // --- vlastní vývoj ---
    const days = Object.keys(D.own).sort();
    h += `<h4>Můj vývoj (${days.length} ${days.length === 1 ? 'den' : days.length < 5 ? 'dny' : 'dní'})</h4>`;
    if (days.length) {
      h += `<div style="margin-bottom:4px">${Object.entries(OWN_METRICS).map(([k, l]) => `<button class="fbtn ${k === statMetric ? 'on' : ''}" data-statmetric="${k}">${l}</button>`).join('')}</div>
        ${lineChart(days.map((d) => [d, metricVal(D.own[d], statMetric)]).filter((p) => p[1] != null))}
        <table><thead><tr><th>Den</th><th class="num">Všude útok / obr.</th><th class="num">GBG útok / obr.</th><th class="num">Exp. útok / obr.</th><th class="num">VB Σ</th><th class="num">Bonus FP</th></tr></thead><tbody>${
        days.slice().reverse().slice(0, 60).map((d, i, arr) => { const sn = D.own[d], pv = D.own[arr[i + 1]];
          return `<tr><td>${esc(shortDate(d))}</td><td class="num">${pair(sn.army?.all)}${diff(sn.army?.all?.[0], pv?.army?.all?.[0])}</td>
            <td class="num">${pair(sn.army?.gbg)}${diff(sn.army?.gbg?.[0], pv?.army?.gbg?.[0])}</td><td class="num">${pair(sn.army?.ge)}</td>
            <td class="num">${fmt(gbLevels(sn))}${diff(gbLevels(sn), pv && gbLevels(pv))}</td><td class="num">${fmt(sn.fp)}</td></tr>`; }).join('')}</tbody></table>`;
    } else h += '<p class="muted">První záznam se uloží chvíli po načtení hry.</p>';
    h += `<p style="margin-top:8px"><button data-act="stcsvown">CSV – můj vývoj</button> <button data-act="stcsvvis">CSV – navštívená města</button>
      <button data-act="stjson">Záloha (JSON)</button> <button data-act="stimport">Načíst zálohu…</button><input type="file" accept=".json,application/json" data-stimport style="display:none"></p>
      <p class="muted">CSV se otevře v Excelu (oddělovač středník). Záloha i načtení slučují data – nic se nepřepíše starším.</p>`;
    return h;
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
      <h4>Nastavení – zobrazené záložky</h4>
      <div class="cfg"><div>${TABS.filter(([id]) => !FIXED_TABS.includes(id) && (!BONUS_TABS.includes(id) || bonusOn())).map(([id, l]) =>
        `<label><input type="checkbox" data-tabtoggle="${id}" ${tabVisible(id) ? 'checked' : ''}> ${l}</label>`).join(' ')}</div>
        <div class="muted">VB, Upozornění a ℹ️ zůstávají vždy. Vypnutá záložka jen zmizí z lišty – data se sbírají dál a upozornění fungují.</div>
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

  const TABS = [
    ['gb', 'VB', viewGB], ['prod', 'Produkce', viewProduction],
    ['boost', 'Bonusy', viewBoosts], ['gbg', 'GBG', viewGBG], ['tav', 'Hospody', viewTaverns],
    ['inc', 'Příhody', viewIncidents], ['neg', 'Vyjednávání', viewNego], ['map', 'Mapa', viewMap], ['stat', 'Statistiky', viewStats], ['res', 'Suroviny', viewResources], ['stock', 'Sklad', viewStock], ['log', 'Log', viewLog], ['alerts', '🔔', viewAlerts], ['about', 'ℹ️', viewAbout],
  ];
  let tab = 'gb';
  let open = false;

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
      .turns{display:inline-block;font-size:15px;padding:4px 12px;margin:2px 0 4px;border-radius:6px;background:#d6efc7;color:#1f4d1f}.turns b{font-size:17px}
      .turns.last{background:#fbe3b4;color:#7a4a00}.turns.out{background:#b0410f;color:#fff;font-weight:700}
      .up{color:#2e7d32;font-weight:600}.down{color:#b0410f;font-weight:600}
      .copytext{flex:1;border:1px solid #c9b48c;border-radius:4px;padding:3px 6px;background:#fff;font-family:Consolas,monospace}
    </style>
    <button class="btn" id="toggle" title="FoE Reader ${VERSION} · klik = otevřít/zavřít, táhnout = přesunout">⠿ FoE Reader</button>
    <div class="panel" id="panel"><div class="tabs" id="tabs"></div><div class="body" id="body"></div></div>`;
    body = root.getElementById('body');
    renderTabs();
    setupDrag(root.getElementById('toggle'), () => {
      open = !open; root.getElementById('panel').classList.toggle('open', open); render();
      placing = true; placePanel(); setTimeout(() => { placing = false; }, 400);
    });
    window.addEventListener('resize', () => { clampHost(); placePanel(); });
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; render(); return; }
      if (ev.target.closest('[data-act="popout"]')) { openTabWin(tab); return; }
      onUiClick(ev);
    });
    root.addEventListener('input', () => { lastInputAt = Date.now(); });
    root.addEventListener('change', onUiChange);
    attach();
    // Hra si stránku po načtení přestavuje – když panel zmizí, vrátíme ho.
    setInterval(() => { if (!host.isConnected) attach(); }, 2000);
    restoreTabWins();
    watchPanelSize();
    console.log('[FoE Reader] panel připraven');
  }
  // Společné ovládání pro panel i samostatná okna záložek.
  function onUiClick(ev) {
    {
      const r = ev.target.closest('tr[data-key]');
      if (r) { selectedKey = r.dataset.key === selectedKey ? null : r.dataset.key; render(); return; }
      if (ev.target.closest('[data-act="download"]')) download();
      const sp = ev.target.closest('tr[data-statpid]');
      if (sp) { statSel = statSel === sp.dataset.statpid ? null : sp.dataset.statpid; render(); return; }
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
      if (ev.target.closest('[data-act="testsound"]')) { ensureAudio(); const was = cfg.sound; cfg.sound = true; beep(true); cfg.sound = was; }
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
      if (ev.target.closest('[data-act="resetsize"]')) {
        try { localStorage.removeItem(PSIZE_KEY); } catch { /* ignore */ }
        const panel = root.getElementById('panel'); panel.style.width = ''; panel.style.height = '';
        placing = true; placePanel(); setTimeout(() => { placing = false; }, 400);
      }
    }
  }
  function onUiChange(ev) {
    const el = ev.target.closest('[data-cfg]');
    if (el) { cfg[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : +el.value; saveCfg(); render(); }
    const pn = ev.target.closest('[data-prov]');
    if (pn) { setProvName(+pn.dataset.prov, pn.value); render(); }
    const bc = ev.target.closest('[data-input="bonusCode"]');
    if (bc) { bonusCode = bc.value; bonusUnlock(bonusCode).then((ok) => { if (ok) { bonusCode = ''; bonusMsg = ''; tab = 'stat'; render(); } }); }
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
    r.innerHTML = `<style>${root.querySelector('style')?.textContent || ''}
      :host{all:initial}
      .whead{display:flex;align-items:center;gap:8px;background:#2b2116;color:#f3d9a4;padding:5px 8px;cursor:move;user-select:none}
      .whead b{flex:1}
      .whead button{background:#4a3a26;color:#f3d9a4;border:1px solid #8a6a3a;border-radius:4px;padding:0 7px;cursor:pointer}
      .wbody{overflow:auto;padding:8px 10px;height:calc(100% - 30px)}
    </style><div class="whead"><b>${def[1]}</b><button data-w="close" title="Zavřít">✕</button></div><div class="wbody"></div>`;
    document.documentElement.appendChild(h);
    toFront(h);
    h.addEventListener('pointerdown', () => toFront(h), true);
    const w = { host: h, root: r, body: r.querySelector('.wbody') };
    tabWins.set(id, w);
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
      if (ev.target.closest('[data-w="close"]')) { save(true); h.remove(); tabWins.delete(id); return; }
      onUiClick(ev);
    });
    r.addEventListener('input', () => { lastInputAt = Date.now(); });
    r.addEventListener('change', onUiChange);
    new ResizeObserver(() => { if (tabWins.has(id)) save(); }).observe(h);
    if (!restore) save();
    renderTabWin(id);
  }
  function renderTabWin(id) {
    const w = tabWins.get(id);
    const def = TABS.find((t) => t[0] === id);
    if (!w || !def) return;
    const act = w.root.activeElement;
    if (act && act.tagName === 'INPUT' && !act.readOnly && act.type !== 'checkbox' && Date.now() - lastInputAt < 2500) return;
    const keep = w.body.scrollTop;
    w.body.innerHTML = def[2]();
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
    const el = root?.getElementById('tabs');
    if (!el) return;
    if (!tabVisible(tab)) tab = 'gb';
    el.innerHTML = TABS.filter(([id]) => tabVisible(id)).map(([id, l]) => `<button data-tab="${id}">${l}</button>`).join('')
      + '<button data-act="popout" title="Otevřít tuto záložku v samostatném okně">⧉</button>';
  }
  function render() {
    if (!root) return;
    for (const id of tabWins.keys()) renderTabWin(id);
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (open && tab === 'alerts' && S.unread) { S.unread = 0; S.unreadLoud = 0; updateBadge(); }
    if (!open) return;
    // Nepřekreslovat, když uživatel zrovna píše do pole v panelu.
    // Při psaní do pole chvíli počkat (jinak by se přepsalo pod rukama), pak překreslit a vrátit kurzor.
    const act = root.activeElement;
    const editing = act && act.tagName === 'INPUT' && !act.readOnly && body.contains(act);
    if (editing && Date.now() - lastInputAt < 2500) { setTimeout(scheduleRender, 2600); return; }
    const focusSel = editing ? (act.dataset.cfg ? `[data-cfg="${act.dataset.cfg}"]` : act.dataset.prov ? `[data-prov="${act.dataset.prov}"]` : act.dataset.input ? `[data-input="${act.dataset.input}"]` : null) : null;
    const keepScroll = body.scrollTop;
    body.innerHTML = TABS.find((t) => t[0] === tab)[2]();
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
})();
