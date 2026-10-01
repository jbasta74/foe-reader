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
| `GreatBuildingsService.getConstruction` | `rankings[]` (`GreatBuildingRankingRow`, `player.is_self`, `reward.strategy_point_amount`) |
| `GreatBuildingsService.contributeForgePoints` | po vkladu: nové `GreatBuildingRankingRow[]`; následuje `CityMapService.reset` (aktualizovaná VB) a znovu overview |
| `GreatBuildingsService.getAvailablePackageForgePoints` | `[n]` = FP v balíčcích v inventáři |
| `CityProductionService.startProduction` | `updatedEntities[]` |
| `GuildBattlegroundService.getBattleground` | `map.provinces[]` (id 0 chybí), `battlegroundParticipants[]`, `currentParticipantId`, `endsAt`, `currentPlayerParticipant.attrition` |

## GBG – provincie a opotřebení
- `map.provinces[]`: `lockedUntil` (čas odemknutí), `ownerId`, `gainAttritionChance` (100/60/20 %; u vlastních provincií chybí), `isAttackBattleType`, `victoryPoints`, `conquestProgress[]` (`participantId`, `progress`, `maxProgress`). **Názvy provincií v datech nejsou** – jen `id` (provincie 0 nemá `id`).
- Změny provincií chodí přes WebSocket `GuildBattlegroundService.getProvinces` (jen změněná pole).
- Opotřebení: `currentPlayerParticipant.attrition` = `{level, negotiationMultiplier, defendingArmyBonus}` (`__class__: GuildBattlegroundAttrition`). Čas resetu: `TimerService.getTimers` → `type: "battlegroundsAttrition"`.

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

## Kalkulátor míst ve VB
Zajistit místo i: `x = ceil((zbývá + FP_držitele_bez_mě − můj_vklad) / 2)`, zisk = `round(odměna × (1 + Archa%/100)) − x − můj_vklad`. Bonus Archy: `bonuses[].type = "contribution_boost"` u `X_FutureEra_Landmark1`.
