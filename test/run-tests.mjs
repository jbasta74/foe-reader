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
  // přehled dne se v testech sám neotevírá (zakrýval by lištu), pokud ho test výslovně nezapne
  await pg.addInitScript((c) => localStorage.setItem('foeReaderSettings', JSON.stringify(c)), { dayPopup: false, ...(cfg || {}) });
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
  async 'Příhody: odznak s počtem aktivních u ikony'() {
    const now = Math.floor(Date.now() / 1000);
    const list = [{ hiddenRewardId: 1, type: 'incident_fisherman', startTime: now - 100, expireTime: now + 3600, position: { context: 'cityRoadSmall' } },
      { hiddenRewardId: 2, type: 'incident_wine_cask', startTime: now - 100, expireTime: now + 3600, position: { context: 'cityRoadSmall' } },
      { hiddenRewardId: 3, type: 'incident_pothole_1x1', startTime: now + 3600, expireTime: now + 7200, position: { context: 'cityRoadSmall' } },
      { hiddenRewardId: 4, type: 'ge_relic_common', startTime: now - 100, expireTime: now + 3600, position: { context: 'guildExpedition' } }];
    const { pg, errors } = await page([startup(), msg('HiddenRewardService.getOverview', { hiddenRewards: list })]);
    await pg.waitForTimeout(600);
    const b = await pg.evaluate(() => document.querySelector('#foe-reader-host').shadowRoot.querySelector('[data-ico="inc"] .bdg')?.textContent);
    if (b !== '2') throw new Error('odznak příhod: ' + b);
    return errors;
  },
  async 'Kalkulačka VB: nához se přepočítá po přepnutí koeficientu'() {
    const { pg, errors } = await page([startup([arc]), foreignGb(100), msg('GreatBuildingsService.getConstruction', [817, OTHER], 'req'), msg('GreatBuildingsService.getConstruction', { rankings: rankings([1]) })]);
    const click = (f) => pg.evaluate((f) => document.querySelector('#foe-reader-calc').shadowRoot.querySelector(`[data-factor="${f}"]`).click(), f);
    await click('1.9'); await pg.waitForTimeout(300);
    let t = (await calcText(pg)).replace(/\u00a0/g, ' ');
    // P1 920 × 1,9 = 1 748
    if (!/1 748/.test(t)) throw new Error('nához ×1,9 nesedí: ' + t.slice(0, 400));
    await click('arc'); await pg.waitForTimeout(300);
    t = (await calcText(pg)).replace(/\u00a0/g, ' ');
    if (/1 748/.test(t) || !/1 830/.test(t)) throw new Error('po přepnutí na Arc se nához nepřepočítal: ' + t.slice(0, 400));
    return errors;
  },
  async 'Nastavení lišty platí jen pro daný svět (nesynchronizuje se)'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      cfg.uiBar = true; cfg.barVertical = false; cfg.hiddenTabs = []; cfg.sound = true;
      const later = Date.now() + 10000;
      applySyncedCfg({ uiBar: false, barVertical: true, hiddenTabs: ['log'], sound: false, _kt: { uiBar: later, barVertical: later, hiddenTabs: later, sound: later } });
      return { uiBar: cfg.uiBar, barVertical: cfg.barVertical, hidden: cfg.hiddenTabs.length, sound: cfg.sound };
    });
    if (!r.uiBar || r.barVertical || r.hidden || r.sound !== false) throw new Error('synchronizace: ' + JSON.stringify(r));
    return errors;
  },
  async 'Mapa: odebratelné cesty a volné místo'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      // 10×6: radnice 2×2 vlevo nahoře, cesta v řádku y=2 (x 0–9) + odbočka x=5,y=3 (vede jen k budově, která cestu nepotřebuje)
      S.grids.main = { unlocked: [{ x: 0, y: 0, width: 10, length: 6 }], blocked: [] };
      S.ent.set('H_T', { w: 2, l: 2, road: 1, type: 'main_building' }); S.ent.set('S_R', { w: 1, l: 1, road: 1, type: 'street' });
      S.ent.set('R_A', { w: 2, l: 2, road: 1, type: 'residential' }); S.ent.set('D_X', { w: 1, l: 1, road: 0, type: 'decoration' });
      const E = new Map(); let id = 1; const add = (c, x, y, conn = 1) => E.set(id, { id: id++, player_id: myId(), cityentity_id: c, x, y, connected: conn });
      add('H_T', 0, 0); for (let x = 0; x < 10; x++) add('S_R', x, 2); add('S_R', 5, 3); add('R_A', 3, 0); add('R_A', 6, 3); add('D_X', 5, 4);
      S.entities = E;
      const M = mapModel('main');
      return { rem: M.removable.sort(), lf: largestFree(M), fit22: freeFits(M, 2, 2).length };
    });
    // stačí cesta x 1–6 v řádku 2 (radnice se dotýká x1, A x3–4, B x6); odebrat jde x0, x7, x8, x9 a odbočka 5,3
    if (JSON.stringify(r.rem) !== JSON.stringify(['0,2', '5,3', '7,2', '8,2', '9,2'])) throw new Error('odebratelné cesty: ' + JSON.stringify(r.rem));
    if (!r.lf || r.lf.w * r.lf.l < 4) throw new Error('největší volný obdélník: ' + JSON.stringify(r.lf));
    if (!(r.fit22 >= 2)) throw new Error('volné místo 2×2: ' + r.fit22);
    return errors;
  },
  async 'Mapa: tip na prohození a plánovač'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      // radnice 2×2, hlavní cesta y=2; dekorace 1×1 u cesty (2,3); dílna 1×1 s cestou (5,4) na odbočce (5,3)
      S.grids.main = { unlocked: [{ x: 0, y: 0, width: 10, length: 7 }], blocked: [] };
      S.ent.set('H_T', { w: 2, l: 2, road: 1, type: 'main_building' }); S.ent.set('S_R', { w: 1, l: 1, road: 1, type: 'street' });
      S.ent.set('P_1', { w: 1, l: 1, road: 1, type: 'production' }); S.ent.set('D_X', { w: 1, l: 1, road: 0, type: 'decoration' });
      S.names.set('P_1', 'Dílna'); S.names.set('D_X', 'Keř');
      const E = new Map(); let id = 1; const add = (c, x, y) => E.set(id, { id: id++, player_id: myId(), cityentity_id: c, x, y, connected: 1 });
      add('H_T', 0, 0); for (let x = 0; x < 10; x++) add('S_R', x, 2); add('S_R', 5, 3); add('P_1', 5, 4); add('D_X', 2, 3);
      S.entities = E; mapGrid = 'main'; mapPlan = null; mapTip = null;
      const M = mapModel('main');
      const tips = swapTips(M).map((t) => `${t.a.name}⇄${t.b.name}−${t.gain}`);
      const btn = (k, v) => { const b = document.createElement('button'); b.dataset[k] = v; return b; };
      mapClick(btn('mtip', '0')); mapClick(btn('mtip', '0')); // ukázat, pak vyzkoušet v plánu
      if (!mapPlan) return { tips, rem: M.removable, nar: M.noRoadAtRoad.map((i) => i.name), reach: M.removable.reach.map((x) => x.size) };
      let P = planModel();
      const after = { on: planOn(), nc: P.notConnected.length, rem: [...P.removable].sort(), roads: P.road.size };
      mapClick(btn('pact', 'droprem')); P = planModel();
      const dropped = { roads: P.road.size, nc: P.notConnected.length, stats: planStats(P).replace(/<[^>]+>/g, '') };
      const dil = P.items.find((it) => it.name === 'Dílna'); planMove(dil.e, 5, 5); P = planModel();
      const moved = P.notConnected.length;
      planUndo(); P = planModel();
      const undone = P.notConnected.length;
      const addRoad = planRoad(P, 4, 4, false); P = planModel(); const rAdd = P.road.size;
      planRoad(P, 4, 4, false); P = planModel(); const rDel = P.road.size;
      const game = mapModel('main').road.size;
      mapClick(btn('pact', 'end'));
      return { tips, after, dropped, moved, undone, addRoad, rAdd, rDel, game, off: !planOn() };
    });
    if (JSON.stringify(r.tips) !== JSON.stringify(['Keř⇄Dílna−4'])) throw new Error('tipy: ' + JSON.stringify(r));
    if (!r.after.on || r.after.nc || !r.after.rem.includes('5,3')) throw new Error('plán po prohození: ' + JSON.stringify(r.after));
    if (r.dropped.roads >= r.after.roads || r.dropped.nc || !/vše připojeno/.test(r.dropped.stats)) throw new Error('odebrání cest: ' + JSON.stringify(r.dropped));
    if (r.moved !== 1 || r.undone !== 0) throw new Error('kontrola připojení / zpět: ' + JSON.stringify(r));
    if (!r.addRoad || r.rAdd !== r.dropped.roads + 1 || r.rDel !== r.dropped.roads) throw new Error('nástroj cesta: ' + JSON.stringify(r));
    if (r.game !== 11 || !r.off) throw new Error('hra se nesmí změnit: ' + JSON.stringify(r));
    return errors;
  },
  async 'Mapa: postup přestavby, inventář a uložené varianty plánu'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      // dvě stejné budovy, které si mají vyměnit místo (musí se jedna dočasně odsunout), cesta navíc a budova z inventáře
      localStorage.removeItem('foeReaderPlans');
      S.grids.main = { unlocked: [{ x: 0, y: 0, width: 10, length: 7 }], blocked: [] };
      S.ent.set('H_T', { w: 2, l: 2, road: 1, type: 'main_building' }); S.ent.set('S_R', { w: 1, l: 1, road: 1, type: 'street' });
      S.ent.set('R_A', { w: 2, l: 2, road: 1, type: 'residential' }); S.ent.set('D_X', { w: 2, l: 2, road: 0, type: 'decoration' });
      S.names.set('R_A', 'Dům'); S.names.set('D_X', 'Keř');
      const E = new Map(); let id = 1; const add = (c, x, y) => E.set(id, { id: id++, player_id: myId(), cityentity_id: c, x, y, connected: 1 });
      add('H_T', 0, 0); for (let x = 0; x < 10; x++) add('S_R', x, 2); add('R_A', 3, 0); add('D_X', 5, 0); add('S_R', 9, 3);
      S.entities = E; mapGrid = 'main'; mapPlan = null;
      S.inv.set(501, { name: 'Keř', stock: 1, item: { __class__: 'BuildingItemPayload', cityEntityId: 'D_X' } });
      const btn = (k, v) => { const b = document.createElement('button'); b.dataset[k] = v; return b; };
      mapClick(btn('pact', 'start'));
      const P = planModel(), dum = P.items.find((it) => it.name === 'Dům').e, ker = P.items.find((it) => it.name === 'Keř').e;
      planSwap(dum, ker);
      planRoad(planModel(), 9, 3, false); // smazat odbočku
      mapClick(btn('pshow', 'inv')); const invHtml = planInvHtml();
      mapClick(btn('pinv', '501')); planPlace(planModel(), mapPlan.pick, 0, 3);
      const s1 = planSteps().map((x) => x.k);
      // ve hře se odbočka smaže (removeBuilding) a dům přesune na dočasné místo → postup se zkrátí
      window.postMessage({ source: 'foe-reader', channel: 'req', messages: [{ requestClass: 'CityMapService', requestMethod: 'removeBuilding', requestData: [14] }] }, '*');
      return { s1, invHtml: /Keř 2×2/.test(invHtml), invLeft: /data-pinv/.test(planInvHtml()) };
    });
    await pg.waitForTimeout(200);
    const r2 = await pg.evaluate(() => {
      const s2 = planSteps().map((x) => x.k), gone = !S.entities.has(14);
      const btn = (k, v) => { const b = document.createElement('button'); b.dataset[k] = v; return b; };
      document.body.insertAdjacentHTML('beforeend', '<input id="planname" value="Varianta A">');
      const sv = btn('pact', 'save'); document.body.appendChild(sv); mapClick(sv);
      const saved = Object.keys(JSON.parse(localStorage.getItem('foeReaderPlans')).main);
      mapClick(btn('pact', 'end'));
      const stats = mapStats(mapModel('main'), true).replace(/<[^>]+>/g, ' ');
      mapClick(btn('pload', 'Varianta A'));
      const P = planModel(), dum = P.items.find((it) => it.name === 'Dům');
      return { s2, gone, saved, stats: /Varianta A/.test(stats), loaded: mapPlan.name, dum: [dum.x0, dum.y0], inv: P.items.some((it) => it.e._inv), steps: planSteps().length };
    });
    if (JSON.stringify(r.s1) !== JSON.stringify(['rdel', 'add', 'tmp', 'move', 'move'])) throw new Error('postup: ' + JSON.stringify(r.s1));
    if (!r.invHtml || r.invLeft) throw new Error('inventář: ' + JSON.stringify(r));
    if (!r2.gone || JSON.stringify(r2.s2) !== JSON.stringify(['add', 'tmp', 'move', 'move'])) throw new Error('po smazání cesty ve hře: ' + JSON.stringify(r2));
    if (!r2.saved.includes('Varianta A') || !r2.saved.includes('Rozpracovaný') || !r2.stats) throw new Error('uložení: ' + JSON.stringify(r2));
    if (r2.loaded !== 'Varianta A' || r2.dum.join() !== '5,0' || !r2.inv || r2.steps !== 4) throw new Error('načtení: ' + JSON.stringify(r2));
    return errors;
  },
  async 'Mapa: plán ukazuje změnu Ratingu a produkce'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      S.grids.main = { unlocked: [{ x: 0, y: 0, width: 10, length: 6 }], blocked: [] };
      S.ent.set('H_T', { w: 2, l: 2, road: 1, type: 'main_building' }); S.ent.set('S_R', { w: 1, l: 1, road: 1, type: 'street' });
      S.ent.set('P_FP', { w: 2, l: 2, road: 1, type: 'production' });
      const E = new Map(); let id = 1; const add = (c, x, y, st) => E.set(id, { id: id++, player_id: myId(), cityentity_id: c, x, y, connected: 1, type: S.ent.get(c).type, state: st || {} });
      const fp = { current_product: { production_time: 86400, product: { resources: { strategy_points: 5 } } } };
      add('H_T', 0, 0); for (let x = 0; x < 10; x++) add('S_R', x, 2); add('P_FP', 3, 0, fp); add('P_FP', 5, 0, fp);
      S.entities = E; mapGrid = 'main'; mapPlan = null;
      planStart();
      const it = planModel().items.find((x) => x.e.cityentity_id === 'P_FP'); planPark(it);
      return { txt: planStats(planModel()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), v: planVal(), b: mapPlan.base.v };
    });
    if (!(r.b?.by?.strategy_points > 9) || Math.round(r.b.by.strategy_points - r.v.by.strategy_points) !== 5) throw new Error('hodnota: ' + JSON.stringify(r));
    if (!/Rating .*\(\s*-/.test(r.txt) || !/FP\s*-5/.test(r.txt)) throw new Error('text: ' + r.txt);
    return errors;
  },
  async 'Statistiky: názvy VB i u starších záznamů se serverovým ID'() {
    const { pg, errors } = await page([startup()]);
    const t = await pg.evaluate(() => { S.names.set('X_IronAge_Landmark1', 'Zeusova socha'); return gbChips({ gb: [{ id: 'X_IronAge_Landmark1', n: 'X_IronAge_Landmark1', l: 5 }] }, null); });
    if (!/Zeusova socha/.test(t) || /X_IronAge/.test(t)) throw new Error(t);
    return errors;
  },
  async 'Trh: poměr nabídek a filtry'() {
    const { pg, errors } = await page([startup(), msg('TradeService.getTradeOffers', [
      { offer: { good_id: 'marble', value: 10 }, need: { good_id: 'cloth', value: 10 }, merchant: { name: 'A', is_guild_member: true } },
      { offer: { good_id: 'marble', value: 20 }, need: { good_id: 'cloth', value: 10 }, merchant: { name: 'B', is_friend: true } },
      { offer: { good_id: 'marble', value: 5 }, need: { good_id: 'cloth', value: 10 }, merchant: { name: 'C', is_neighbor: true } },
      { offer: { good_id: 'cloth', value: 5 }, need: { good_id: 'marble', value: 10 }, merchant: { name: 'Já', is_self: true } },
    ])]);
    const r = await pg.evaluate(() => {
      S.goodsEra.set('marble', 'BronzeAge'); S.goodsEra.set('cloth', 'BronzeAge'); S.goodsName.set('marble', 'Mramor'); S.goodsName.set('cloth', 'Látka');
      S.resources.cloth = 15;
      const txt = () => viewMarket().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const a = txt(); cfg.mkDis = true; cfg.mkAfford = true; const b = txt(); cfg.mkDis = false; cfg.mkAfford = false;
      return { a, b };
    });
    // výchozí: výhodné (B 2,00) první, férové (A 1,00), nevýhodné (C) skryté, vlastní skryté
    if (!/2 z 4 nabídek/.test(r.a) || !(r.a.indexOf(' B ') < r.a.indexOf(' A ')) || / C /.test(r.a) || /Já/.test(r.a)) throw new Error('výchozí filtr: ' + r.a);
    if (!/3 z 4 nabídek/.test(r.b) || !/0,50|0\.50/.test(r.b)) throw new Error('nevýhodné: ' + r.b);
    return errors;
  },
  async 'Mapa: výměna slabé budovy za budovu z inventáře'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      S.grids.main = { unlocked: [{ x: 0, y: 0, width: 10, length: 6 }], blocked: [] };
      S.ent.set('H_T', { w: 2, l: 2, road: 1, type: 'main_building' }); S.ent.set('S_R', { w: 1, l: 1, road: 1, type: 'street' });
      S.ent.set('P_FP', { w: 2, l: 2, road: 1, type: 'production' }); S.ent.set('P_INV', { w: 2, l: 2, road: 1, type: 'production' });
      S.names.set('P_FP', 'Slabá'); S.names.set('P_INV', 'Silná');
      S.entProd.set('P_INV', { AllAge: [{ time: 86400, products: [{ playerResources: { resources: { strategy_points: 20 } } }] }] });
      const E = new Map(); let id = 1; const add = (c, x, y, st) => E.set(id, { id: id++, player_id: myId(), cityentity_id: c, x, y, connected: 1, type: S.ent.get(c).type, state: st || {} });
      add('H_T', 0, 0); for (let x = 0; x < 10; x++) add('S_R', x, 2); add('P_FP', 3, 0, { current_product: { production_time: 86400, product: { resources: { strategy_points: 2 } } } });
      S.entities = E; mapGrid = 'main'; mapPlan = null; mapInvTip = null;
      S.inv.set(900, { name: 'Silná', stock: 1, item: { __class__: 'BuildingItemPayload', cityEntityId: 'P_INV' } });
      const tips = invSwapTips(mapModel('main')).map((t) => `${t.c.name}→${t.b.name}`);
      const btn = (k, v) => { const b = document.createElement('button'); b.dataset[k] = v; return b; };
      mapClick(btn('mitip', '0')); mapClick(btn('mitip', '0'));
      const P = planModel(), at = P.occ.get('3,0');
      return { tips, on: planOn(), at: at?.e.cityentity_id, inv: at?.e._inv, parked: mapPlan.parked.map((e) => e.cityentity_id), steps: planSteps().map((x) => x.k), nc: P.notConnected.length };
    });
    if (JSON.stringify(r.tips) !== JSON.stringify(['Slabá→Silná'])) throw new Error('tipy: ' + JSON.stringify(r));
    if (!r.on || r.at !== 'P_INV' || r.inv !== 900 || r.parked.join() !== 'P_FP' || r.steps.join() !== 'del,add' || r.nc) throw new Error('plán: ' + JSON.stringify(r));
    return errors;
  },
  async 'Přehled dne: produkce, hospody, pokusy a samo otevření'() {
    const { pg, errors } = await page([startup([arc])], { dayPopup: true });
    await pg.waitForTimeout(4500);
    const r = await pg.evaluate(() => {
      const now = nowServer();
      S.entities.set(9001, { id: 9001, player_id: myId(), cityentity_id: 'X', state: { __class__: 'ProducingState', next_state_transition_at: now - 10 } });
      S.entities.set(9002, { id: 9002, player_id: myId(), cityentity_id: 'Y', state: { __class__: 'ProducingState', next_state_transition_at: now + 3900 } }); // rezerva na pomalejší běh (CI)
      S.taverns = [{ ownerId: 1 }, { ownerId: 2, state: 'alreadyVisited', nextVisitTime: now + 999 }];
      S.resources.guild_expedition_attempt = 4;
      return { win: !!document.querySelector('.foe-reader-win'), txt: viewDay().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
    });
    if (!r.win) throw new Error('přehled se po načtení neotevřel');
    if (!/1 hotovo k vybrání/.test(r.txt) || !/další za 1 h/.test(r.txt) || !/1 k návštěvě/.test(r.txt) || !/pokusy 4/.test(r.txt)) throw new Error(r.txt);
    return errors;
  },
  async 'VB: plán úrovní (cena z metadat, kalibrace, dny)'() {
    const { pg, errors } = await page([startup([{ ...zeus, level: 12, max_level: 14, state: { invested_forge_points: 100, forge_points_for_level_up: 1000 } }])]);
    const r = await pg.evaluate(() => {
      (S.gbCost ||= new Map()).set('X_BronzeAge_Landmark2', [10, 20, 30, 40, 50, 60, 70, 80, 90, 400]);
      S.resources.strategy_points = 500; S.packageFP = 0;
      gbPlan = { id: 11, target: 15 };
      return viewGB().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    });
    // úr. 12 → 13: zbývá 900; formule 400 × 1,025^3 = 431 → kalibrace 1000/431; 13 → 14: ceil(400 × 1,025^4)=442 × k ≈ 1026
    const m = r.match(/12 → 13 ([\d\s ]+) ([\d\s ]+)/);
    if (!m || m[1].replace(/\D/g, '') !== '900') throw new Error('první úroveň: ' + r.slice(r.indexOf('Plán úrovní'), r.indexOf('Plán úrovní') + 300));
    if (!/13 → 14 1\s?026/.test(r) || !/14 → 15 🔒/.test(r)) throw new Error('další úrovně: ' + r.slice(r.indexOf('Plán úrovní'), r.indexOf('Plán úrovní') + 400));
    return errors;
  },
  async 'Statistiky: graf produkce za den, FP ve skladu a úrovní VB'() {
    const { pg, errors } = await page([startup()]);
    const t = await pg.evaluate(() => {
      const D = { own: { '2026-10-01': { gb: [{ id: 'a', l: 5 }], day: { fp: 100, goods: 50 }, fpStock: 900 }, '2026-10-02': { gb: [{ id: 'a', l: 7 }], day: { fp: 120, goods: 60 }, fpStock: 1200 } } };
      const snap = ownSnapshot();
      return { html: viewOwnStats(D), snapDay: !!snap.day, snapStock: snap.fpStock != null };
    });
    if (!/Produkce města za den/.test(t.html) || !/FP ve skladu/.test(t.html) || !/Součet úrovní Velkých budov/.test(t.html) || !/data-statprod="goods"/.test(t.html)) throw new Error(t.html.slice(0, 500));
    if (!t.snapDay || !t.snapStock) throw new Error('snímek: ' + JSON.stringify(t));
    return errors;
  },
  async 'Událost: kolo štěstí – šance, nejvýhodnější hod a odměny, které vzal soused'() {
    const item = (id, name, left, flags = ['common']) => ({ id, reward: { name, flags }, ...(left ? { itemsLeft: left } : {}), __class__: 'FortuneWheelItem' });
    const { pg, errors } = await page([startup(),
      msg('EventPassService.getPreview', { context: 'halloween_event', teaserPrizes: { grandPrizes: [{ totalNeedPoints: 30, currentPoints: 8, reward: { name: 'Sada' } }] } }),
      msg('FortuneWheelService.getFortuneWheel', { items: [item(1, 'Budova', 1, ['rare']), item(2, 'FP', 3), item(3, 'Mince', 4)],
        spins: [{ amount: 1, cost: { resources: { halloween_ticket: 2 } }, gpGain: 2 }, { amount: 3, cost: { resources: { halloween_ticket: 6 } }, gpGain: 7 }], eventLog: [] }),
      msg('FortuneWheelService.updateItem', [{ ...item(1, 'Budova', 0, ['rare']), rewardedPlayer: { name: 'Soused' } }], 'ws')]);
    const t = await pg.evaluate(() => { S.resources.halloween_ticket = 14; return viewEvent().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); });
    // 14 lístků: 2× trojitý hod (14 b.) + 1× jednoduchý (2 b.) = 16 bodů; budovu vzal soused → šance FP 3/7
    if (!/8 \/ 30/.test(t) || !/~16 bodů/.test(t) || !/3× nůž nejvýhodnější/.test(t) || !/FP běžné 3 42,9 %/.test(t) || !/Budova vzácné 0 Soused/.test(t) || !/vzácné už na kole nejsou/.test(t)) throw new Error(t);
    return errors;
  },
  async 'Najít budovu ve městě: klik na název a hledání v okně mapy'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      S.grids.main = { unlocked: [{ x: 0, y: 0, width: 10, length: 6 }], blocked: [] };
      S.ent.set('H_T', { w: 2, l: 2, road: 1, type: 'main_building' }); S.ent.set('P_A', { w: 2, l: 2, road: 1, type: 'production' }); S.ent.set('P_B', { w: 1, l: 1, road: 0, type: 'decoration' });
      S.names.set('P_A', 'Čarodějná věž'); S.names.set('P_B', 'Keř');
      const E = new Map(); let id = 1; const add = (c, x, y) => E.set(id, { id: id++, player_id: myId(), cityentity_id: c, x, y, connected: 1, type: S.ent.get(c).type });
      add('H_T', 0, 0); add('P_A', 3, 0); add('P_A', 6, 3); add('P_B', 9, 5);
      S.entities = E; mapGrid = 'main';
      document.body.insertAdjacentHTML('beforeend', findLink('Čarodějná věž', 'P_A'));
      return true;
    });
    // klik na odkaz v panelu (delegovaný handler je v shadow root panelu – zavoláme přímo jako klik z panelu)
    await pg.evaluate(() => findInCity('P_A'));
    await pg.waitForTimeout(300);
    const a = await pg.evaluate(() => ({ win: !!document.querySelector('#foe-reader-map'), n: mapFindSet(curModel()).size, svg: /animate/.test(document.querySelector('#foe-reader-map').shadowRoot.querySelector('svg').outerHTML) }));
    // hledání podle části názvu bez diakritiky
    await pg.evaluate(() => { const q = document.querySelector('#foe-reader-map').shadowRoot.getElementById('mapq'); q.focus(); q.value = 'carod'; q.dispatchEvent(new Event('input', { bubbles: true })); });
    await pg.waitForTimeout(200);
    const b = await pg.evaluate(() => ({ n: mapFindSet(curModel()).size, chip: document.querySelector('#foe-reader-map').shadowRoot.querySelector('.findbar').textContent }));
    if (!a.win || a.n !== 2 || !a.svg) throw new Error('najít: ' + JSON.stringify(a));
    if (b.n !== 2 || !/nalezeno 2/.test(b.chip)) throw new Error('hledání: ' + JSON.stringify(b));
    return errors;
  },
  async 'Statistiky cechu: řazení podle hodnoty a podle přírůstku, pořadí'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      const me = String(myId());
      // já: nejvíc bodů, ale bez staršího snímku (žádný přírůstek); A a B mají přírůstek
      const D = { guild: { names: { [me]: 'Já', 901: 'A', 902: 'B' }, days: {
        '2026-10-20': { 901: { score: 1000 }, 902: { score: 2000 } },
        '2026-10-27': { [me]: { score: 9000 }, 901: { score: 1500 }, 902: { score: 2100 } } } } };
      S.clan = { members: [me, '901', '902'] };
      const order = () => [...viewGuild(D).matchAll(/data-guildpid="([^"]+)"/g)].map((m) => m[1]).join(',');
      guildSort = 'score'; guildSortD = false; const byVal = order();
      guildSortD = true; const byGain = order();
      guildSortD = false;
      return { byVal, byGain, me };
    });
    if (r.byVal !== `${r.me},902,901`) throw new Error('podle hodnoty: ' + r.byVal);
    if (r.byGain !== `901,902,${r.me}`) throw new Error('podle přírůstku: ' + r.byGain);
    return errors;
  },
  async 'QI: stav (běží / skončily / nezačaly) v Přehledu dne i v okně QI, pamatuje se'() {
    const { pg, errors } = await page([startup([arc])]);
    const r = await pg.evaluate(() => {
      const now = nowServer(), txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      localStorage.removeItem('foeReaderQi'); S.qiState = null; S.resources.guild_raids_action_points = 40;
      const unknown = txt(viewDay());
      H['GuildRaidsService.getState']({ __class__: 'GuildRaidsFinishedState', nextStartsAt: now + 2 * 86400 });
      const fin = { day: txt(viewDay()), qi: txt(viewQI()) };
      S.qiState = null; // po obnovení hry: stav z uloženého
      const stored = txt(viewDay());
      H['GuildRaidsService.getState']({ __class__: 'GuildRaidsRunningState', endsAt: now + 3600 });
      const run = txt(viewDay());
      return { unknown, fin, stored, run };
    });
    if (!/QI stav neznámý/.test(r.unknown) || /QI – akce/.test(r.unknown)) throw new Error('neznámý: ' + r.unknown);
    if (!/QI skončily – další začnou za 1 d 23 h/.test(r.fin.day) || /QI – akce/.test(r.fin.day) || !/platí až pro další QI/.test(r.fin.qi)) throw new Error('skončily: ' + JSON.stringify(r.fin));
    if (!/QI skončily – další začnou za/.test(r.stored)) throw new Error('uložený stav: ' + r.stored);
    if (!/QI – akce 40/.test(r.run) || !/běží, konec za/.test(r.run)) throw new Error('běží: ' + r.run);
    return errors;
  },
  async 'Rating v okně: vyhledávání filtruje hned při psaní, kurzor zůstane v poli'() {
    const { pg, errors } = await page([startup()]);
    await pg.evaluate(() => {
      S.ent.set('P_A', { w: 2, l: 2, road: 1, type: 'production' }); S.ent.set('P_B', { w: 2, l: 2, road: 1, type: 'production' });
      S.names.set('P_A', 'Čarodějná věž'); S.names.set('P_B', 'Kovárna');
      const fp = { current_product: { production_time: 86400, product: { resources: { strategy_points: 5 } } } };
      S.entities.set(801, { id: 801, player_id: myId(), cityentity_id: 'P_A', type: 'production', state: fp });
      S.entities.set(802, { id: 802, player_id: myId(), cityentity_id: 'P_B', type: 'production', state: fp });
      openTabWin('rate');
    });
    await pg.waitForTimeout(300);
    const win = () => pg.evaluate(() => [...document.querySelectorAll('.foe-reader-win')].pop().shadowRoot);
    await pg.evaluate(() => { const q = [...document.querySelectorAll('.foe-reader-win')].pop().shadowRoot.querySelector('[data-input="rateQ"]'); q.focus(); });
    await pg.keyboard.type('kov');
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => { const w = [...document.querySelectorAll('.foe-reader-win')].pop().shadowRoot; return { txt: w.querySelector('.wbody').textContent, focus: w.activeElement?.dataset?.input, val: w.activeElement?.value }; });
    if (!/Kovárna/.test(r.txt) || /Čarodějná/.test(r.txt) || r.focus !== 'rateQ' || r.val !== 'kov') throw new Error(JSON.stringify({ ...r, txt: r.txt.slice(0, 200) }));
    return errors;
  },
  async 'Produkce: zboží rozdělené podle skutečného věku'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      S.player.era = 'IronAge'; S.goodsEra.set('marble', 'BronzeAge'); S.goodsEra.set('cloth', 'IronAge'); S.goodsEra.set('dye', 'BronzeAge');
      const st = (res) => ({ __class__: 'ProducingState', current_product: { production_time: 86400, product: { resources: res } } });
      S.entities.set(701, { id: 701, player_id: myId(), cityentity_id: 'G_A', type: 'goods', state: st({ marble: 10, cloth: 5 }) });
      S.entities.set(702, { id: 702, player_id: myId(), cityentity_id: 'G_B', type: 'goods', state: st({ dye: 7 }) });
      // Archa: zboží do cechovní pokladny (podle věku zboží)
      S.entities.set(703, { id: 703, player_id: myId(), cityentity_id: 'X_Arc', type: 'greatbuilding', state: { __class__: 'ProducingState', current_product: { production_time: 86400, products: [{ goods: [{ good_id: 'cloth', value: 40 }, { good_id: 'marble', value: 2 }] }] } } });
      S.names.set('X_Arc', 'Archa');
      S.names.set('G_A', 'Dílna A'); S.names.set('G_B', 'Dílna B'); cfg.prodBoosted = false;
      const t = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      ptSel.type = 'goods'; ptSel.sort = 'day';
      return { daily: t(viewDaily()), types: t(viewProdTypes()) };
    });
    if (!/Cechovní pokladna 42 1 ↳ Doba železná 40 1 ↳ Doba bronzová 2 1/.test(r.daily)) throw new Error('pokladna: ' + r.daily.slice(0, 400));
    if (!/Zboží – Doba železná \(váš věk\) 5 1/.test(r.daily) || !/Zboží – Doba bronzová 17 2/.test(r.daily)) throw new Error('denní přehled: ' + r.daily.slice(0, 400));
    if (!/Doba železná 5 Doba bronzová 17 Celkem 22/.test(r.types) || !/Dílna A 1 5 10 15/.test(r.types)) throw new Error('podle druhu: ' + r.types.slice(0, 500));
    return errors;
  },
  async 'Rating: rok budovy podle ID, řazení a filtr do roku'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      const ids = ['W_MultiAge_HAL19B3', 'W_MultiAge_GBG2023A', 'W_MultiAge_Expedition22eGold', 'W_MultiAge_WIN25A1', 'P_IronAge_Workshop1'];
      const y = ids.map((i) => entYear(i)?.y ?? null);
      const fp = { current_product: { production_time: 86400, product: { resources: { strategy_points: 5 } } } };
      ids.forEach((c, i) => { S.ent.set(c, { w: 2, l: 2, road: 0, type: 'production' }); S.names.set(c, 'B' + i); S.entities.set(600 + i, { id: 600 + i, player_id: myId(), cityentity_id: c, type: 'production', state: fp }); });
      rateSel.settings = false; rateSel.inv = false; rateSel.sort = 'year'; rateSel.desc = false; rateSel.maxYear = 2022;
      const t = viewRating().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      rateSel.maxYear = 0; rateSel.sort = 'score';
      return { y, t };
    });
    if (JSON.stringify(r.y) !== JSON.stringify([2019, 2023, 2022, 2025, null])) throw new Error('roky: ' + JSON.stringify(r.y));
    if (!/B0 2019 .* B2 2022/.test(r.t) || /B1 |B3 |B4 /.test(r.t)) throw new Error('filtr/řazení: ' + r.t.slice(0, 600));
    return errors;
  },
  async 'Okna: velikost se při znovuotevření nezvětšuje, mapa a kalkulačka se po F5 otevřou, pozice sdílené mezi světy'() {
    const { pg, errors } = await page([startup()]);
    const geo = (sel) => pg.evaluate((s) => { const el = [...document.querySelectorAll(s)].pop(); const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(); }, sel);
    await pg.evaluate(() => openTabWin('rate')); await pg.waitForTimeout(200);
    await pg.evaluate(() => { const w = [...document.querySelectorAll('.foe-reader-win')].pop(); w.style.left = '300px'; w.style.top = '150px'; w.style.width = '640px'; w.style.height = '500px'; });
    await pg.waitForTimeout(200);
    for (let i = 0; i < 3; i++) { await pg.evaluate(() => { closeTabWin('rate'); openTabWin('rate'); }); await pg.waitForTimeout(150); }
    const tab = await geo('.foe-reader-win');
    await pg.evaluate(() => openMapWin()); await pg.waitForTimeout(200);
    await pg.evaluate(() => { mapWin.host.style.width = '700px'; mapWin.host.style.height = '500px'; }); await pg.waitForTimeout(200);
    await pg.evaluate(() => openCalcWin()); await pg.waitForTimeout(200);
    await pg.reload(); await pg.waitForTimeout(2200);
    const after = { tab: await geo('.foe-reader-win'), map: await pg.evaluate(() => !!mapWin && Math.round(mapWin.host.getBoundingClientRect().width)), calc: await pg.evaluate(() => !!calcWin) };
    // sdílení mezi světy: z chrome.storage se převezme místo, otevřené okno zůstane podle tohoto světa
    const merged = await pg.evaluate(async () => {
      const store = { 'geo:foeReaderTabWins': { rate: { x: 10, y: 20, w: 500, h: 400 }, tech: { x: 50, y: 60, w: 450, h: 300 } } };
      window.chrome.storage = { local: { get: async () => store, set: async (o) => Object.assign(store, o) } };
      await geoLoad();
      const c = JSON.parse(localStorage.getItem('foeReaderTabWins'));
      geoSave('foeReaderTabWins', c);
      delete window.chrome.storage;
      return { c, shared: store['geo:foeReaderTabWins'] };
    });
    if (tab !== '300,150,640,500') throw new Error('velikost se mění: ' + tab);
    if (after.tab !== '300,150,640,500' || after.map !== 700 || !after.calc) throw new Error('po F5: ' + JSON.stringify(after));
    if (merged.c.rate.x !== 10 || merged.c.rate.open !== true || merged.c.tech.open !== false || 'open' in merged.shared.rate) throw new Error('sdílení: ' + JSON.stringify(merged));
    return errors;
  },
  async 'Nához: místo obsazené s menším vkladem je obsazené (ne v textu do vlákna)'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      cfg.arcFactor = 1.9;
      const ent = { cityentity_id: 'X_BronzeAge_Landmark2', level: 10, state: { forge_points_for_level_up: 2000, invested_forge_points: 150 } };
      const rows = [
        { rank: 1, player: { player_id: 5, name: 'Jan' }, forge_points: 100, reward: { strategy_point_amount: 200 } },
        { rank: 2, reward: { strategy_point_amount: 100 } },
        { rank: null, player: { player_id: 9, name: 'Majitel' }, forge_points: 50 },
      ];
      const c = nahozCalc(rows, ent, 'Majitel');
      return { text: c.text, p1: { filled: c.places[0].filled, short: c.places[0].short }, html: viewNahoz(c, 'x').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
    });
    if (/P1\(/.test(r.text) || !/P2\(190\)/.test(r.text)) throw new Error('text: ' + r.text);
    if (!r.p1.filled || !r.p1.short || !/Jan 100 \(o 280 méně\)/.test(r.html)) throw new Error(JSON.stringify(r));
    return errors;
  },
  async 'GBG: opotřebení klesne, až se dostaví budovy v sousední naší provincii'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      const now = nowServer();
      S.gbg = { map: { id: 'volcano_archipelago', provinces: [
        { id: 0, ownerId: 1, usedBuildingSlots: 2, totalBuildingSlots: 3 },
        { id: 1, ownerId: 2, gainAttritionChance: 80, victoryPoints: 10 },
      ] }, currentParticipantId: 1, endsAt: now + 86400, battlegroundParticipants: [{ participantId: 1, clan: { name: 'My' } }, { participantId: 2, clan: { name: 'Oni' } }] };
      // A1 (0) sousedí s B1 (1); v A1 stojí strážní věž (hotová) a staví se obléhací tábor (−52 %) za 2 h
      H['GuildBattlegroundBuildingService.getBuildings']({ provinceId: 0, placedBuildings: [{ id: 'watchtower' }, { id: 'guild_fieldcamp', readyAt: now + 7200 }] });
      const plan = gbgAttritionPlan(S.gbg.map.provinces[1], now);
      const html = viewProvinces(S.gbg.map.provinces, 1, (id) => (id === 2 ? 'Oni' : 'My'), now).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return { plan, html };
    });
    if (r.plan.now !== 80 || r.plan.steps.length !== 1 || r.plan.steps[0].chance !== 28) throw new Error(JSON.stringify(r.plan));
    if (!/80 % → 28 % za 2 h/.test(r.html)) throw new Error(r.html.slice(0, 600));
    return errors;
  },
  async 'Kalkulačka cizí VB: obsazená místa jsou vidět (kdo drží, obsazeno / jisté)'() {
    const { pg, errors } = await page([startup()]);
    const r = await pg.evaluate(() => {
      const me = myId();
      S.players.set(77, { name: 'Majitel' });
      S.foreignGB = { player_id: 77, cityentity_id: 'X_SpaceAgeTitan_Landmark1', level: 76, state: { forge_points_for_level_up: 75032, invested_forge_points: 51941 } };
      const rw = (fp) => ({ strategy_point_amount: fp, resources: {} });
      S.gbRanking = { rankings: [
        { rank: 1, player: { player_id: 101, name: 'Kelly' }, forge_points: 21745, reward: rw(10927) },
        { player: { player_id: 77, name: 'Majitel' }, forge_points: 15269 },
        { rank: 2, player: { player_id: 102, name: 'Wazari' }, forge_points: 10380, reward: rw(5463) },
        { rank: 3, player: { player_id: 103, name: 'Vili' }, forge_points: 3642, reward: rw(1821) },
        { rank: 4, player: { player_id: me, name: 'Já' }, forge_points: 905, reward: rw(455) },
        { rank: 5, player: {}, reward: rw(91) },
      ] };
      const html = foreignCalcHtml();
      const rows = [...html.matchAll(/<tr class="([^"]*)"[^>]*><td>(\d)\./g)].map((m) => `${m[2]}:${m[1]}`);
      return { rows, txt: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
    });
    if (r.rows.slice(0, 3).join() !== '1:taken,2:taken,3:taken') throw new Error('obsazená: ' + r.rows.join());
    if (!/Kelly 21 745/.test(r.txt) || !/obsazeno \(\+21 966\)/.test(r.txt) || !/volné/.test(r.txt)) throw new Error(r.txt.slice(0, 700));
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
