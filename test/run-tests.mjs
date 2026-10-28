// FoE Reader – automatické testy: načte panel do Chromia, pošle mu syntetické zprávy hry a ověří klíčová čísla.
// Spuštění: npm i playwright@1.56.0 && node test/run-tests.mjs   (v CI viz .github/workflows/test.yml)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'test/harness.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/javascript' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

const msg = (key, data, channel = 'http') => { const [c, m] = key.split('.'); return { channel, m: { requestClass: c, requestMethod: m, [channel === 'req' ? 'requestData' : 'responseData']: data } }; };
async function page(messages, cfg) {
  const pg = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  if (cfg) await pg.addInitScript((c) => localStorage.setItem('foeReaderSettings', JSON.stringify(c)), cfg);
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  pg.on('console', (c) => { if (c.type() === 'warning' && /NaN/.test(c.text())) errors.push(c.text()); });
  await pg.goto(BASE);
  for (const x of messages) {
    await pg.evaluate(([ch, m]) => window.postMessage({ source: 'foe-reader', channel: ch, messages: [m] }, '*'), [x.channel, x.m]);
    await pg.waitForTimeout(30);
  }
  await pg.waitForTimeout(900);
  return { pg, errors };
}
const winText = (pg, title) => pg.evaluate((t) => [...document.querySelectorAll('.foe-reader-win')]
  .map((w) => w.shadowRoot).find((r) => r.querySelector('.whead b')?.textContent.includes(t))?.querySelector('.wbody')?.innerText || '', title);
const calcText = (pg) => pg.evaluate(() => [...document.querySelectorAll('div')].map((d) => d.shadowRoot).find((r) => /Kalkulačka VB|GB calculator/.test(r?.querySelector('.whead b')?.textContent || ''))?.textContent || '');
async function openTab(pg, id) { await pg.locator(`#foe-reader-host [data-ico="${id}"]`).click(); await pg.waitForTimeout(400); }

// --- syntetická data ---
const ME = 1, OTHER = 2;
const startup = (entities = []) => msg('StartupService.getData', { user_data: { player_id: ME, user_name: 'Tester', era: 'SpaceAgeTitan' }, city_map: { entities } });
const arc = { id: 10, player_id: ME, cityentity_id: 'X_FutureEra_Landmark1', type: 'greatbuilding', level: 182, __class__: 'CityMapEntity',
  bonuses: [{ type: 'contribution_boost', value: 99, bonusCategory: { value: 'passiveBonus' } }, { type: 'contribution_boost_gold', value: 20, bonusCategory: { value: 'passiveBonus' } }] };
const zeus = { id: 11, player_id: ME, cityentity_id: 'X_BronzeAge_Landmark2', type: 'greatbuilding', level: 142, __class__: 'CityMapEntity',
  bonuses: [{ type: 'military_boost', value: 100, targetedFeature: 'all', bonusCategory: { value: 'passiveBonus' } },
    { type: 'attack_boost', value: 2, targetedFeature: 'guild_expedition', isBonusMultiplier: true, bonusCategory: { value: 'passiveBonus' } }] };
const bp = (...tiers) => tiers.map((t) => ({ building_id: 'X_FutureEra_Landmark1', amount: 1, tier: { value: t } }));
const rankings = (goldRanks, medals = 0) => [
  { player: { player_id: OTHER, name: 'Vlastník' }, forge_points: 5000, __class__: 'GreatBuildingRankingRow' },
  ...[[1, 920], [2, 460], [3, 155], [4, 40], [5, 10]].map(([rank, fp]) => ({ rank, player: { player_id: 0, name: 'No contributor yet' }, __class__: 'GreatBuildingRankingRow',
    reward: { strategy_point_amount: fp, blueprintRewards: bp('copper', ...(goldRanks.includes(rank) ? ['gold'] : [])), resources: { medals: rank === 1 ? medals : 0 } } }))];
const foreignGb = (level) => msg('OtherPlayerService.getOtherPlayerCityMapEntity', { id: 817, player_id: OTHER, cityentity_id: 'X_FutureEra_Landmark1', type: 'greatbuilding', level,
  state: { invested_forge_points: 1000, forge_points_for_level_up: 9000 }, __class__: 'CityMapEntity' });

