# FoE Reader: poznatky o komunikaci Forge of Empires

Ověřeno na datech svět zz1, 1. 10. 2026. Rozšíření `foe-reader` (v0.2.5) jen čte, nic neodesílá.

## Kanály
- `POST /game/json?h=…`: tělo je pole `{requestClass, requestMethod, requestData, requestId}`, odpověď pole `{requestClass, requestMethod, responseData}`. **Dávky:** k jednomu požadavku může přijít víc zpráv (třeba `TimeService.updateTime` ke každému). Třídit podle odpovědi.
- `wss://…/socket/`: chat, soukromé zprávy, `GuildBattlegroundService.getProvinces` (průběžné změny provincií), PING/PONG.
- CDN `start/metadata?id=…`: statické definice (budovy se načítají postupně, `building_entity_<id>` obsahuje `name`).

## Klíčové zprávy
| Zpráva | Obsah |
|---|---|
| `StartupService.getData` | `user_data`, `city_map.entities` (vše ve městě), `goodsList` (zboží → věk) |
| `ResourceService.getPlayerResourceBag` | `resources.resources` (FP = `strategy_points`, diamanty = `premium`) |
| `BoostService.getAllBoosts` | Boost[] `{type, value, targetedFeature, origin, entityId, expireTime?}`; **bez bonusů VB** |
| `OtherPlayerService.getSocialList` | friends / guildMembers / neighbours |
| `FriendsTavernService.getOtherTavernStates` | bez `state` = volno, `isSitting`, `noChair`, `alreadyVisited` (+`nextVisitTime`) |
| `GreatBuildingsService.getOtherPlayerOverview` | `GreatBuildingContributionRow[]`: `current_progress`, `max_progress`, `maxLevel`; u vlastního vkladu `rank`, `forge_points`, `reward` |
| `OtherPlayerService.getOtherPlayerCityMapEntity` | cizí VB (CityMapEntity) |
| `GreatBuildingsService.getConstruction` | `rankings[]` (`GreatBuildingRankingRow`, `player.is_self`, `reward.strategy_point_amount`). **Řádek majitele (bez `rank`) je jen tehdy, když má majitel vloženo > 0 FP.** Budova: `reward.blueprintRewards[0].building_id`. Cizí VB předchází `getOtherPlayerCityMapEntity`, vlastní ne. Dotaz: `requestData = [entityId, playerId]` |
| `GreatBuildingsService.contributeForgePoints` | po vkladu: nové `GreatBuildingRankingRow[]`; následuje `CityMapService.reset` (aktualizovaná VB) a znovu overview |
| `GreatBuildingsService.getAvailablePackageForgePoints` | `[n]` = FP v balíčcích v inventáři |
| `InventoryService.getItems` | inventář; FP balíčky mají `item.__class__ = ForgePointPackagePayload`, `item.resource_package.gain` (10, 100…) a `inStock`. Součet gain × inStock = hodnota výše (ověřeno) |
| `InventoryService.getItems` (části) | `item.__class__ = FragmentItemPayload`, `item.reward.requiredAmount` (potřeba na sestavení), `item.reward.assembledReward` (`name`, `type`), `inStock` |
| `InventoryService.updateItem` | `{id, amount}` – nový počet kusů položky (např. po vložení FP) |
| `CityProductionService.startProduction` | `updatedEntities[]` |
| `GuildBattlegroundService.getBattleground` | `map.provinces[]` (id 0 chybí), `battlegroundParticipants[]`, `currentParticipantId`, `endsAt`, `currentPlayerParticipant.attrition` |

## GBG – provincie a opotřebení
- `map.provinces[]`: `lockedUntil` (čas odemknutí), `ownerId`, `gainAttritionChance` (100/60/20 %; u vlastních provincií chybí), `isAttackBattleType`, `victoryPoints`, `conquestProgress[]` (`participantId`, `progress`, `maxProgress`). **Názvy provincií v datech nejsou** – jen `id` (provincie 0 nemá `id`). Převod id → název a sousednost je v `provinces.js` (převzato z FoE Helperu, `province_map.js`; ověřeno: 30 = D4C na `waterfall_archipelago`).
- Změny provincií chodí přes WebSocket `GuildBattlegroundService.getProvinces` (jen změněná pole).
- Opotřebení: `currentPlayerParticipant.attrition` = `{level, negotiationMultiplier, defendingArmyBonus}` (`__class__: GuildBattlegroundAttrition`). Čas resetu: `TimerService.getTimers` → `type: "battlegroundsAttrition"`.

- Žebříček členů `GuildBattlegroundService.getPlayerLeaderboard` (přijde jen po otevření ve hře): `[{player:{player_id,name}, battlesWon, negotiationsWon, attrition}]`. **Per-hráč postup v provinciích server neposílá** – `conquestProgress` je jen za cech.

