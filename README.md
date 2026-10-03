# FoE Reader 0.3.12

Rozšíření pro Chrome (Manifest V3), které **pouze čte** komunikaci Forge of Empires.
Nic neodesílá a nic nemění.

## Instalace
1. Otevřete `chrome://extensions`.
2. Vpravo nahoře zapněte **Režim pro vývojáře**.
3. Klikněte na **Načíst rozbalené** a vyberte tuto složku (`foe-reader`).
4. Otevřete hru nebo ji obnovte (F5). Nahoře se objeví plovoucí tlačítko **⠿ FoE Reader**. Kliknutím panel otevřete, tažením ho přesunete a pozice se zapamatuje.

Po každé úpravě kódu klikněte v `chrome://extensions` na ikonu obnovení u rozšíření a znovu načtěte hru.

## Vydání
Každá změna verze v `manifest.json` na větvi `main` automaticky vytvoří vydání (GitHub Actions, `.github/workflows/release.yml`): tag `v<verze>`, ZIP s rozšířením a seznam změn. Hotový ZIP je v záložce **Releases**.

## Soubory
- `manifest.json`: vkládá dva skripty do `https://*.forgeofempires.com/game/*`.
- `inject.js`: běží v kontextu stránky (`world: MAIN`) ještě před hrou. Obaluje `XMLHttpRequest`, `fetch` a `WebSocket` a přeposílá naparsované odpovědi (a ke čtení i odchozí dotazy hry, např. kterou VB hráč otevřel) z `/game/json?h=`, `/start/metadata?id=` a `wss://…/socket/` přes `window.postMessage`.
- `provinces.js`: názvy a sousednost provincií GBG pro obě mapy (statická data převzatá z FoE Helperu, AGPL-3.0).
- `panel.js`: běží v izolovaném světě. Třídí zprávy podle `requestClass.requestMethod` (objekt `H`), drží stav a kreslí panel ve Shadow DOM.

## Záložky
- **Moje VB**: úroveň, vloženo/potřeba, kolik FP chybí. Po otevření vlastní VB ve hře **kalkulačka náhozů**: P1–P5 × koeficient (předvolby 1,8–2,0 nebo vlastní hodnota, pamatuje se; odměny se čtou živě ze serveru, takže platí pro beta i ostré servery), vlastní podíl a text do vlákna (`jiricek Galata Tower 77→78 P1(1083) P2(542) …`) s tlačítkem Kopírovat.
- **VB přátel**: po otevření cizí VB ukáže, kolik FP chybí, odměny s bonusem Archy, cenu zajištění místa a zisk.
- **Produkce**: co se vyrábí, souhrn FP/mincí/zásob/medailí/zboží za aktuální cyklus a kdy bude hotovo.
- **Bonusy**: útok a obrana útočníka i obránce podle oblasti (Všude, GBG, Expedice, QI) a ostatní bonusy.
- **GBG**: cechy na mapě, kde útočíme a kde útočí na nás včetně rychlosti postupu za 1 a 5 minut (pozná se, jestli v provincii jede někdo s vámi), aktivita členů (přírůstek bitev, vyjednávání a opotřebení od minulého otevření žebříčku), opotřebení (úroveň, bonus obránců, násobitel vyjednávání, reset, počet bitev do zvolené úrovně), tabulka provincií s časem odemknutí, názvy (D4C…), označením provincií sousedících s našimi a ☆ pro sledování, žebříček členů.
- **Hospody**: vaše hospoda (obsazenost), volné židle u přátel, znovu dostupné hospody.
- **Suroviny**, **Log**.
- **Sklad**: zboží všech věků (po věcích, se součtem a zvýrazněním nejslabšího zboží) a části (fragmenty) – kolik máte, kolik je potřeba, kolikrát jde sestavit a co chybí.
- **🔔 Upozornění**: historie upozornění a nastavení.
- **ℹ️ O rozšíření**: verze, odkazy na GitHub (kód, vydání, hlášení chyb).

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
| 🏭 Hotová produkce | dokončí se najednou aspoň N budov hlavního města (výchozí 20) |
| 🏭 Osada / Kvantové invaze | doběhne časovač další hotové produkce (`outpostProduction`) |

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