const tests = {
  async 'VB úroveň 100: měděná (zlatý plánek jen P1), bonus Archy 99 %'() {
    const { pg, errors } = await page([startup([arc]), foreignGb(100), msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'),
      msg('GreatBuildingsService.getConstruction', { rankings: rankings([1]) })]);
    const t = await calcText(pg);
    if (!t.includes('(měděný)')) throw new Error('čekal jsem měděný stupeň: ' + t.slice(0, 300));
    if (!/920\s*→\s*1\s?830/.test(t.replace(/ /g, ' '))) throw new Error('P1 920 × 1,99 = 1 830 nenalezeno');
    return errors;
  },
  async 'VB úroveň 101: zlatá (zlaté plánky P1–P3), medaile s bonusem 20 %'() {
    const { pg, errors } = await page([startup([arc]), foreignGb(101), msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'),
      msg('GreatBuildingsService.getConstruction', { rankings: rankings([1, 2, 3], 46839) })]);
    const t = (await calcText(pg)).replace(/ /g, ' ');
    if (!t.includes('(zlatý)')) throw new Error('čekal jsem zlatý stupeň');
    if (!/920\s*→\s*1 105/.test(t)) throw new Error('P1 920 × 1,2 = 1 105 nenalezeno');
    if (!t.includes('56 207')) throw new Error('medaile 46 839 × 1,2 = 56 207 nenalezeny');
    return errors;
  },
  async 'Bonusy: násobitel z VB navýší expedici'() {
    const boosts = [{ type: 'att_boost_attacker', value: 1000, targetedFeature: 'all' }, { type: 'att_boost_attacker', value: 500, targetedFeature: 'guild_expedition' }];
    const { pg, errors } = await page([startup([zeus]), msg('BoostService.getAllBoosts', boosts)]);
    await openTab(pg, 'boost');
    const t = (await winText(pg, 'Bonusy')).replace(/ /g, ' ');
    // (1000 + 100 + 500) × 1,02 = 1 632
    if (!/Expedice\s+1 632 %/.test(t)) throw new Error('expedice 1 632 % nenalezena: ' + t.slice(0, 400));
    return errors;
  },
  async 'GBG: typ provincie a opotřebení bez úrovně (žádné NaN)'() {
    const now = Math.floor(Date.now() / 1000);
    const bg = { map: { id: 'volcano_archipelago', provinces: [{ ownerId: 7, isAttackBattleType: true, lockedUntil: now + 600 }, { id: 1, ownerId: 8, lockedUntil: now + 600 }] },
      battlegroundParticipants: [{ participantId: 7, clan: { name: 'Cech A' } }, { participantId: 8, clan: { name: 'Cech B' } }], currentParticipantId: 9, endsAt: now + 99999,
      currentPlayerParticipant: { attrition: { __class__: 'GuildBattlegroundAttrition' } } };
    const { pg, errors } = await page([startup(), msg('GuildBattlegroundService.getBattleground', bg)]);
    await pg.waitForTimeout(300);
    const html = await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].map((w) => w.shadowRoot.innerHTML).join(''));
    if (!html.includes('bt red') || !html.includes('bt blue')) throw new Error('chybí označení červené / modré provincie');
    if (/value="NaN"/.test(html)) throw new Error('NaN v číselném poli');
    return errors;
  },
  async 'Vyjednávání: došlé tahy – cena a návrh po koupi'() {
    const goods = ['a', 'b', 'c', 'd', 'e'];
    const start = msg('GuildExpeditionService.startNegotiation', { context: 'guildExpedition', possibleCosts: { resources: Object.fromEntries(goods.map((g) => [g, 10])) }, __class__: 'NegotiationGame' });
    const slot = (i, g, s) => ({ ...(i ? { slotId: i } : {}), resourceId: g, state: s });
    const turn1 = msg('NegotiationGameService.submitTurn', { state: 'ongoing', turnResult: { slots: [slot(0, 'a', 'correct'), slot(1, 'b', 'correct'), slot(2, 'c', 'correct'), slot(3, 'd', 'not_needed'), slot(4, 'e', 'correct')] } });
    const out = msg('NegotiationGameService.submitTurn', { state: 'out_of_turns', offer: { costsOptions: [{ resources: { premium: 10 } }] }, turnResult: { slots: [slot(3, 'b', 'not_needed')] } });
    const { pg, errors } = await page([startup(), msg('ResourceService.getPlayerResources', { resources: { negotiation_game_turn: 3 } }), start, turn1, out]);
    await pg.waitForTimeout(800);
    const t = (await winText(pg, 'Vyjednávání')).replace(/ /g, ' ');
    if (!t.includes('za 10 diamantů')) throw new Error('chybí cena dalšího tahu');
    if (!t.includes('Návrh po koupi')) throw new Error('chybí návrh po koupi');
    return errors;
  },
  async 'VB po vlastním náhozu: jisté místo ✓, horší přeškrtnutá'() {
    const rk = rankings([1]);
    rk[1] = { ...rk[1], player: { player_id: ME, name: 'Tester' }, forge_points: 8000 };
    rk[2] = { ...rk[2], player: { player_id: 3, name: 'Jiný' }, forge_points: 300 };
    const gb = foreignGb(100); gb.m.responseData = { ...gb.m.responseData, state: { invested_forge_points: 13300, forge_points_for_level_up: 20000 } };
    const { pg, errors } = await page([startup([arc]), gb, msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'),
      msg('GreatBuildingsService.getConstruction', { rankings: rk })]);
    const st = await pg.evaluate(() => { const r = [...document.querySelectorAll('div')].map((d) => d.shadowRoot).find((x) => /Kalkulačka VB/.test(x?.querySelector('.whead b')?.textContent || ''));
      return [...r.querySelectorAll('tbody tr')].slice(0, 5).map((tr) => tr.className + '|' + tr.innerText.replace(/\s+/g, ' ')); });
    if (!/^done\|1\. 👤.*✓ vaše/.test(st[0])) throw new Error('P1 není ✓ vaše: ' + st.join(' / '));
    if (!st.slice(1).every((x) => x.startsWith('gone|'))) throw new Error('horší místa nejsou přeškrtnutá: ' + st.join(' / '));
    return errors;
  },
  async 'Výzkum: chybějící FP a zboží do konce věku'() {
    const T = (id, era, parents, children, fp, res) => ({ id, era, parents, children, requirements: { resources: res }, researchCost: { resources: { strategy_points: fp } }, __class__: 'ResearchTechnology' });
    const meta = [{ id: 'root', parents: [], children: ['a'] },
      T('a', 'SpaceAgeTitan', ['root'], ['b'], 100, { money: 10 }),
      T('b', 'SpaceAgeSpaceHub', ['a'], ['c'], 500, { money: 1000, silver: 30 }),
      T('c', 'SpaceAgeSpaceHub', ['b'], ['d'], 400, { supplies: 50, silver: 40 }),
      T('opt', 'SpaceAgeSpaceHub', ['b'], [], 999, { silver: 999 }),
      T('d', 'StellarAgeDiscovery', ['c'], [], 7000, { money: 1 })];
    const { pg, errors } = await page([
      { channel: 'metadata', m: { metadataId: 'research-x', data: meta } },
      { channel: 'metadata', m: { metadataId: 'city_entities-x', data: [{ id: 'G_X', name: 'Důl', type: 'goods', width: 2, length: 2, available_products: [{ product: { resources: { silver: 5 } } }] }] } },
      msg('StartupService.getData', { user_data: { player_id: ME, user_name: 'Tester', era: 'SpaceAgeTitan' }, city_map: { entities: [{ id: 20, player_id: ME, cityentity_id: 'G_X', type: 'goods' }] }, goodsList: [{ id: 'silver', era: 'SpaceAgeSpaceHub', name: 'Stříbro' }] }),
      msg('ResourceService.getPlayerResources', { resources: { strategy_points: 50, money: 5000, supplies: 10, silver: 20 } }),
      msg('ResearchService.getProgress', { unlockedNodes: ['root', 'a'], inProgressTechnologies: [{ tech_id: 'b', currentSP: 120 }] })]);
    await openTab(pg, 'tech');
    const t = (await winText(pg, 'Výzkum')).replace(/ /g, ' ');
    // FP: b 500−120 + c 400 = 780, máte 50 → chybí 730; zboží silver 70 − 20 = 50; volitelná „opt“ vynechaná
    if (!/FP\s+780\s+780\s+50\s+730/.test(t)) throw new Error('FP nesedí: ' + t.slice(0, 500));
    if (!/Stříbro 🏭\s+70\s+70\s+20\s+50/.test(t)) throw new Error('zboží nesedí: ' + t.slice(0, 500));
    if (!t.includes('vynecháno 1')) throw new Error('volitelná technologie nevynechaná');
    return errors;
  },
  async 'GBG: vlastní hráč zvýrazněný v žebříčku členů'() {
    const lb = [{ player: { player_id: 3, name: 'Jiný' }, battlesWon: 50 }, { player: { player_id: ME, name: 'Tester' }, battlesWon: 10, negotiationsWon: 2 }];
    const { pg, errors } = await page([startup(), msg('GuildBattlegroundService.getPlayerLeaderboard', lb)]);
    await openTab(pg, 'gbg');
    const me = await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].map((w) => w.shadowRoot.querySelector('tr.me')).find(Boolean)?.innerText || '');
    if (!me.includes('Tester')) throw new Error('řádek vlastního hráče není zvýrazněný');
    return errors;
  },
  async 'Angličtina: žádný český text v záložkách (kontrola slovníku)'() {
    const { pg, errors } = await page([startup([arc, zeus]), msg('ResourceService.getPlayerResources', { resources: { strategy_points: 50, money: 5000, guild_expedition_attempt: 3 } }),
      msg('GuildBattlegroundService.getPlayerLeaderboard', [{ player: { player_id: ME, name: 'Tester' }, battlesWon: 10 }]),
      foreignGb(100), msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'), msg('GreatBuildingsService.getConstruction', { rankings: rankings([1]) })], { lang: 'en' });
    const CZ = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/;
    const ids = await pg.evaluate(() => [...document.querySelector('#foe-reader-host').shadowRoot.querySelectorAll('[data-ico]')].map((b) => b.dataset.ico));
    const bad = new Set();
    const collect = () => pg.evaluate((re) => {
      const R = new RegExp(re), out = [];
      for (const h of [document.querySelector('#foe-reader-host'), ...document.querySelectorAll('.foe-reader-win, #foe-reader-calc')]) {
        const r = h?.shadowRoot; if (!r) continue;
        const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (!n.parentElement?.closest('style') && R.test(n.textContent)) out.push(n.textContent.trim());
        r.querySelectorAll('[title],[placeholder]').forEach((e) => { for (const a of [e.title, e.placeholder]) if (a && R.test(a)) out.push(a); });
      }
      return out;
    }, CZ.source);
    for (const id of ids) {
      await openTab(pg, id);
      if (id === 'alerts') await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].forEach((w) => w.shadowRoot.querySelector('[data-act="alertcfg"]')?.click()));
      await pg.waitForTimeout(250);
      for (const t of await collect()) bad.add(`[${id}] ${t}`);
      await openTab(pg, id);
    }
    const left = [...bad].filter((t) => !/Čeština|Názvy z hry/.test(t));
    if (left.length) throw new Error('nepřeložené texty (doplňte do i18n.js):\n      ' + left.slice(0, 30).join('\n      '));
    return errors;
  },
  async 'Konec expedice: upozornění na nevyužité pokusy'() {
    const end = Math.floor(Date.now() / 1000) + 3600;
    const { pg, errors } = await page([startup(), msg('ResourceService.getPlayerResources', { resources: { guild_expedition_attempt: 4 } }),
      msg('GuildExpeditionService.getOverview', { state: 'active', nextStateTime: end })]);
    await pg.evaluate(() => localStorage.removeItem('foeReaderEnds'));
    await pg.evaluate((e) => window.postMessage({ source: 'foe-reader', channel: 'http', messages: [{ requestClass: 'GuildExpeditionService', requestMethod: 'getOverview', responseData: { state: 'active', nextStateTime: e } }] }, '*'), end);
    await pg.waitForTimeout(400);
    await openTab(pg, 'alerts');
    let t = await winText(pg, 'Upozornění');
    for (let i = 0; i < 20 && !/Expedice končí za/.test(t); i++) { await pg.waitForTimeout(1000); t = await winText(pg, 'Upozornění'); }
    if (!/Expedice končí za .* a máte 4 nevyužitých pokusů/.test(t)) throw new Error('chybí upozornění na konec expedice: ' + t.slice(0, 300));
    return errors;
  },
  async 'Osada: součty odemčení a minihra obchodníka'() {
    const adv = [{ id: 'a1', name: 'Svatyně', isUnlocked: true, rewards: [], requirements: { resources: { diplomacy: 50, beans: 10 } } },
      { id: 'a2', name: 'Farma', rewards: [], requirements: { resources: { diplomacy: 200, beans: 30, hats: 5 } } },
      { id: 'a3', name: 'Chrám', rewards: [], requirements: { resources: { diplomacy: 400, beans: 20, hats: 15 } } }];
    const op = { content: 'aztecs', name: 'Aztécká osada', gridId: 'cultural_outpost', startedAt: 100, primaryResourceId: 'cocoa', goodsResourceIds: ['beans', 'hats'],
      completedPlaythroughs: 1, playthroughs: [{ productionBonusProbability: 0.05 }, { productionBonusProbability: 0.1 }] };
    const tile = (x, y, a, r) => ({ __class__: r ? 'CollectingMinigameRewardTile' : 'CollectingMinigameEmptyTile', ...(x ? { x } : {}), ...(y ? { y } : {}), ...(a ? { adjacentRewards: a } : {}) });
    const { pg, errors } = await page([startup(), msg('OutpostService.getAll', [op]), msg('AdvancementService.getAll', adv),
      msg('ResourceService.getPlayerResources', { resources: { cocoa: 3000, beans: 40, hats: 0, diplomacy: 250, aztecs_collecting_minigame_turns: 6 } }),
      msg('CollectingMinigameService.start', { context: 'merchant', width: 3, height: 3, reward: { resources: { beans: 1 } } }),
      msg('CollectingMinigameService.submitMove', [tile(2, 0, 0), tile(1, 0, 0), tile(2, 1, 0), tile(1, 1, 1), tile(0, 0, 0), tile(0, 1, 1)])]);
    await pg.waitForTimeout(300);
    await openTab(pg, 'osada');
    const t = (await winText(pg, 'Osada')).replace(/\u00a0/g, ' ');
    // beans: 30 + 20 = 50, máte 40 → −10; hats 20 → −20; kakao na chybějící zboží: ceil(10)*200 + 20*200 = 6 000
    if (!/Potřeba\s+50\s+20\s+400\s+6 000/.test(t)) throw new Error('součty nesedí: ' + t.slice(0, 900));
    if (!/Chybí \/ zbývá\s+-10\s+-20\s+-150\s+-3 000/.test(t)) throw new Error('chybí nesedí: ' + t.slice(0, 900));
    if (!/průchod 2 \/ 2/.test(t) || !/šance na 4× 10 %/.test(t)) throw new Error('průchod / šance nesedí');
    // minihra: 1 poklad; (2,1)=0 → (1,2) a (2,2) prázdné, (0,1)=1 → poklad jistě v (0,2)
    const star = await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].map((w) => w.shadowRoot.querySelector('table.mgt')).find(Boolean)?.innerText || '');
    if (!star.includes('★')) throw new Error('minihra: chybí jistý poklad ★: ' + star);
    return errors;
  },
  async 'Kalkulačka VB: okno si pamatuje polohu i po zavření'() {
    const { pg, errors } = await page([startup([arc]), foreignGb(100), msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'), msg('GreatBuildingsService.getConstruction', { rankings: rankings([1]) })]);
    const box = () => pg.evaluate(() => { const b = document.querySelector('#foe-reader-calc')?.getBoundingClientRect(); return b && { x: Math.round(b.left), y: Math.round(b.top) }; });
    const b0 = await box();
    if (!b0) throw new Error('kalkulačka se neotevřela');
    const head = await pg.evaluate(() => { const r = document.querySelector('#foe-reader-calc').shadowRoot.querySelector('.whead b').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 5 }; });
    await pg.mouse.move(head.x, head.y); await pg.mouse.down(); await pg.mouse.move(head.x + 300, head.y + 200, { steps: 5 }); await pg.mouse.up();
    const b1 = await box();
    await pg.evaluate(() => document.querySelector('#foe-reader-calc').shadowRoot.querySelector('#close').click());
    await pg.waitForTimeout(300);
    await pg.evaluate(() => openCalcWin());
    await pg.waitForTimeout(200);
    const b2 = await box();
    if (Math.abs(b2.x - b1.x) > 2 || Math.abs(b2.y - b1.y) > 2) throw new Error(`poloha se nezapamatovala: ${JSON.stringify([b0, b1, b2])}`);
    return errors;
  },
  async 'Okna: sbalení na záhlaví a rozbalení na původní výšku'() {
    const { pg, errors } = await page([startup()]);
    await openTab(pg, 'res');
    const win = () => pg.evaluate(() => { const w = [...document.querySelectorAll('.foe-reader-win')].pop(); return Math.round(w.getBoundingClientRect().height); });
    const h0 = await win();
    await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].pop().shadowRoot.querySelector('[data-w="min"]').click());
    await pg.waitForTimeout(200);
    const h1 = await win();
    if (h1 > 45) throw new Error('okno se nesbalilo: ' + h1);
    const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('foeReaderTabWins')).res.h);
    if (Math.abs(saved - h0) > 2) throw new Error('uložila se výška sbaleného okna: ' + saved);
    await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].pop().shadowRoot.querySelector('[data-w="min"]').click());
    await pg.waitForTimeout(200);
    const h2 = await win();
    if (Math.abs(h2 - h0) > 2) throw new Error(`nerozbalilo se na původní výšku: ${h0} → ${h2}`);
    return errors;
  },
  async 'QI: Quantum Pass – body, stupeň a nevyzvednuté odměny'() {
    const R = (n) => ({ name: n });
    const prizes = [];
    for (let lv = 0; lv < 4; lv++) for (const [i, ty] of ['grand_prize', 'event_pass', 'golden_event_pass'].entries())
      prizes.push({ ...(lv * 3 + i ? { prizeId: lv * 3 + i } : {}), ...(lv ? { totalNeedPoints: lv * 250 } : {}), type: ty, reward: R(`L${lv} ${ty}`), ...(ty === 'grand_prize' && lv < 1 ? { claimed: true } : {}) });
    const types = [{ type: 'grand_prize', unlocked: true }, { type: 'event_pass' }, { type: 'golden_event_pass' }];
    const { pg, errors } = await page([startup(),
      msg('EventPassService.getOverview', { context: 'guild_raids_1_pass', name: 'Quantum Pass', totalProgress: 300, prizes: { grandPrizes: prizes }, types }),
      msg('EventPassService.getPreview', { context: 'guild_raids_1_pass', teaserPrizes: { grandPrizes: [{ prizeId: 6, totalNeedPoints: 250, currentPoints: 120, type: 'grand_prize', reward: R('Další') }] }, types })]);
    await openTab(pg, 'qi');
    const t = (await winText(pg, 'QI')).replace(/\u00a0/g, ' ');
    // náhled je novější: body = 500 − 250 + 120 = 370; stupně 0, 250 dosažené → 2 / 4; nevyzvednutá jen L1 grand_prize
    if (!/Body passu\s+370/.test(t) || !/Stupeň\s+2 \/ 4/.test(t) || !/120 \/ 250/.test(t)) throw new Error('pass nesedí: ' + t.slice(0, 600));
    if (!/Nevyzvednuté odměny: 1 – L1 grand_prize/.test(t)) throw new Error('nevyzvednuté nesedí: ' + t.slice(0, 800));
    return errors;
  },
  async 'QI akce: upozornění, že budou plné'() {
    const defs = [{ id: 'guild_raids_action_points', name: 'Akce', abilities: { autoRefill: { interval: 3600, refillAmount: 5000, maxAmount: 244000, boostType: 'guild_raids_action_points_collection' } } }];
    const { pg, errors } = await page([startup(), msg('ResourceService.getResourceDefinitions', defs),
      msg('BoostService.getAllBoosts', [{ type: 'guild_raids_action_points_collection', value: 1000, targetedFeature: 'all' }]),
      msg('GuildRaidsService.getState', { __class__: 'GuildRaidsRunningState', endsAt: Math.floor(Date.now() / 1000) + 5 * 86400 }),
      msg('ResourceService.getPlayerResources', { resources: { guild_raids_action_points: 240000 } })]);
    await openTab(pg, 'alerts');
    let t = '';
    for (let i = 0; i < 15 && !/QI akce budou plné/.test(t); i++) { await pg.waitForTimeout(1000); t = await winText(pg, 'Upozornění'); }
    // 4 000 do stropu při 6 000/h → ~40 min
    if (!/QI akce budou plné za ~40 min/.test(t)) throw new Error('chybí upozornění na plné QI akce: ' + t.slice(0, 300));
    return errors;
  },
  async 'Minihra: okno hned po zahájení (bez tahu) a skutečný průběh hry'() {
    // Tahy ze skutečné hry (11×7, 10 pokladů): první tah odkryje oblast, další míří na jisté poklady.
    const E = (x, y, a) => ({ ...(x ? { x } : {}), ...(y ? { y } : {}), ...(a ? { adjacentRewards: a } : {}), __class__: 'CollectingMinigameEmptyTile' });
    const { pg, errors } = await page([startup(), msg('CollectingMinigameService.start', { context: 'merchant', width: 11, height: 7, reward: { resources: { stone_figures: 10 } } })]);
    await pg.waitForTimeout(700);
    let t = await winText(pg, 'Minihra');
    if (!/nalezeno 0 \/ 10/.test(t)) throw new Error('okno minihry se po zahájení neukázalo: ' + t.slice(0, 200));
    await pg.evaluate((m) => window.postMessage({ source: 'foe-reader', channel: 'http', messages: [{ requestClass: 'CollectingMinigameService', requestMethod: 'submitMove', responseData: m }] }, '*'),
      [E(4, 3), E(3, 2, 1), E(4, 2, 1), E(5, 2), E(3, 3), E(5, 3), E(3, 4), E(4, 4), E(5, 4, 1), E(4, 1, 2)]);
    await pg.waitForTimeout(700);
    t = await winText(pg, 'Minihra');
    if (!/nalezeno 0 \/ 10/.test(t) || /odhad/.test(t)) throw new Error('po prvním tahu: ' + t.slice(0, 300));
    // jako FoE Helper: došly tahy → okno se zavře, po dokoupení se otevře znovu
    const res = (n) => pg.evaluate((n) => window.postMessage({ source: 'foe-reader', channel: 'http', messages: [{ requestClass: 'ResourceService', requestMethod: 'getPlayerResources', responseData: { resources: { aztecs_collecting_minigame_turns: n } } }] }, '*'), n);
    const open = () => pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].some((w) => /Minihra/.test(w.shadowRoot.querySelector('.whead b')?.textContent || '')));
    await res(0); await pg.waitForTimeout(6000);
    if (await open()) throw new Error('okno minihry se po vyčerpání tahů nezavřelo');
    await res(5); await pg.waitForTimeout(6000);
    if (!(await open())) throw new Error('okno minihry se po dokoupení tahů neotevřelo');
    return errors;
  },
  async 'QI: výnos výroby s euforií a bonusy (jako hra / FoE Helper)'() {
    const prodE = (id, type, res) => ({ id, cityentity_id: id === 1 ? 'H_QI' : 'W_QI' + id, type, state: { __class__: 'ProducingState', next_state_transition_at: Math.floor(Date.now() / 1000) + 3600,
      productionOption: { time: 36000, products: [{ type: 'resources', playerResources: { resources: res } }] } } });
    const map = { gridId: 'guild_raids', entities: [prodE(1, 'main_building', { guild_raids_money: 50000 }), prodE(2, 'generic_building', { guild_raids_money: 12500, guild_raids_chrono_alloy: 10 }),
      prodE(3, 'generic_building', { guild_raids_supplies: 12000 })] };
    const { pg, errors } = await page([startup(), msg('BoostService.getAllBoosts', [{ type: 'guild_raids_coins_production', value: 66 }, { type: 'guild_raids_supplies_production', value: 83 }]),
      msg('ResourceService.getPlayerResources', { resources: { guild_raids_happiness: 1880, guild_raids_total_population: 430 } }), msg('CityMapService.getCityMap', map)]);
    await openTab(pg, 'qi');
    const t = (await winText(pg, 'QI')).replace(/\u00a0/g, ' ');
    // mince 50 000 + 12 500 × (1,5 + 0,66) = 77 000; zásoby 12 000 × 2,33 = 27 960; chrono 10 × 1,5 = 15
    if (!/Celkem v běžící výrobě:.*77 000/.test(t) || !/27 960/.test(t) || !/chrono alloy 15|Chrono Alloy 15|chrono_alloy 15/i.test(t)) throw new Error('výnos QI nesedí: ' + t.slice(0, 500));
    return errors;
  },
  async 'Oznámení Chromu: v titulku svět a hráč, alarm klíčovaný světem'() {
    const { pg, errors } = await page([startup()]);
    const sent = await pg.evaluate(() => { const out = []; chrome.runtime.sendMessage = async (m) => { out.push(m); };
      sysSend({ type: 'notify', title: 'FoE Reader', message: 'x' }); sysSend({ type: 'schedule', key: 'A|1|5', when: 1, title: 'FoE Reader – GBG', message: 'y' }); return out; });
    const w = await pg.evaluate(() => location.hostname.split('.')[0]);
    if (sent[0].title !== `FoE Reader · ${w} · Tester`) throw new Error('titulek: ' + sent[0].title);
    if (sent[1].key !== `${w}|A|1|5`) throw new Error('klíč alarmu: ' + sent[1].key);
    return errors;
  },
  async 'Okénko FP ve skladu u lišty FP'() {
    const { pg, errors } = await page([startup(), msg('ResourceService.getPlayerResources', { resources: { strategy_points: 7 } }), msg('GreatBuildingsService.getAvailablePackageForgePoints', [1234])]);
    await pg.waitForTimeout(600);
    const t = await pg.evaluate(() => document.querySelector('#foe-reader-fpbar')?.textContent || '');
    if (!/1\s?234/.test(t.replace(/\u00a0/g, ' '))) throw new Error('okénko FP: ' + t);
    await pg.evaluate(() => { cfg.fpBar = false; renderFpBar(); });
    if (await pg.evaluate(() => !!document.querySelector('#foe-reader-fpbar'))) throw new Error('okénko FP se nevyplo');
    return errors;
  },
  async 'Nová verze: odznak u ℹ️ a odkaz ke stažení'() {
    const { pg, errors } = await page([startup()]);
    const none = await pg.evaluate(() => document.querySelector('#foe-reader-host').shadowRoot.querySelector('[data-ico="about"] .bdg'));
    if (none) throw new Error('odznak bez nové verze');
    await pg.evaluate(() => { window.__rel = { tag: '0.3.50', url: 'https://example.invalid/r', zip: 'https://example.invalid/foe-reader-0.3.50.zip', t: Date.now() }; });
    await pg.locator('#foe-reader-host [data-ico="about"]').click(); await pg.waitForTimeout(300);
    const w = await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].map((x) => x.shadowRoot).find((r) => r.querySelector('[data-act="checkupd"]')));
    if (!w) throw new Error('chybí tlačítko Zkontrolovat teď');
    await pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].map((x) => x.shadowRoot).find((r) => r.querySelector('[data-act="checkupd"]')).querySelector('[data-act="checkupd"]').click());
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => ({ bdg: document.querySelector('#foe-reader-host').shadowRoot.querySelector('[data-ico="about"] .bdg')?.textContent,
      txt: [...document.querySelectorAll('.foe-reader-win')].map((x) => x.shadowRoot.querySelector('.wbody')?.innerText || '').join(' ') }));
    if (st.bdg !== '↑') throw new Error('chybí odznak ↑ u ℹ️');
    if (!st.txt.includes('nová verze 0.3.50') || !st.txt.includes('Stáhnout ZIP')) throw new Error('chybí informace o nové verzi: ' + st.txt.slice(0, 300));
    return errors;
  },
  async 'Angličtina: kalkulačka a ℹ️ přeložené'() {
    const { pg, errors } = await page([startup([arc]), foreignGb(100), msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'),
      msg('GreatBuildingsService.getConstruction', { rankings: rankings([1]) })], { lang: 'en' });
    await pg.waitForTimeout(500);
    const t = (await calcText(pg)).replace(/ /g, ' ');
    if (!t.includes('GB calculator') || !t.includes('(copper)')) throw new Error('kalkulačka nepřeložená: ' + t.slice(0, 300));
    if (/měděný|Kalkulačka/.test(t)) throw new Error('v kalkulačce zůstala čeština: ' + t.slice(0, 300));
    await openTab(pg, 'about');
    const a = await winText(pg, 'About');
    if (!a.includes('Language') || !a.includes('Source code')) throw new Error('ℹ️ nepřeložené: ' + a.slice(0, 300));
    return errors;
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    const errors = await fn();
    if (errors?.length) throw new Error('chyby na stránce: ' + errors.join(' | '));
    console.log('✓', name);
  } catch (e) { failed++; console.log('✗', name, '\n   ', e.message); }
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} test(ů) selhalo` : '\nVšechny testy prošly');
process.exit(failed ? 1 : 0);
