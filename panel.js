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
  S.myTavern = null;        // {unlocked, sitting}
  const myId = () => S.player?.player_id;

  // ===================== Handlery =====================
  // Klíč = "RequestClass.requestMethod". Odpovědi chodí v dávkách,
  // proto se třídí podle odpovědi, ne podle toho, co klient poslal.
  const H = {
    'StartupService.getData'(d) {
      S.player = d.user_data || S.player;
      for (const e of d.city_map?.entities || []) S.entities.set(e.id, e);
      for (const g of d.goodsList || []) { S.goodsEra.set(g.id, g.era); S.goodsName.set(g.id, g.name); }
    },
    'TimeService.updateTime'(d) {
      if (d && d.time) S.serverOffset = d.time - Date.now() / 1000;
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
      for (const it of d) { takeFpPack(it); takeFragment(it); }
      sumFpPacks();
    },
    'InventoryService.getItem'(d) { if (d) { if (takeFpPack(d)) sumFpPacks(); takeFragment(d); } },
    // Změna počtu kusů (např. po vložení FP do VB).
    'InventoryService.updateItem'(d) {
      const list = Array.isArray(d) ? d : [d];
      let hit = false;
      for (const u of list) {
        const pk = u && S.fpPacks?.get(u.id);
        if (pk && typeof u.amount === 'number') { pk.stock = u.amount; hit = true; }
        const fr = u && S.frags?.get(u.id);
        if (fr && typeof u.amount === 'number') fr.stock = u.amount;
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
    // --- VB jiných hráčů (struktura podle FoE Helperu, ověřit na logu) ---
    'GreatBuildingsService.getConstruction'(d) {
      if (d?.rankings) S.gbRanking = { rankings: d.rankings, time: Date.now() };
    },
    'GreatBuildingsService.getConstructionRanking'(d) {
      const r = Array.isArray(d) ? d : d?.rankings;
      if (r) S.gbRanking = { rankings: r, time: Date.now() };
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
    });
    return true;
  }
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
          return;
        }
        S.gbRanking = { rankings: rows, building, ownerName: ownerRow?.player?.name, time: Date.now() };
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

    try { H[key] && H[key](d); genericScan(d); if (/Battleground/.test(key)) scanAttrition(d, 0); }
    catch (e) { console.warn('[FoE Reader] handler', key, e); }
  }

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
      alert('gb', `${who} přispěl do vaší VB ${e.great_building_name || ''}${e.level != null ? ` (úr. ${e.level})` : ''}${e.rank ? `, ${e.rank}. místo` : ''}.`, false, true);
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
    if (r?.requestClass === 'GreatBuildingsService' && r.requestMethod === 'getConstruction' && Array.isArray(r.requestData)) {
      S.gbReq = { entityId: r.requestData[0], playerId: r.requestData[1], time: Date.now() };
    }
  }

  function handleMetadata(m) {
    const d = m.data;
    const take = (o) => { if (o && typeof o === 'object' && o.id && o.name) S.names.set(o.id, o.name); };
    if (Array.isArray(d)) d.forEach(take); else take(d);
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const p = ev.data;
    if (!p || p.source !== SOURCE) return;
    if (p.channel === 'req') { p.messages.forEach(handleRequest); return; }
    if (p.channel === 'metadata') p.messages.forEach(handleMetadata);
    else for (const r of p.messages) handleMessage(p.channel, r);
    scheduleRender();
  });

  // ===================== Upozornění =====================
  const CFG_KEY = 'foeReaderSettings', WATCH_KEY = 'foeReaderWatch';
  const CFG_DEFAULT = {
    sound: true, gbgAttack: true, gbgWatch: true, gbgWatchLead: 1,
    tavFree: true, tavAgain: true, tavOwnFull: true, prodOn: true, prodMin: 20, prodOutpost: true,
    arcFactor: 1.9,
    tradeOn: true, tradeSound: false, tradeExpired: true, gbContribOn: true,
  };
  const cfg = (() => {
    try { return { ...CFG_DEFAULT, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...CFG_DEFAULT }; }
  })();
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ } };

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
    const built = Object.fromEntries(Object.entries(provData()).map(([id, v]) => [id, v[0]]));
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
  const provLabel = (id) => provNames()[id] || `#${id}`;
  const provFull = (id) => provData()[id]?.[1] || '';

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
  const playerName = (id) => S.players.get(id)?.name || `#${id}`;
  const entName = (id) => S.gbInfo.get(id)?.name || S.names.get(id) || id;

  // ===================== Pohledy =====================
  function viewGB() {
    const gbs = [...S.entities.values()].filter((e) => e.type === 'greatbuilding');
    if (!gbs.length) return '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
    let calc = '<p class="muted">Kalkulačka náhozů: otevřete ve hře svou Velkou budovu.</p>';
    if (S.ownRanking) {
      const ent = gbs.find((e) => e.cityentity_id === S.ownRanking.building);
      const c = nahozCalc(S.ownRanking.rankings, ent, S.player?.user_name || '');
      if (c) calc = viewNahoz(c, 'Náhozy: ' + entName(ent.cityentity_id))
        + (ent.max_level != null && ent.level >= ent.max_level ? '<p class="hi">Budova je na maximální odemčené úrovni – další úroveň je potřeba nejdřív odemknout plánky.</p>' : '')
        + '<h4>Všechny moje VB</h4>';
    }
    const rows = gbs.map((e) => {
      const max = e.max_level ?? S.gbInfo.get(e.cityentity_id)?.max_level;
      const inv = e.state?.invested_forge_points || 0;
      const need = e.state?.forge_points_for_level_up;
      const atMax = max != null && e.level >= max;
      const left = need != null ? need - inv : null;
      return { name: entName(e.cityentity_id), level: e.level, max, inv, need, left, atMax };
    }).sort((a, b) => (a.atMax - b.atMax) || ((a.left ?? 1e15) - (b.left ?? 1e15)));
    return `${calc}<table><thead><tr><th>Velká budova</th><th>Úr.</th><th>Vloženo / potřeba</th><th>Chybí FP</th></tr></thead><tbody>${
      rows.map((r) => `<tr class="${r.atMax ? 'muted' : ''}">
        <td>${esc(r.name)}</td><td>${r.level}${r.max ? ' / ' + r.max : ''}</td>
        <td class="num">${r.atMax ? 'max' : `${fmt(r.inv)} / ${fmt(r.need)}`}</td>
        <td class="num ${!r.atMax && r.left != null && r.left <= 100 ? 'hi' : ''}">${r.atMax ? '' : fmt(r.left)}</td></tr>`).join('')
    }</tbody></table>`;
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

  function viewBoosts() {
    if (!S.boosts.length) return '<p class="muted">Zatím žádná data – načtěte hru (F5).</p>';
    const per = {};   // feature -> {aa,ad,da,dd}
    const other = {}; // type|feature -> value
    for (const b of S.boosts) {
      const parts = BOOST_PARTS[b.type];
      if (parts) {
        const f = (per[b.targetedFeature] ||= { aa: 0, ad: 0, da: 0, dd: 0 });
        for (const p of parts) f[p] += b.value;
      } else {
        const k = `${b.type}|${b.targetedFeature}`;
        other[k] = (other[k] || 0) + b.value;
      }
    }
    // Přičíst pasivní bonusy vlastních Velkých budov.
    let gbSum = { aa: 0, ad: 0, da: 0, dd: 0 };
    for (const e of S.entities.values()) {
      if (e.type !== 'greatbuilding') continue;
      for (const bo of e.bonuses || []) {
        const parts = GB_BOOST_PARTS[bo.type];
        if (!parts || bo.bonusCategory?.value !== 'passiveBonus') continue;
        const feat = bo.targetedFeature || 'all';
        const f = (per[feat] ||= { aa: 0, ad: 0, da: 0, dd: 0 });
        for (const p of parts) { f[p] += bo.value; if (feat === 'all') gbSum[p] += bo.value; }
      }
    }
    const base = per.all || { aa: 0, ad: 0, da: 0, dd: 0 };
    const feats = ['all', ...Object.keys(per).filter((f) => f !== 'all')];
    const row = (f) => {
      // V Kvantových invazích platí jen bonusy určené pro QI, ne „Všude“.
      const v = f === 'all' ? base : Object.fromEntries(['aa', 'ad', 'da', 'dd'].map((k) =>
        [k, (f === 'guild_raids' ? 0 : base[k]) + (per[f]?.[k] || 0)]));
      return `<tr><td>${esc(FEATURE[f] || f)}</td>${['aa', 'ad', 'da', 'dd'].map((k) => `<td class="num">${fmt(v[k])} %</td>`).join('')}</tr>`;
    };
    const others = Object.entries(other).sort((a, b) => a[0].localeCompare(b[0]));
    return `<h4>Armáda (oblast = „Všude“ + bonus pro oblast; QI jen vlastní)</h4>
      <table><thead><tr><th>Oblast</th><th>Útok útočníka</th><th>Obrana útočníka</th><th>Útok obránce</th><th>Obrana obránce</th></tr></thead>
      <tbody>${feats.map(row).join('')}</tbody></table>
      <h4>Ostatní bonusy</h4>
      <table><tbody>${others.map(([k, v]) => { const [t, f] = k.split('|');
        return `<tr><td>${esc(BOOST_NAME[t] || t)}${f !== 'all' ? ` <span class="muted">(${esc(FEATURE[f] || f)})</span>` : ''}</td><td class="num">${fmt(v)}</td></tr>`; }).join('')}</tbody></table>
      <p class="muted">${S.boosts.length} bonusů ze seznamu + Velké budovy (útočník ${fmt(gbSum.aa)} / ${fmt(gbSum.ad)}, obránce ${fmt(gbSum.da)} / ${fmt(gbSum.dd)} „Všude“).</p>`;
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
    }</tbody></table>${viewOutpost(now)}`;
  }

  // ---------- Kalkulačka náhozů (P1–P5 × koeficient, text do vlákna) ----------
  function nahozCalc(rows, entity, ownerName) {
    if (!rows || !entity) return null;
    const f1000 = Math.round((+cfg.arcFactor || 1.9) * 1000); // celočíselně kvůli zaokrouhlení (285 × 1,9 = 541,5 → 542)
    const total = entity.state?.forge_points_for_level_up;
    const ownerRow = rows.find((r) => r.rank == null && r.player?.player_id != null);
    const ownerFp = ownerRow?.forge_points || 0;
    // Počet odměňovaných míst není pevný (zlatý stupeň VB má 7 míst) – bereme všechna, která server pošle.
    const places = rows.filter((r) => r.rank && r.reward).sort((a, b) => a.rank - b.rank).map((r) => {
      const base = r.reward.strategy_point_amount || 0;
      const val = Math.round((base * f1000) / 1000);
      const holder = r.player?.player_id != null ? { name: r.player.name, fp: r.forge_points || 0 } : null;
      return { rank: r.rank, base, val, holder, filled: !!holder && holder.fp >= val };
    });
    const sumP = places.reduce((a, x) => a + x.val, 0);
    const ownShare = total != null ? Math.max(0, total - sumP) : null;
    const free = places.filter((x) => !x.filled && x.val > 0);
    const text = `${ownerName} ${entName(entity.cityentity_id)} ${entity.level}→${entity.level + 1} ` + free.map((x) => `P${x.rank}(${x.val})`).join(' ');
    return { total, ownerFp, places, sumP, ownShare, ownLeft: ownShare != null ? Math.max(0, ownShare - ownerFp) : null, text: text.trim() };
  }

  // Volba koeficientu: rychlé předvolby + vlastní hodnota (pamatuje se).
  const FACTORS = [1.8, 1.85, 1.9, 1.92, 1.95, 2.0];
  function factorPicker() {
    return FACTORS.map((f) => `<button class="fbtn ${+cfg.arcFactor === f ? 'on' : ''}" data-factor="${f}">${f.toFixed(2).replace(/0$/, '').replace('.', ',')}</button>`).join('')
      + ` <input type="number" data-cfg="arcFactor" value="${cfg.arcFactor}" step="0.01" min="1" max="3" style="width:60px" title="Vlastní koeficient">`;
  }

  function viewNahoz(c, title) {
    if (!c) return '';
    return `<div class="cfg"><div><b>${esc(title)}</b> · koeficient ${factorPicker()}</div>
      <div class="copyrow"><input type="text" class="copytext" readonly value="${esc(c.text)}"><button data-act="copy" data-text="${esc(c.text)}">Kopírovat</button></div></div>
      <table><thead><tr><th>Místo</th><th>Odměna</th><th>Nához</th><th>Stav</th></tr></thead><tbody>${
        c.places.map((x) => `<tr class="${x.filled ? 'muted' : ''}"><td>P${x.rank}</td><td class="num">${fmt(x.base)}</td><td class="num"><b>${fmt(x.val)}</b></td>
          <td>${x.holder ? `${esc(x.holder.name)} ${fmt(x.holder.fp)}${x.filled ? ' ✓' : ' (málo)'}` : 'volné'}</td></tr>`).join('')}
        <tr><td colspan="2">Vlastní podíl (celkem ${fmt(c.total)} − náhozy ${fmt(c.sumP)})</td><td class="num"><b>${fmt(c.ownShare)}</b></td>
          <td>vloženo ${fmt(c.ownerFp)}, zbývá <b>${fmt(c.ownLeft)}</b></td></tr>
      </tbody></table>`;
  }

  // ---------- VB přátel (kalkulátor) ----------
  function arcBonus() {
    for (const e of S.entities.values()) {
      if (e.cityentity_id !== 'X_FutureEra_Landmark1') continue;
      const b = (e.bonuses || []).find((x) => x.type === 'contribution_boost');
      if (b) return b.value;
    }
    return 0;
  }

  function viewForeignGB() {
    let html = '';
    const gb = S.foreignGB;
    const rk = S.gbRanking?.rankings;
    if (gb || rk) {
      const arc = arcBonus();
      const owner = gb ? (S.players.get(gb.player_id)?.name || `#${gb.player_id}`) : '?';
      const inv = gb?.state?.invested_forge_points || 0;
      const need = gb?.state?.forge_points_for_level_up;
      const remaining = need != null ? need - inv : null;
      const others = (rk || []).filter((r) => r.player?.player_id !== myId() && r.player?.player_id !== gb?.player_id);
      const mine = (rk || []).find((r) => r.player?.player_id === myId())?.forge_points || 0;
      const places = (rk || []).filter((r) => r.reward && (r.reward.strategy_point_amount || r.reward.blueprints || r.reward.resources))
        .sort((a, b) => a.rank - b.rank);
      html += `<p><b>${esc(gb ? entName(gb.cityentity_id) : 'Otevřená VB')}</b> · ${esc(owner)}${gb ? ` · úr. ${gb.level}` : ''}<br>
        Chybí: <b>${remaining != null ? fmt(remaining) : '?'}</b> FP · bonus Archy ${fmt(arc)} % · váš vklad ${fmt(mine)}${S.packageFP != null ? ` · máte ${fmt((S.resources.strategy_points || 0) + S.packageFP)} FP` : ''}</p>`;
      if (places.length) {
        html += `<table><thead><tr><th>Místo</th><th>Drží (bez vás)</th><th>Odměna FP</th><th>Zajistit za</th><th>Zisk</th></tr></thead><tbody>${
          places.map((p, i) => {
            const holder = others[i]?.forge_points || 0;
            const base = p.reward.strategy_point_amount || 0;
            const withArc = Math.round(base * (1 + arc / 100));
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
      html += '<p class="muted">Otevřete ve hře Velkou budovu jiného hráče.</p>';
    }
    if (gb && rk) {
      const c = nahozCalc(rk, gb, S.players.get(gb.player_id)?.name || S.gbRanking.ownerName || '');
      if (c && c.text) html += `<div class="cfg"><div><b>Text do vlákna</b> · koeficient ${factorPicker()}</div>
        <div class="copyrow"><input type="text" class="copytext" readonly value="${esc(c.text)}"><button data-act="copy" data-text="${esc(c.text)}">Kopírovat</button></div></div>`;
    }
    if (S.otherGBs?.list?.length) {
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
    const isNeighbour = (id) => (data[id]?.[2] || []).some((n) => mine.has(n));
    const list = provs.map((p) => {
      const id = p.id ?? 0, own = p.ownerId === me;
      return { p, id, own, left: (p.lockedUntil || 0) - now, near: !own && isNeighbour(id) };
    }).sort((a, b) => (watch.has(b.id) - watch.has(a.id)) || (a.own - b.own) || (b.near - a.near)
      || (Math.max(0, a.left) - Math.max(0, b.left)) || (a.id - b.id));
    return `<h4>Provincie (★ = upozornit ${cfg.gbgWatchLead ? cfg.gbgWatchLead + ' min před' : 'při'} odemknutí)</h4>
      <table class="prov"><thead><tr><th></th><th>Název</th><th>Vlastník</th><th>Sousedí</th><th>Odemčeno</th><th>Opotř.</th><th>Body</th></tr></thead><tbody>${
      list.map(({ p, id, left, own, near }) => `<tr class="${watch.has(id) ? 'sel' : own ? 'muted' : ''}">
        <td>${own ? '' : `<button class="star" data-watch="${id}" title="Sledovat">${watch.has(id) ? '★' : '☆'}</button>`}</td>
        <td title="${esc(provFull(id))} · #${id}"><input type="text" class="pname" data-prov="${id}" value="${esc(names[id] || '')}" placeholder="#${id}" maxlength="12"></td>
        <td>${own ? 'my' : esc(pname(p.ownerId))}</td>
        <td>${near ? '<span class="hi">s námi</span>' : ''}</td>
        <td class="num">${left > 0 ? 'za ' + dur(left) : '<b>teď</b>'}</td>
        <td class="num">${p.gainAttritionChance != null ? p.gainAttritionChance + ' %' : '–'}</td>
        <td class="num">${fmt(p.victoryPoints)}</td></tr>`).join('')
    }</tbody></table>
      <p class="muted">„Sousedí s námi“ = hraničí s některou naší provincií, dá se na ni tedy útočit. Název lze přepsat (uloží se). Celý název a číslo se ukážou po najetí myší.</p>`;
  }

  // ---------- Upozornění ----------
  function viewAlerts() {
    const chk = (k, label) => `<label><input type="checkbox" data-cfg="${k}" ${cfg[k] ? 'checked' : ''}> ${label}</label>`;
    const num = (k, label, w = 50) => `<label>${label} <input type="number" data-cfg="${k}" value="${cfg[k]}" min="0" style="width:${w}px"></label>`;
    const ICON = { gbg: '⚔️', tav: '🍺', prod: '🏭', trade: '🤝', gb: '🏛️' };
    return `<div class="cfg">
        ${chk('sound', 'Zvuk')} <button data-act="testsound">Vyzkoušet zvuk</button>
        <div><b>GBG:</b> ${chk('gbgAttack', 'útok na naše provincie / ztráta')} ${chk('gbgWatch', 'sledované provincie')} ${num('gbgWatchLead', 'min předem')}</div>
        <div><b>Hospody:</b> ${chk('tavFree', 'uvolněná židle')} ${chk('tavAgain', 'znovu k návštěvě')} ${chk('tavOwnFull', 'moje hospoda plná')}</div>
        <div><b>Obchod:</b> ${chk('tradeOn', 'někdo vzal moji nabídku')} ${chk('tradeSound', 'se zvukem')} ${chk('tradeExpired', 'vypršené nabídky')}</div>
        <div><b>Moje VB:</b> ${chk('gbContribOn', 'někdo přispěl (tiše)')}</div>
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
    ['gb', 'Moje VB', viewGB], ['fgb', 'VB přátel', viewForeignGB], ['prod', 'Produkce', viewProduction],
    ['boost', 'Bonusy', viewBoosts], ['gbg', 'GBG', viewGBG], ['tav', 'Hospody', viewTaverns],
    ['res', 'Suroviny', viewResources], ['stock', 'Sklad', viewStock], ['log', 'Log', viewLog], ['alerts', '🔔', viewAlerts], ['about', 'ℹ️', viewAbout],
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
      .body{overflow:auto;padding:8px 10px}
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
      input.pname{width:70px}
      .copyrow{display:flex;gap:6px}
      a{color:#8a4b12}
      .good{display:inline-block;margin:0 10px 1px 0;white-space:nowrap}
      .good.low{text-decoration:underline;text-decoration-color:#b0410f}
      table.stock td{vertical-align:top}
      .fbtn{background:#fff;border:1px solid #c9b48c;border-radius:4px;padding:1px 6px;margin-right:3px;cursor:pointer}
      .fbtn.on{background:#2b2116;color:#f3d9a4;border-color:#2b2116;font-weight:700}
      .copytext{flex:1;border:1px solid #c9b48c;border-radius:4px;padding:3px 6px;background:#fff;font-family:Consolas,monospace}
    </style>
    <button class="btn" id="toggle" title="FoE Reader ${VERSION} · klik = otevřít/zavřít, táhnout = přesunout">⠿ FoE Reader</button>
    <div class="panel" id="panel"><div class="tabs">${TABS.map(([id, l]) => `<button data-tab="${id}">${l}</button>`).join('')}</div><div class="body" id="body"></div></div>`;
    body = root.getElementById('body');
    setupDrag(root.getElementById('toggle'), () => {
      open = !open; root.getElementById('panel').classList.toggle('open', open); render(); placePanel();
    });
    window.addEventListener('resize', () => { clampHost(); placePanel(); });
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; render(); return; }
      const r = ev.target.closest('tr[data-key]');
      if (r) { selectedKey = r.dataset.key === selectedKey ? null : r.dataset.key; render(); return; }
      if (ev.target.closest('[data-act="download"]')) download();
      if (ev.target.closest('[data-act="testsound"]')) { ensureAudio(); const was = cfg.sound; cfg.sound = true; beep(true); cfg.sound = was; }
      const fg = ev.target.closest('[data-frag]');
      if (fg) { fragFilter = fg.dataset.frag; render(); return; }
      const fb = ev.target.closest('[data-factor]');
      if (fb) { cfg.arcFactor = +fb.dataset.factor; saveCfg(); render(); return; }
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
    });
    root.addEventListener('input', () => { lastInputAt = Date.now(); });
    root.addEventListener('change', (ev) => {
      const el = ev.target.closest('[data-cfg]');
      if (el) { cfg[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : +el.value; saveCfg(); render(); }
      const pn = ev.target.closest('[data-prov]');
      if (pn) { setProvName(+pn.dataset.prov, pn.value); render(); }
      const inp = ev.target.closest('[data-input="attrTarget"]');
      if (inp) { attrTarget = +inp.value || null; render(); }
    });
    attach();
    // Hra si stránku po načtení přestavuje – když panel zmizí, vrátíme ho.
    setInterval(() => { if (!host.isConnected) attach(); }, 2000);
    console.log('[FoE Reader] panel připraven');
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
    const pw = Math.min(580, window.innerWidth * 0.96);
    panel.style.left = (x + pw > window.innerWidth ? Math.max(-x, btnW - pw) : 0) + 'px';
    const below = y < window.innerHeight / 2;
    panel.style.top = below ? 'calc(100% + 6px)' : 'auto';
    panel.style.bottom = below ? 'auto' : 'calc(100% + 6px)';
    const btnH = root.getElementById('toggle').offsetHeight;
    panel.style.maxHeight = Math.max(200, below ? window.innerHeight - y - btnH - 16 : y - 16) + 'px';
  }
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
    const blob = new Blob([JSON.stringify(S.ring, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `foe-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function render() {
    if (!root) return;
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
    setTimeout(() => { pending = false; render(); }, 500);
  }
  setInterval(() => { if (open && ['tav', 'gbg', 'prod'].includes(tab)) render(); }, 15000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // Pro ladění z konzole (izolovaný svět): stav není v kontextu stránky.
  window.__foeReader = S;
})();
