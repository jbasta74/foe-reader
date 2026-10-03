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

## Hospody – průběžně
- WebSocket `FriendsTavernService.getSittingPlayersCount` = `[majitel, židlí, obsazeno]`. Chodí i pro vlastní hospodu (majitel = vy) a pro přátele.

## Produkce budov
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
