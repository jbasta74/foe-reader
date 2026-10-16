# FoE Reader 0.3.38

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
Hlavní panel se dá roztáhnout oběma směry za pravý dolní roh, velikost se pamatuje. V záložce **ℹ️** lze vypnout záložky, které nepoužíváte (VB, Upozornění a ℹ️ zůstávají vždy); data se sbírají dál. Každou záložku lze tlačítkem **⧉** (vpravo v liště záložek) otevřít v samostatném okně. Okna jdou přesouvat a zvětšovat, kliknuté okno jde dopředu a otevřená okna se po F5 obnoví na stejném místě.

- **VB** (vlastní i cizí Velké budovy v jedné záložce): nahoře kalkulačka naposledy otevřené budovy – u vlastní **náhozy** P1–P7 × koeficient (předvolby 1,8–2,0, tlačítko Arc podle bonusu Archy nebo vlastní hodnota), vlastní podíl a text do vlákna (`Hráč Galata Tower 77→78 P1(1083) P2(542) …`, jméno hráče se bere ze hry); u cizí kolik FP chybí, odměny s bonusem Archy, cena zajištění místa a zisk. Pod tím přehled vlastních VB (úroveň, vloženo/potřeba, stupeň 🥉/🥇) a přehled VB naposledy navštíveného hráče.
- **Kalkulačka VB v okně**: jedno plovoucí okno pro vlastní i cizí VB – ukazuje vždy naposledy otevřenou budovu (náhozy, zajištění míst, zisk, text do vlákna). Může se otevírat samo s otevřením budovy ve hře (přepínač „otevírat samo“ v okně nebo v záložce Upozornění).
- **Produkce**: co se vyrábí, souhrn FP/mincí/zásob/medailí/zboží za aktuální cyklus a kdy bude hotovo. Po otevření osady ve hře i přehled osady: suroviny, další odemčení (co chybí), kdy bude která produkce hotová, stojící a nepřipojené budovy. Dole je tabulka **Limitované budovy**: kdy která vyprší a co máte ve skladu na obnovu (sada, hotová budova, fragmenty).
- **Bonusy**: útok a obrana útočníka i obránce podle oblasti (Všude, GBG, Expedice, QI) a ostatní bonusy.
- **GBG**: cechy na mapě, kde útočíme a kde útočí na nás včetně rychlosti postupu za 1 a 5 minut (pozná se, jestli v provincii jede někdo s vámi), aktivita členů (přírůstek bitev, vyjednávání a opotřebení od minulého otevření žebříčku), opotřebení (úroveň, bonus obránců, násobitel vyjednávání, reset, počet bitev do zvolené úrovně), tabulka provincií s časem odemknutí, názvy (D4C…), označením provincií sousedících s našimi a ☆ pro sledování, žebříček členů.
- **Mapa**: plánek města nebo osady – cesty, budovy podle potřeby cesty, volná pole, slepé cesty, budovy bez potřeby cesty stojící u cesty, nepřipojené budovy. Log ke stažení obsahuje i rozměry budov. Tlačítkem „Otevřít v okně“ se mapa otevře v samostatném okně: přesun za hlavičku, změna velikosti za roh, zoom kolečkem nebo +/−, posun tažením; při přiblížení se ukazují názvy budov.
- **Příhody**: příhody ve městě jako karty s obrázky (co, kde, vzácnost, kdy zmizí) i ty, které se teprve objeví; deník vybraných odměn s denním souhrnem. Obsah odměny server prozradí až po vybrání.
- **Vyjednávání**: při vyjednávání na expedici ukáže dosavadní tahy a navrhne další (vyřazuje nemožné kombinace). Jen radí, tah zadáváte ve hře sami; v GBG je vypnuté.
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
| 🤝 Obchod | někdo vzal vaši nabídku na trhu (tiše, jen zápis; zvuk lze zapnout); vypršené nabídky sloučené do jednoho řádku |
| 🏛️ Příspěvek do mé VB | někdo vložil FP do vaší Velké budovy (tiše) |
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

## Licence a poděkování
FoE Reader je svobodný software pod licencí **GNU AGPL-3.0** (viz [LICENSE](LICENSE)). Smíte ho používat, upravovat a šířit; upravené verze musí zůstat pod stejnou licencí a se zdrojovým kódem.

Část dat a postupů vychází z projektu [FoE Helper](https://github.com/mainIine/foe-helfer-extension) (AGPL-3.0): názvy a sousednost provincií GBG (`provinces.js`), obrázky příhod (`img/incidents`), způsob načítání ikon zboží z CDN hry a struktura dat vyjednávání. Děkujeme jeho autorům.

Forge of Empires je ochranná známka společnosti InnoGames GmbH. Toto rozšíření s InnoGames nijak nesouvisí, nic neposílá na herní server a pouze čte data, která hra sama přijímá.
