# FoE Reader 0.3.2

Rozšíření pro Chrome (Manifest V3), které **pouze čte** komunikaci Forge of Empires.
Nic neodesílá a nic nemění.

## Instalace
1. Otevřete `chrome://extensions`.
2. Vpravo nahoře zapněte **Režim pro vývojáře**.
3. Klikněte na **Načíst rozbalené** a vyberte tuto složku (`foe-reader`).
4. Otevřete hru nebo ji obnovte (F5). Nahoře se objeví plovoucí tlačítko **⠿ FoE Reader**. Kliknutím panel otevřete, tažením ho přesunete a pozice se zapamatuje.

Po každé úpravě kódu klikněte v `chrome://extensions` na ikonu obnovení u rozšíření a znovu načtěte hru.

## Soubory
- `manifest.json`: vkládá dva skripty do `https://*.forgeofempires.com/game/*`.
- `inject.js`: běží v kontextu stránky (`world: MAIN`) ještě před hrou. Obaluje `XMLHttpRequest`, `fetch` a `WebSocket` a přeposílá naparsované odpovědi z `/game/json?h=`, `/start/metadata?id=` a `wss://…/socket/` přes `window.postMessage`.
- `provinces.js`: názvy a sousednost provincií GBG pro obě mapy (statická data převzatá z FoE Helperu, AGPL-3.0).
- `panel.js`: běží v izolovaném světě. Třídí zprávy podle `requestClass.requestMethod` (objekt `H`), drží stav a kreslí panel ve Shadow DOM.

## Záložky
- **Moje VB**: úroveň, vloženo/potřeba, kolik FP chybí.
- **VB přátel**: po otevření cizí VB ukáže, kolik FP chybí, odměny s bonusem Archy, cenu zajištění místa a zisk.
- **Produkce**: co se vyrábí, souhrn FP/mincí/zásob/medailí/zboží za aktuální cyklus a kdy bude hotovo.
- **Bonusy**: útok a obrana útočníka i obránce podle oblasti (Všude, GBG, Expedice, QI) a ostatní bonusy.
- **GBG**: cechy na mapě, kde útočíme a kde útočí na nás, opotřebení (úroveň, bonus obránců, násobitel vyjednávání, reset, počet bitev do zvolené úrovně), tabulka provincií s časem odemknutí, názvy (D4C…), označením provincií sousedících s našimi a ☆ pro sledování, žebříček členů.
- **Hospody**: vaše hospoda (obsazenost), volné židle u přátel, znovu dostupné hospody.
- **Suroviny**, **Log**.
- **🔔 Upozornění**: historie upozornění a nastavení.

## Upozornění
Při upozornění zapípá zvuk a tlačítko začne blikat s počtem nových zpráv. Zvuk prohlížeč povolí až po prvním kliknutí do stránky.

| Upozornění | Kdy |
|---|---|
| ⚔️ Útok na naši provincii | někdo jiný začne dobývat naši provincii |
| ⚔️ Provincie skoro ztracená | útočník přesáhne 75 % |
| ⚔️ Ztráta / dobytí provincie | změní se majitel |
| ⚔️ Sledovaná provincie | X minut před odemknutím (☆ v záložce GBG, výchozí 1 min) |
| 🍺 Uvolněná židle | u přítele s plnou hospodou se uvolní místo |
| 🍺 Znovu k návštěvě | uplyne čas od poslední návštěvy |
| 🍺 Moje hospoda plná | lze vybrat stříbro |
| 🏭 Hotová produkce | dokončí se najednou aspoň N budov (výchozí 20) |

Vše jde vypnout v záložce 🔔. Nastavení a sledované provincie se ukládají v prohlížeči (`localStorage`).

## Jak přidat nový handler
V `panel.js` doplňte do objektu `H` klíč ve tvaru `"Služba.metoda"`:

```js
'GuildBattlegroundService.getBattleground'(d) {
  S.gbg = d;
}
```

Klíče a tvar dat najdete v záložce **Log zpráv**, kde stačí kliknout na řádek. Celý záznam lze stáhnout jako JSON.

## Poznámky
- Odpovědi chodí v dávkách: k jednomu požadavku se může přibalit víc zpráv (např. `TimeService.updateTime`).
- Stav hospody: bez `state` = volná židle, `isSitting` = už tam sedíte, `noChair` = plno, `alreadyVisited` = navštíveno (`nextVisitTime`).
- Při běhu spolu s FoE Helperem se oba odposlechy řetězí a navzájem si nevadí.