## Události od hráčů
- WebSocket `OtherPlayerService.newEvent` (ověřeno pro `trade_offer_expired` – `offer`/`need` jako `CityGood`, bez `other_player`; `trade_accepted` podle FoE Helperu, v logách zatím nebyl). Po každé události chodí přes WS i nový `ResourceService.getPlayerResourceBag`. Tvar: `{id, type, other_player{name}, …}`; `trade_accepted` má `offer{good_id,value}` a `need{good_id,value}`, `great_building_contribution` má `great_building_name`, `level`, `rank`.
- Historie: `OtherPlayerService.getEventsPaginated` → `{events[]}` se stejnými typy (`social_interaction`, `friend_tavern_sat_down`, …) a textovým `date`.

## Hospody – průběžně
- WebSocket `FriendsTavernService.getSittingPlayersCount` = `[majitel, židlí, obsazeno]`. Chodí i pro vlastní hospodu (majitel = vy) a pro přátele.

## Osada (cultural_outpost)
- `CityMapService.getCityMap` (dotaz `["cultural_outpost"]`): `{gridId, entities[]}` – budovy osady; ID ve tvaru `X_<Kultura>_…` (Aztecs, Vikings, Japanese, Egyptians, Mughals, Polynesia, Pirates). Typy: `main_building`, `residential`, `diplomacy`, `cultural_goods_production`, `impediment`, `street`.
- Produkt zboží osady: `current_product.resources.resources` (+ `requirements.cost`), ostatní `current_product.product.resources`.
- `OutpostService.getAll`: osady; aktivní má `startedAt` bez `finishedAt`, `primaryResourceId`, `goodsResourceIds`, `completedPlaythroughs`.
- `AdvancementService.getAll`: cíle osady `{name, isUnlocked, requirements.resources}`.
- Suroviny osady jsou v běžném `getPlayerResourceBag` (cocoa_beans, diplomacy, …). Názvy surovin: `ResourceService.getResourceDefinitions`.
- Časovač `outpostProduction` = čas nejbližší hotové produkce (ověřeno proti budovám).

## Produkce budov
- `StartupService.getData.city_map` obsahuje jen hlavní město (`gridId: main`). Budovy osady ani QI při načtení nechodí.
- `TimerService.getTimers`: `{gridId: cultural_outpost | guild_raids, type: outpostProduction, time}` – `time` je počet **sekund** do další hotové produkce (relativní); u ostatních časovačů je `time` absolutní unix čas.
- Speciální budovy: `state.productionOption.products[]`: `ResourceProduct.playerResources`, `GuildResourceProduct.guildResources`, `GenericRewardProduct.reward` (`isRandom`), příznak `onlyWhenMotivated`.
- VB a radnice: `state.current_product` (`products[]` s `product.resources` nebo `goods` = cechovní pokladna).

## Bonusy armády (ověřeno proti radnici, sedí všech 16 hodnot)
Součet = `getAllBoosts` (feature `all` + feature oblasti) **+ pasivní bonusy vlastních VB** z `city_map.entities[].bonuses` s `bonusCategory.value = "passiveBonus"`.

| Typ bonusu VB | Útok útoč. | Obrana útoč. | Útok obr. | Obrana obr. |
|---|---|---|---|---|
| military_boost | ✓ | ✓ | | |
| advanced_tactics | ✓ | ✓ | ✓ | ✓ |
| fierce_resistance | | | ✓ | ✓ |
| attacker_defense_boost | | ✓ | | |
| defender_attack_boost | | | ✓ | |
| defense_boost | | | | ✓ |

- Kvantové invaze: platí **jen** bonusy s `targetedFeature: "guild_raids"`, ne „all“.
- Radnice u Expedice ukazuje `defense_boost` Sochy Dia (+2 %) vedle součtu, ne v něm.
- FoE Helper bonusy VB nezapočítává. Hlášení s daty bylo odesláno na GitHub (mainIine/foe-helfer-extension), 1. 10. 2026.

## Odměny za příspěvky do VB (rework, beta od 2. 10. 2026)
Zdroj: InnoGames support „Great Buildings Prestige: Contribution Rewards Rework“; ověřeno na datech (Galata 78, Terracotta 95, HYDRA 60).
- Přispěvatelům jde podíl z ceny úrovně podle úrovně VB: 1–9: 25 %, 10–39: 30 %, 40–69: 40 %, 70–100: 25 %, 101–200: 15 %, 201–300: 10 %, 301–400: 7 %.
- Dělení mezi místa: P1 58,25 %, P2 29,13 %, P3 9,71 %, P4 2,43 %, P5 ≈ 0,5 % (zaokrouhleno na 5). Zlatý stupeň: 7 míst (P6 0,08 %, P7 0,01 %).
- Bonus Archy: do úrovně 200 až ×2, od 201 jen ×1,6 (10 % → 16 %, 7 % → 11,2 %).
- Ceny úrovní se 2. 10. neměnily (11 VB porovnáno 1. 10. vs 2. 10.); proti ostrým serverům jsou ale na betě vyšší.
- Rozšíření odměny nepočítá, čte je ze serveru (`reward.strategy_point_amount`).

