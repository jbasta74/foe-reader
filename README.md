# FoE Reader

[![Poslední verze](https://img.shields.io/github/v/release/jbasta74/foe-reader?label=verze)](https://github.com/jbasta74/foe-reader/releases/latest) [![Ko-fi](https://img.shields.io/badge/Ko--fi-podpořit-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/jbasta74)

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
- `manifest.json`: vkládá skripty do `https://*.forgeofempires.com/game/*`.
- `inject.js`: běží v kontextu stránky (`world: MAIN`) ještě před hrou. Obaluje `XMLHttpRequest`, `fetch` a `WebSocket` a přeposílá naparsované odpovědi (a ke čtení i odchozí dotazy hry, např. kterou VB hráč otevřel) z `/game/json?h=`, `/start/metadata?id=` a `wss://…/socket/` přes `window.postMessage`.
- `provinces.js`: názvy a sousednost provincií GBG pro obě mapy (statická data převzatá z FoE Helperu, AGPL-3.0).
- `nego-solver-helper.js`, `nego.js`: pomocník vyjednávání (přesný řešič z FoE Helperu, AGPL-3.0, a vlastní odhad).
- `stats.js`: úložiště statistik a nastavení (chrome.storage, vybraná složka, synchronizace).
- `i18n.js`: anglický překlad panelu (ℹ️ → Jazyk / Language).
- `panel-*.js`: panel, běží v izolovaném světě a sdílí jeden globální rozsah (načítají se v pořadí z manifestu):
  `panel-core.js` (stav, třídění zpráv podle `requestClass.requestMethod` v objektu `H`, vyjednávání, příhody, upozornění, oznámení Chromu),
  `panel-city.js` (mapa města, okna kalkulačky a mapy), `panel-production.js` (bonusy, produkce, denní přehled, rating),
  `panel-gb.js` (kalkulačky VB), `panel-gbg.js` (GBG a jeho mapa), `panel-tabs.js` (upozornění, sklad, statistiky, expedice, QI),
  `panel-stats.js` (grafy, cech, záložky), `panel-ui.js` (panel, lišta, okna, vykreslování).
- `background.js`: service worker rozšíření – systémová oznámení Chromu a jejich plánování (chrome.alarms).
- `test/`: automatické testy (viz Testy).

## Záložky
Hlavní panel se dá roztáhnout oběma směry za pravý dolní roh, velikost se pamatuje. V záložce **ℹ️** lze vypnout záložky, které nepoužíváte (VB, Upozornění a ℹ️ zůstávají vždy); data se sbírají dál. Každou záložku lze tlačítkem **⧉** (vpravo v liště záložek) otevřít v samostatném okně. Okna jdou přesouvat a zvětšovat, kliknuté okno jde dopředu a otevřená okna se po F5 obnoví na stejném místě.

- **VB** (vlastní i cizí Velké budovy v jedné záložce): nahoře kalkulačka naposledy otevřené budovy – u vlastní **náhozy** P1–P7 × koeficient (předvolby 1,8–2,0, tlačítko Arc podle bonusu Archy nebo vlastní hodnota), vlastní podíl a text do vlákna (`Hráč Galata Tower 77→78 P1(1083) P2(542) …`, jméno hráče se bere ze hry); u cizí kolik FP chybí, odměny s bonusem Archy, cena zajištění místa a zisk. Pod tím přehled vlastních VB (úroveň, vloženo/potřeba, stupeň 🥉/🥇) a přehled VB naposledy navštíveného hráče.
- **Kalkulačka VB v okně**: jedno plovoucí okno pro vlastní i cizí VB – ukazuje vždy naposledy otevřenou budovu (náhozy, zajištění míst, zisk, text do vlákna). Může se otevírat samo s otevřením budovy ve hře (přepínač „otevírat samo“ v okně nebo v záložce Upozornění).
- **Produkce**: denní přehled výroby podle druhu a podle budov (FP, zboží podle věků, cech, mince, zásoby, medaile, jednotky, fragmenty); co se vyrábí, souhrn FP/mincí/zásob/medailí/zboží za aktuální cyklus a kdy bude hotovo. Po otevření osady ve hře i přehled osady: suroviny, další odemčení (co chybí), kdy bude která produkce hotová, stojící a nepřipojené budovy. Dole je tabulka **Limitované budovy**: kdy která vyprší a co máte ve skladu na obnovu (sada, hotová budova, fragmenty).
- **Nástrojová lišta**: ikony záložek – klik otevře / zavře okno záložky, odznak u upozornění; ⠿ otevře klasický panel a slouží k přesunu (vodorovně i svisle, nastavení v ℹ️).
- **Rating** (⭐): efektivita budov – skóre podle produkce a bonusů na pole včetně cesty (postup jako FoE Helper), filtr podle velikosti, vlastní hodnoty na pole.
- **Bonusy**: útok a obrana útočníka i obránce podle oblasti (Všude, GBG, Expedice, QI) a ostatní bonusy.
- **GBG**: cechy na mapě, kde útočíme a kde útočí na nás včetně rychlosti postupu za 1 a 5 minut (pozná se, jestli v provincii jede někdo s vámi), aktivita členů (přírůstek bitev, vyjednávání a opotřebení od minulého otevření žebříčku), opotřebení (úroveň, bonus obránců, násobitel vyjednávání, reset, počet bitev do zvolené úrovně), tabulka provincií s časem odemknutí, názvy (D4C…), označením provincií sousedících s našimi a ☆ pro sledování, žebříček členů.
- **Mapa**: plánek města nebo osady – cesty, budovy podle potřeby cesty, volná pole, slepé cesty, budovy bez potřeby cesty stojící u cesty, nepřipojené budovy. Log ke stažení obsahuje i rozměry budov. Tlačítkem „Otevřít v okně“ se mapa otevře v samostatném okně: přesun za hlavičku, změna velikosti za roh, zoom kolečkem nebo +/−, posun tažením; při přiblížení se ukazují názvy budov.
- **Příhody**: příhody ve městě jako karty s obrázky (co, kde, vzácnost, kdy zmizí) i ty, které se teprve objeví; deník vybraných odměn s denním souhrnem. Obsah odměny server prozradí až po vybrání.
- **Vyjednávání**: při vyjednávání na expedici ukáže dosavadní tahy a navrhne další (vyřazuje nemožné kombinace). Jen radí, tah zadáváte ve hře sami; v GBG se zapíná v 🔔.
- **Hospody**: vaše hospoda (obsazenost), volné židle u přátel, znovu dostupné hospody.
- **Suroviny**, **Log**.
- **Sklad**: zboží všech věků (po věcích, se součtem a zvýrazněním nejslabšího zboží) a části (fragmenty) – kolik máte, kolik je potřeba, kolikrát jde sestavit a co chybí.
- **🔔 Upozornění**: historie upozornění a nastavení (mj. nové soukromé a cechovní zprávy); vybraná upozornění i jako systémové oznámení Chromu (sledované provincie GBG chodí přesně i na pozadí).
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

## Testy
`test/run-tests.mjs` načte panel do Chromia, pošle mu syntetické zprávy hry (žádná data skutečných hráčů) a ověří klíčová čísla – stupeň VB, bonus Archy, medaile, násobitele bonusů, vyjednávání, GBG. Spouští se automaticky na GitHubu při každém pushi (Actions → Testy), ručně `npm i --no-save playwright@1.56.0 && npx playwright install chromium && node test/run-tests.mjs`.

## Poznámky
- Odpovědi chodí v dávkách: k jednomu požadavku se může přibalit víc zpráv (např. `TimeService.updateTime`).
- Stav hospody: bez `state` = volná židle, `isSitting` = už tam sedíte, `noChair` = plno, `alreadyVisited` = navštíveno (`nextVisitTime`).
- Při běhu spolu s FoE Helperem se oba odposlechy řetězí a navzájem si nevadí.

## Podpořte vývoj
Rozšíření je zdarma a bude zdarma. Pokud vám pomáhá a chcete autorovi poslat kafe, můžete přes Ko-fi – je to čistě dobrovolné:

[![Podpořit na Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jbasta74)

## Licence a poděkování
FoE Reader je svobodný software pod licencí **GNU AGPL-3.0** (viz [LICENSE](LICENSE)). Smíte ho používat, upravovat a šířit; upravené verze musí zůstat pod stejnou licencí a se zdrojovým kódem.

Část dat a postupů vychází z projektu [FoE Helper](https://github.com/mainIine/foe-helfer-extension) (AGPL-3.0): názvy a sousednost provincií GBG (`provinces.js`), obrázky příhod (`img/incidents`), přesný řešič vyjednávání (`nego-solver-helper.js`), způsob načítání ikon zboží z CDN hry a struktura dat vyjednávání. Děkujeme jeho autorům.

Forge of Empires je ochranná známka společnosti InnoGames GmbH. Toto rozšíření s InnoGames nijak nesouvisí, nic neposílá na herní server a pouze čte data, která hra sama přijímá.