## Kalkulátor míst ve VB
Zajistit místo i: `x = ceil((zbývá + FP_držitele_bez_mě − můj_vklad) / 2)`, zisk = `round(odměna × (1 + Archa%/100)) − x − můj_vklad`. Bonus Archy: `bonuses[].type = "contribution_boost"` u `X_FutureEra_Landmark1`.

## Upravená kopie FoE Helperu (soukromá, od 5. 10. 2026)
Základ: FoE Helper 4.8.3.0 (commit f24d1fd). Balíček `foe-helper-jb1.zip`, patch `foe-helper-army-boosts.patch`. Tři příčiny špatných bonusů armády v `js/web/boosts/js/boosts.js` a `js/web/profile/js/profile.js`:
1. `InitLB` zahazoval `targetedFeature` u bonusů VB a `Mapper` neznal `attacker_defense_boost`, `defender_attack_boost`, `defense_boost` → oblastní bonusy VB (Archa v GBG, Château v Expedici…) se nesčítaly.
2. `TimeIn.add` volal `Boosts.Remove([{entityId}])`, což smazalo i bonusy spojence umístěného v budově (u budov s `decaysAt`); zpět se přidaly jen bonusy budovy.
3. Profil bral bonusy QI z `noSettlement` (bez budov osady QI), hra je počítá.
Ověřeno simulací na datech z 1. 10.: původní kód = čísla FoE Helperu (16/16), opravený = čísla radnice (16/16). Při nové verzi FoE Helperu je potřeba patch přenést znovu.

## Limitované (pozvednuté) budovy
- Aktivní: `CityMapEntity.state.decaysAt` (unix čas vypršení).
- Vypršelá: `CityMapEntity.decayedFromCityEntityId` = ID pozvednuté verze; `cityentity_id` je už základní budova.
- Sada na pozvednutí: metadata `building_upgrades`, položka s `upgradeItem.id` `upgrade_kit_ascended_*`, jejíž poslední `upgradeSteps[].buildingIds` obsahuje pozvednutou budovu. V inventáři `UpgradeKitPayload.upgradeItemId`, fragmenty `FragmentItemPayload.reward.assembledReward.id`.
- Budovy bez sady (Forgotten Temple, Tourney Grounds) se nahrazují novým kusem z inventáře (`BuildingItemPayload.cityEntityId`).

## Stupně VB (měď / stříbro / zlato)
- Stupeň není v `CityMapEntity`; určuje se z metadat `great_building_tiers`: `[{tier:{value:'copper'|'silver'|'gold'}, name, startLevel, endLevel}]`.
- Rozsahy se mohou překrývat; pro stavbu úrovně L→L+1 platí nejvyšší stupeň, jehož rozsah obsahuje L+1.
- Beta 8. 10. 2026: stříbro zrušeno, nad úr. 100 zlato se 7 odměňovanými místy (podle hráče; metadata ověřit).

## Bonus příspěvků (Archa) po přestavbě VB (beta 10/2026)
- Zdroj: https://support.innogames.com/kb/ForgeOfEmpires/en_DK/6992/Great-Buildings-Prestige-redesigned-the-feature-overview
- Archa má dva bonusy v `bonuses`: `contribution_boost` (měděný, platí pro stavbu úrovní ≤ 100) a `contribution_boost_gold` (zlatý, úrovně > 100). Zlatý dává i Shattered Horizon Siphon – sčítat ze všech budov.
- Rozhoduje úroveň, do které se vkládá (cílová = level + 1).
- Podíl přispěvatelů z ceny úrovně: 1–9 25 %, 10–39 30 %, 40–69 40 %, 70–100 25 %, 101–200 15 %, 201–300 10 %, 301–400 7 %, 401–500 5 %.
- Rozdělení podle místa: měď 58,25 / 29,13 / 9,71 / 2,43 / 0,49 %; zlato 7 míst 58,20 / 29,10 / 9,70 / 2,42 / 0,48 / 0,08 / 0,01 %. Stříbro zrušeno, plánky z příspěvků −60 %.
- Ověřeno v logu 8. 10.: Archa úr. 180 měď 99 %, zlato 19 %; Observatory 132→133 P1 = 4 645 FP (15 % z 53 236 × 58,2 %).
- Zaokrouhlení (log 10. 10.): základní odměny ze serveru jsou po 5 (round na nejbližší 5, např. 1660,5 × 58,25 % = 967 → 965). Odměnu s bonusem Archy hra (prasátko) zaokrouhluje také na 5: 175 × 1,99 = 348,25 → 350, 40 × 1,99 → 80, 10 × 1,99 → 20.
