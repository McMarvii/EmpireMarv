# EmpireMarv – Game Design

## Vision

Ein Echtzeitstrategiespiel, das das Versprechen der klassischen Epochen-RTS einlöst: **eine Zivilisation durch die gesamte Menschheitsgeschichte führen**, in einer einzigen Partie, mit verständlichem Kampfsystem und einer Wirtschaft, die man in fünf Minuten lernt.

### Was wir übernehmen

- Viele Epochen, frei wählbare Start- und Endepoche pro Partie
- Fünf Rohstoffe, Bürger als Sammler und Bauarbeiter
- Kampfdreieck statt reiner Zahlenschlacht
- Festes Bevölkerungslimit als Spieleinstellung; Häuser liefern **Moral** statt Wohnraum
- Gebäude und Einheiten, die sich mit jeder Epoche sichtbar verändern

### Was wir besser machen wollen

| Problem der Klassiker | Unser Ansatz |
| --- | --- |
| Viele Epochen fühlten sich gleich an | Jede Epoche bringt mindestens eine neue Einheitenstufe und einen eigenen Baustil (6 Stilfamilien × 3 Epochen) |
| Kontersystem schwer zu durchschauen | **Fünf Rollen**, die über alle 18 Epochen gleich bleiben. Der Tooltip sagt immer „Stark gegen / Schwach gegen“ |
| Altersbedingt: Auflösung, Steuerung, Bugs | Modernes UI, skalierbare Darstellung, Kontrollgruppen, Angriffsbewegung, Anzeige untätiger Bürger |
| Kein fairer Mehrspieler ohne Desyncs | **Deterministische Simulation** ab Tag 1 (Seed + Befehlsliste = Partie) |
| Modding nur über Editoren | Alle Inhalte als Daten (`src/data/`) – neue Einheiten ohne Engine-Änderung |

## Die 18 Epochen

| # | Epoche | Zeitraum | Baustil | Neu in dieser Epoche | Aufstieg hierher verlangt |
| --- | --- | --- | --- | --- | --- |
| I | Urzeit | bis 10.000 v. Chr. | Stein | Keulenkrieger, Speerträger, Steinwerfer | — |
| II | Jungsteinzeit | 10.000–5.000 v. Chr. | Stein | Axtkämpfer, Schleuderer · Felder, Wachturm | 2× Haus, 1× Lager |
| III | Kupferzeit | 5.000–3.000 v. Chr. | Stein | Speerkämpfer, Bogenschütze, Rammbock · Belagerungswerkstatt | 1× Kaserne, 2× Feld |
| IV | Bronzezeit | 3.000–1.200 v. Chr. | Antike | Bronzeschwertkämpfer, Streitwagen · Stall | 1× Kaserne, 1× Werkstatt, 2× Haus |
| V | Eisenzeit | 1.200–500 v. Chr. | Antike | Hoplit, Kompositbogenschütze | 1× Stall, 1× Turm |
| VI | Antike | 500 v. Chr.–500 n. Chr. | Antike | Legionär, Reiter, Katapult | 4× Feld, 2× Lager |
| VII | Frühmittelalter | 500–1000 | Mittelalter | Schildwallkrieger, Panzerreiter · Bürger werden zu Bauern | 2× Kaserne, 4× Haus |
| VIII | Hochmittelalter | 1000–1300 | Mittelalter | Langschwertkämpfer, Pikenier, Armbrust, Ritter, Trebuchet | 12× Mauer, 1× Tor |
| IX | Spätmittelalter | 1300–1500 | Mittelalter | Hellebardier, Langbogenschütze | 2× Turm, 2× Stall |
| X | Renaissance | 1500–1650 | Imperial | Landsknecht, Arkebusier, Kürassier, Bombarde | 2× Werkstatt, 3× Lager |
| XI | Zeitalter der Imperien | 1650–1789 | Imperial | Musketier, Dragoner, Kanone | 6× Haus, 6× Feld |
| XII | Revolutionszeit | 1789–1850 | Imperial | Grenadier, Füsilier, Husar | 3× Kaserne, 3× Turm |
| XIII | Industrialisierung | 1850–1914 | Modern | Gewehrschütze, Panzerbüchse, Panzerwagen, Feldgeschütz | 3× Stall, 3× Werkstatt |
| XIV | Weltkriege | 1914–1945 | Modern | Sturmtruppe, Infanterist, Panzer, Haubitze | 8× Feld, 4× Lager |
| XV | Atomzeitalter | 1945–1991 | Modern | Bazooka, Sturmgewehr, Kampfpanzer, Raketenartillerie | 4× Turm, 24× Mauer |
| XVI | Digitalzeitalter | 1991–2040 | Zukunft | Spezialeinheit, Lenkwaffen, Präzisionsschütze | 8× Haus, 4× Kaserne |
| XVII | Nanozeitalter | 2040–2100 | Zukunft | Nano-Soldat, Plasma-Lanzer, Laserschütze, Kampfmech, Ionenkanone | 4× Stall, 4× Werkstatt |
| XVIII | Weltraumzeitalter | ab 2100 | Zukunft | Exo-Krieger, Plasmaschütze, Titan-Mech, Plasmaartillerie | 10× Haus, 5× Turm, 2× Tor |

Epochen werden wie in den Klassikern römisch gezählt; jede Stilfamilie hat ein eigenes Emblem (Steintafel, Münze, Wappenschild, Orden, Abzeichen, Hexagon).

**Aufstieg braucht Gebäude und Forschung.** Neben Rohstoffen verlangt jeder Aufstieg fertige Gebäude, die in den Epochen davor freigeschaltet wurden – in wachsender Zahl – und **zwei erforschte Techniken der aktuellen Epoche** (siehe [Technologien](#technologien)). So wächst die Zivilisation mit ihrer Epoche, statt nur das Dorfzentrum durchzuklicken. Die Stadt zieht beim Aufstieg weiterhin als Ganzes in die neue Ära um.

Aufstiegskosten wachsen linear (+35 % der Grundkosten pro Epoche). Stein wird ab III verlangt, Gold ab V, Eisen ab VII. In einem KI-gegen-KI-Testlauf mit Gebäude- und Forschungs-Voraussetzungen (mittlere Karte, Seed 7) stehen nach 40 Minuten beide Seiten im Zeitalter der Imperien (XI) und haben je 60–75 Techniken erforscht. Eine Partie über alle 18 Epochen dürfte demnach 1,5 bis 2 Stunden dauern. Für kürzere Partien wählt man Start- und Endepoche.

## Wirtschaft

| Rohstoff | Quelle | Wofür |
| --- | --- | --- |
| Nahrung | Beerensträucher, Felder (unerschöpflich, 2 Bauern) | Bürger, Infanterie, Kavallerie, Epochen |
| Holz | Bäume | Gebäude, Fernkampf, Belagerung |
| Stein | Steinbrüche | Türme, Dorfzentren, Epochen |
| Gold | Goldminen | Fernkampf, Kavallerie, Epochen ab 5 |
| Eisen | Eisenminen | Sturminfanterie, Kavallerie, Belagerung, Epochen ab 7 |

- Bürger tragen 10 Einheiten und liefern sie im Dorfzentrum oder Lager ab (Rechtsklick lagert sofort ein). Mit jeder Epoche sammeln sie 4 % schneller.
- Wer eine Abgabestelle gebaut hat, sammelt am nächstgelegenen Vorkommen weiter, egal welcher Art.
- Jede Startposition bekommt dieselbe Grundausstattung: Beeren, Wald, je eine Gold-, Stein- und Eisenmine. Weitere Minen verteilt der Generator über die Karte – sie lohnen das Erkunden.

## Kampfsystem

Fünf Rollen, jede Epoche liefert eine neue Stufe pro Rolle:

| Rolle | Stark gegen | Schwach gegen | Beispiele |
| --- | --- | --- | --- |
| Sturminfanterie | Abwehrinfanterie, Belagerung | Fernkampf, Kavallerie | Keulenkrieger → Legionär → Grenadier → Exo-Krieger |
| Abwehrinfanterie | Kavallerie & Fahrzeuge | Sturminfanterie, Fernkampf | Speerträger → Pikenier → Bazooka → Plasma-Lanzer |
| Fernkampf | Sturm- und Abwehrinfanterie | Kavallerie & Fahrzeuge | Steinwerfer → Langbogen → Musketier → Laserschütze |
| Kavallerie & Fahrzeuge | Fernkampf, Belagerung, Bürger | Abwehrinfanterie | Streitwagen → Ritter → Panzer → Titan-Mech |
| Belagerung & Artillerie | Gebäude, Gruppen (Flächenschaden) | Kavallerie, Sturminfanterie | Rammbock → Trebuchet → Haubitze → Plasmaartillerie |

- Schaden = Grundschaden × Rollenmultiplikator − Rüstung (mindestens 15 %).
- Werte steigen pro Epoche um 22 % des Grundwerts, Kosten nur um 12 %. Neuere Armeen sind also überlegen, alte Einheiten aber nicht wertlos. Ab der Industrialisierung kommen Fahrzeuge mit zusätzlicher Panzerung hinzu.
- **Moral**: Jedes eigene Haus im Umkreis von 8 Feldern gibt +4 % Schaden und −4 % erlittenen Schaden (höchstens 5 Häuser).
- Türme und Dorfzentren schießen und werden mit jeder Epoche stärker.
- **Helden, Priester und Propheten** stehen ebenfalls außerhalb des Dreiecks, siehe [Helden, Glaube und Wunder](#helden-glaube-und-wunder).
- **Späher** stehen außerhalb des Kampfdreiecks: schnell, Sichtweite 11, kaum Kampfkraft, greifen nie von selbst an. Stufen: Läufer → Kundschafter → Meldereiter → Spähwagen → Aufklärungsdrohne. Jede Einheit kann in den **Erkundenmodus** geschickt werden und zieht dann selbstständig zum nächsten unerkundeten Rand.

## Helden, Glaube und Wunder

### Helden

Das Dorfzentrum bildet ab der Jungsteinzeit (II) zwei Helden aus, **je Spieler höchstens einen pro Art** (auch nicht eingereiht). Fällt einer, kann er neu ausgebildet werden. Helden sind größer gezeichnet und tragen einen goldenen Ring. Sie wachsen mit der Epoche und bekommen dann einen neuen Titel. Außerhalb des Kampfes heilen sie sich selbst (1 % LP/s nach 5 s ohne Treffer).

| Held | Titel (ab Epoche) | Aura | Fähigkeiten (Taste, Abklingzeit) |
| --- | --- | --- | --- |
| **Stratege** (220 LP, Nahrung 200, Gold 250) | Häuptling (II) → Heerführer (IV) → Feldherr (VII) → Marschall (X) → General (XIII) → Kommandant (XVI) | Radius 7: +2 Moral (über die 5 Häuser hinaus bis 7), 1 % LP/s Heilung | **Sammelruf** `M` (60 s): Verbündete im Radius 8 laufen 10 s lang 35 % schneller. **Schildwall** `W` (75 s): Radius 6, 12 s lang −40 % Schaden. **Feldlazarett** `Q` (90 s): Radius 7, sofort +35 % LP, heilt die Seuche |
| **Krieger** (320 LP, Nahrung 250, Gold 200, Eisen 100) | Recke (II) → Kriegsheld (IV) → Bannerritter (VII) → Haudegen (X) → Kommandosoldat (XIII, Gewehr) → Elitekämpfer (XVII, Laser) | Radius 6: +15 % Angriff | **Kampfschrei** `K` (50 s): Gegner im Radius 5 sind 3 s gelähmt. **Wirbelschlag** `D` (30 s): 2,5-facher Schaden an allen Gegnern im Radius 2,5. **Blutrausch** `U` (60 s): 10 s lang +50 % Schaden und schnellere Angriffe |

Auren werden einmal pro Sekunde zusammen mit der Moral berechnet; ein gelähmter Held strahlt keine Aura aus. Fähigkeitsknöpfe erscheinen nur, wenn keine Bürger in der Auswahl sind; die Bau-Tasten der Bürger bleiben so frei.

### Tempel, Priester und Propheten

Der Tempel (ab II, Holz 125, Stein 150, Gold 50, Taste `I`) bildet Priester (ab II) und Propheten (ab III) aus. Beide greifen nie an, auch nicht auf Befehl.

- **Glaube**: Priester sammeln bis 100 Glaubenspunkte (1,5/s), Propheten bis 200 (1/s).
- **Bekehren** (Rechtsklick auf einen Gegner oder `C`): Mit vollem Glauben betet der Priester aus bis zu 5 Feldern Abstand. Dauer 6 s × Klasse (Bürger und Späher 0,75; Kavallerie, Priester und Propheten 1,5; Belagerung 2; sonst 1) × Glaubensschutz des Gegners. Jeder Treffer am Priester wirft das Gebet 1,5 s zurück. Danach wechselt die Einheit den Besitzer, der Glaube ist verbraucht. Helden lassen sich nicht bekehren.
- **Heilen** (Rechtsklick auf Verbündete oder `H`): 2,5 % der LP pro Sekunde aus bis zu 4 Feldern. Untätige Priester suchen sich Verwundete von selbst.
- **Katastrophen** der Propheten (Klick auf eine Stelle bis 9 Felder entfernt; der Prophet läuft notfalls heran). Sie treffen **nur Gegner** und addieren sich nicht, wenn zwei gleiche auf derselben Stelle liegen. Dorfzentren nehmen halben Schaden, Wunder keinen.

| Katastrophe | Taste | Ab | Glaube | Radius | Wirkung |
| --- | --- | --- | --- | --- | --- |
| Seuche | `S` | III | 100 | 4 | Wer in den 4 s, die die Wolke liegt, ins Gebiet gerät, erkrankt und verliert in 12 s 30 % LP, auch auf der Flucht. Feldlazarett heilt sie |
| Erdbeben | `B` | III | 150 | 5 | 3 s lang: Gebäude −25 %, Einheiten −15 % LP |
| Feuersturm | `F` | VI | 150 | 3,5 | 6 s lang: Einheiten bis −45 %, Gebäude −15 % LP |
| Sturm | `T` | IX | 120 | 5 | 8 s lang halbes Tempo und −20 % LP |

**Gegenmittel** im Tempel, je 6 Stufen: Glaubensschutz (Bekehren dauert je Stufe 40 % länger), Heilkunst (+25 % Heilung durch Priester, Strategen und Kathedrale), Katastrophenschutz (−15 % Katastrophenschaden, höchstens −75 %), Glaubenseifer (+20 % Glaubensregeneration).

### Wunder

Jede Ära hat ein Wunder. Ein Spieler kann jedes Ära-Wunder einmal bauen, also später weitere aus neuen Ären. Ein Wunder behält die Ära, in der es gegründet wurde, mit Aussehen, Namen und Wirkung. Kosten: das Doppelte des letzten Aufstiegs seiner Ära; 5×5 Felder, 8000 LP, 600 s Bauzeit (Taste `D`, ab III).

| Baustil (Epochen) | Wunder | Wirkung für den Besitzer |
| --- | --- | --- |
| Stein (III) | Steinkreis | Alle Rohstoffe 15 % schneller sammeln |
| Antike (IV–VI) | Große Bibliothek | Ganze Karte aufgedeckt, auch für Verbündete |
| Mittelalter (VII–IX) | Kathedrale | Alle eigenen Einheiten heilen überall langsam (0,6 % LP/s), auch im Kampf |
| Imperial (X–XII) | Kaiserpalast | Ausbildung 25 % schneller |
| Modern (XIII–XV) | Sendeturm | +2 Moral für alle eigenen Einheiten |
| Zukunft (XVI–XVIII) | Weltraumlift | Forschung und Aufstieg 30 % schneller |

**Wundersieg** (Spieleinstellung aus/5/10/15 min, Standard 10): Ist ein Wunder fertig, sehen es alle Spieler, und ein Countdown läuft in der Topbar. Steht es bis zum Ende, gewinnt das Team des Erbauers. Wird es zerstört, endet der Countdown. Während er läuft, leuchtet das Wunder golden, auch auf der Minikarte.

## Befehle und Formationen

- **Formationen**: Linie (breite Front, wenige Reihen), Block (kompaktes Quadrat, Standard) und Keil (Spitze voran). Unabhängig von der Formation steht die Infanterie vorn, dahinter Reiter, dann Bürger und Späher, dann Fernkampf, ganz hinten Belagerung. Jede Rang-Gruppe füllt eigene Reihen. Einheiten behalten ihre Seite, damit sich ihre Wege nicht kreuzen. Ein Klick auf eine Formation (`N`, `O`, `V`) ordnet eine stehende Gruppe sofort neu.
- **Gleichschritt**: Bei jedem Gruppenbefehl bekommt jede Einheit ein Marschtempo, mit dem alle zur selben Zeit am Ziel sind. Die Einheit mit dem (gemessen an ihrem Tempo) weitesten Weg gibt die Zeit vor, alle anderen werden langsamer, aber höchstens auf 35 % ihres Tempos. Reiter laufen so nicht mehr voraus. Bei Gefechten in einer Angriffsbewegung endet der Gleichschritt.
- **Blickrichtung**: Normalerweise zeigt die Front in Laufrichtung. Mit eigenen Einheiten in der Auswahl legt Rechts-Ziehen sie fest: Startpunkt = Ziel, Zugrichtung = Front, mit Pfeil und Vorschau der Plätze. Ohne Einheiten in der Auswahl schwenkt Rechts-Ziehen die Karte.
- **Befehlsketten**: Mit gedrückter Umschalttaste werden Befehle angehängt statt ersetzt: Wegpunkte, Angriffsbewegungen, Angriffsziele, Sammeln, Einlagern, Bauaufträge (auch Mauerlinien) und Erkunden, bis zu 40 je Einheit. Befehle, die nie von selbst enden (Sammeln, Erkunden, Patrouille, Nichtstun), weichen einem angehängten Befehl sofort. So baut ein Holzfäller bei Umschalt+Bauen erst, statt ewig weiter Holz zu hacken. Halt (`X`) und jeder Befehl ohne Umschalt leeren die Kette.
- **Patrouille** (`R`): Die Einheiten pendeln zwischen ihrem Standort und dem Ziel. Umschalt+Klick fügt der Runde weitere Punkte hinzu (bis 8). Soldaten greifen unterwegs an und setzen danach die Runde fort; Späher und Bürger laufen nur.
- **Sammelpunkt-Ketten**: Umschalt+Rechtsklick mit einem Gebäude hängt Wegpunkte an (bis 8). Neue Einheiten laufen sie der Reihe nach ab; Bürger beginnen am Ende zu sammeln, wenn dort ein Rohstoff liegt.
- **Gebäude-Hotkeys**: `Tab`, dann die Bau-Taste eines Gebäudes (z. B. `Tab`, `K`) wählt ein Gebäude dieses Typs, untätige zuerst. Erneut gedrückt geht es zum nächsten, zweimal schnell (unter 0,8 s) springt die Kamera hin. `Tab` als Präfix vermeidet Strg-Kürzel, die der Browser nicht abgibt (Strg+W schließt den Tab, Strg+T öffnet einen).
- **Produktionsleiste** (links über der Minikarte): jedes Gebäude, das ausbildet oder forscht, mit Bau-Taste, Fortschrittsbalken (Einheit grün, Forschung violett, Aufstieg blau) und der Zahl wartender Aufträge. Untätige Gebäude sind rot umrandet. Klick wählt, Umschalt+Klick fügt gleiche Gebäude hinzu, Doppelklick springt hin. Türme und Lager erscheinen nur, solange sie forschen.
- **Mehrere Gebäude**: Doppelklick auf ein Gebäude wählt alle gleichen auf dem Bildschirm, ein Rahmen ohne Einheiten wählt die häufigste Gebäudeart darin. Ausbilden verteilt jede Einheit auf die kürzeste Warteschlange, Forschung geht an das am wenigsten beschäftigte Gebäude, Sammelpunkte gelten für alle.
- **Forschungs-Warteschlangen**: Jedes Gebäude reiht bis zu 5 Techniken ein (bezahlt beim Einreihen). Eine Stufe darf eingereiht werden, sobald ihre Voraussetzung erforscht, in Arbeit oder eingereiht ist; sie startet, wenn die Voraussetzung fertig ist. Bricht man eine Technik ab oder fällt das Gebäude, verschwinden (mit Erstattung) auch die eingereihten Techniken, die sie gebraucht hätten.
- **Aufstieg in der Warteschlange**: Der Aufstieg wartet hinter den Einheiten, die schon im Dorfzentrum eingereiht waren. Später eingereihte Einheiten warten auf die neue Epoche.
- **Anzeige**: Ausgewählte Einheiten mit Kette oder Patrouille zeigen ihre Wegpunkte als gestrichelte Linien in der Farbe der Befehlsart (Bewegen grün, Kampf rot, Sammeln gelb, Bauen blau). Bei gedrückter Umschalttaste werden alle Pläne gezeigt. Größere Gruppen bekommen eine gemeinsame Linie durch die Mitte und einen Punkt je Einheit.

## Gebäude

| Gebäude | Ab Epoche | Funktion |
| --- | --- | --- |
| Dorfzentrum / Stadtzentrum / Rathaus | 1 | Bürger, Späher, Abgabe, Epochenaufstieg, schießt |
| Hütte / Haus / Wohnblock | 1 | Moral für Einheiten in der Nähe |
| Lager / Depot | 1 | Abgabestelle |
| Kriegerlager / Kaserne | 1 | Sturm-, Abwehr- und Fernkampfinfanterie |
| Feld / Bauernhof | 2 | Unerschöpfliche Nahrung |
| Wachturm / Bastion / Bunker | 2 | Verteidigung |
| Werkplatz → Schmiede → Rüstungswerk → Waffenlabor | 1 | Forschung: Waffen und Rüstungen |
| Ahnenstätte → Akademie → Universität → Forschungszentrum | 1 | Forschung: Bauwesen, Wissenschaft, Verwaltung |
| Palisade → Steinmauer → Betonmauer → Energiebarriere | 2 | Mauer (1×1), als Linie gezogen; schließt an Türme an |
| Palisadentor → Torhaus → Schranke → Energietor | 2 | Lässt eigenes Team durch, Gegner nicht |
| Belagerungswerkstatt / Gießerei / Waffenfabrik | 3 | Belagerung und Artillerie |
| Stall / Fahrzeugwerk / Mech-Hangar | 4 | Kavallerie, Fahrzeuge, Mechs |
| Schrein → Tempel → Kloster → Kirche → Andachtshaus → Meditationszentrum | 2 | Priester, Propheten, Glaubensforschung |
| Wunder (Steinkreis … Weltraumlift) | 3 | Je Ära eines, eigene Wirkung, Wundersieg |

## Technologien

Der Technologiebaum umfasst **189 Techniken in 28 Zweigen**. Jeder Zweig hat eine Wirkung, die jede seiner Stufen erneut hinzufügt, und Stufen, die Epoche für Epoche freigeschaltet werden. Jede Stufe verlangt die vorige, einige zusätzlich eine Stufe eines anderen Zweigs (z. B. Luntenschloss → Schwarzpulver, Verbrennungsmotor → Dampfpumpe). So entwickelt sich die Zivilisation mit jeder Epoche weiter, statt einmal fertig erforscht zu sein.

- **Wo**: Schmiede (Waffen, Rüstungen), Akademie (Wissenschaft, Bauwesen, Verwaltung), Tempel (Glaube) und Linien-Upgrades in Dorfzentrum, Kaserne, Stall, Werkstatt, Turm und Lager. Jedes Gebäude forscht eine Technik zur Zeit, parallel zur Ausbildung.
- **Kosten**: Grundpreis des Zweigs × (1 + 0,3 × Epoche). Vor der Kupferzeit wird statt Gold Holz bezahlt, vor der Eisenzeit statt Eisen Stein. Dauer 18 s + 2 s je Epoche.
- **Aufstieg**: Pro Epoche müssen zwei ihrer Techniken erforscht sein. Jede Epoche bietet 5–14 Techniken aus mindestens zwei Gebäuden.
- **Bedienung**: Im Gebäude zeigt je Zweig ein Knopf die nächste Stufe (Tasten A, S, D …). Der Technologiebaum (Knopf „Forschung“ oder F2) zeigt alle Zweige mit Zustand und startet Forschung per Klick im nächsten freien Gebäude.

| Gebäude | Zweig | Wirkung je Stufe | Stufen (ab Epoche) |
| --- | --- | --- | --- |
| Schmiede | Infanteriewaffen | Sturm- und Abwehrinfanterie +6 % Schaden | Feuersteinklingen (I) → Kupferguss (III) → Bronzeklingen (IV) → Eisenschmieden (V) → Stahlhärtung (VIII) → Damaszener Stahl (X) → Gezogene Läufe (XII) → Maschinenpistolen (XIV) → Verbundwerkstoffe (XVI) → Nanoklingen (XVII) |
| Schmiede | Fernwaffen | Fernkampf +5 % Schaden, +0,15 Reichweite | Wurfholz (I) → Sehnenbogen (III) → Kompositbogen (V) → Eisenspitzen (VII) → Eibenholz (IX) → Luntenschloss (X) → Steinschloss (XI) → Hinterlader (XIII) → Zielfernrohr (XV) → Fokuslinsen (XVII) |
| Schmiede | Infanterierüstung | Fußtruppen +0,3 Rüstung, +3 % Lebenspunkte | Lederwams (II) → Bronzeschild (IV) → Kettenhemd (VI) → Plattenpanzer (VIII) → Kürass (X) → Stahlhelm (XIV) → Splitterschutz (XV) → Kevlarweste (XVI) → Exoskelett (XVIII) |
| Schmiede | Reiterharnisch | Kavallerie und Fahrzeuge +5 % Schaden, +0,3 Rüstung | Bronzebeschläge (IV) → Steigbügel (VI) → Rossharnisch (VII) → Lanzenstahl (VIII) → Säbelschmiede (XI) → Panzerstahl (XIII) → Verbundpanzerung (XIV) → Reaktivpanzerung (XVI) → Plasmaschilde (XVII) |
| Akademie | Baukunst | Bürger bauen 12 % schneller | Lehmziegel (II) → Mörtel (IV) → Gewölbe (VI) → Gerüstbau (IX) → Dampfkran (XII) → Fertigteile (XIV) → Baudrohnen (XVII) |
| Akademie | Mauerwerk | Gebäude +8 % Lebenspunkte, Mauern und Tore weitere +15 % | Trockenmauer (II) → Quaderbau (V) → Zinnenbau (VIII) → Sternschanze (X) → Stahlbeton (XIII) → Bunkerbau (XV) → Nanokeramik (XVII) |
| Akademie | Mathematik | Türme und Dorfzentren +8 % Schaden, +0,25 Reichweite | Zählkunst (III) → Geometrie (V) → Algebra (VII) → Ballistik (X) → Feuerleitung (XIII) → Radar (XV) → Zielrechner (XVII) |
| Akademie | Medizin | Verwundete Einheiten heilen sich außerhalb des Kampfes (+0,15 LP/s) | Heilkräuter (II) → Wundversorgung (VI) → Feldscher (IX) → Impfung (XII) → Antibiotika (XIV) → Gentherapie (XVI) → Nanomedizin (XVIII) |
| Akademie | Schrift | Forschung und Epochenaufstieg 10 % schneller | Bilderschrift (II) → Keilschrift (IV) → Alphabet (VI) → Buchdruck (X) → Telegrafie (XIII) → Computer (XV) → Quantenrechner (XVII) |
| Akademie | Kartografie | Alle Einheiten +0,5 Sichtweite | Sternkunde (III) → Kompass (VII) → Kartografie (X) → Fernrohr (XI) → Luftaufklärung (XIV) → Satelliten (XVI) |
| Akademie | Staatskunst | Alle Gebäude bilden 6 % schneller aus | Gesetzestafeln (IV) → Verwaltung (VI) → Lehnswesen (VIII) → Wehrpflicht (XI) → Massenfertigung (XIII) → Logistik (XV) → Klonfabriken (XVIII) |
| Dorfzentrum | Werkzeuge | Bürger sammeln alle Rohstoffe 6 % schneller | Grabstock (I) → Kupferwerkzeug (III) → Eisenwerkzeug (V) → Stahlwerkzeug (IX) → Maschinenwerkzeug (XIII) → Robotik (XVI) |
| Dorfzentrum | Tragekunst | Bürger tragen 2 Einheiten mehr | Tragekorb (I) → Rad (IV) → Schubkarre (VIII) → Handkarren (XII) → Lastwagen (XIV) → Antigravträger (XVII) |
| Dorfzentrum | Bürgerwehr | Bürger +15 % Lebenspunkte und Schaden, +0,5 Rüstung | Dorfwache (II) → Landwehr (VII) → Bürgerwehr (XI) → Zivilschutz (XV) |
| Kaserne | Drill | Fußtruppen +6 % Lebenspunkte | Kriegstanz (I) → Phalanxdrill (IV) → Legionsdrill (VI) → Exerzierreglement (X) → Grundausbildung (XIII) → Spezialausbildung (XVI) |
| Kaserne | Gewaltmarsch | Fußtruppen 5 % schneller | Läuferpfade (III) → Römerstraßen (VI) → Marschordnung (XI) → Motorisierung (XIV) → Sprunganzüge (XVII) |
| Stall | Zucht und Antrieb | Kavallerie und Fahrzeuge +6 % Lebenspunkte | Pferdezucht (IV) → Schlachtrösser (VII) → Remonte (X) → Verbrennungsmotor (XIII) → Gasturbine (XV) → Fusionsantrieb (XVII) |
| Stall | Beweglichkeit | Kavallerie, Fahrzeuge und Späher 5 % schneller | Leichte Wagen (V) → Hufbeschlag (VIII) → Leichte Reiterei (XII) → Kettenlaufwerk (XIV) → Hybridantrieb (XVI) |
| Werkstatt | Geschützbau | Belagerung und Artillerie +7 % Schaden | Holzverbindungen (III) → Torsionsfedern (VI) → Gegengewicht (VIII) → Schwarzpulver (X) → Bronzeguss (XI) → Rücklaufbremse (XIII) → Raketentechnik (XV) → Ionentechnik (XVII) |
| Werkstatt | Zielkunst | Belagerung und Artillerie +0,4 Reichweite | Spannwerk (VII) → Richtaufsatz (X) → Gezogene Rohre (XIII) → Lenkflugkörper (XV) → Orbitale Zielerfassung (XVIII) |
| Wachturm | Wachdienst | Türme und Dorfzentren +10 % Schaden | Wachfeuer (III) → Pechnasen (VIII) → Kasematten (XI) → MG-Nest (XIV) → Raketenabwehr (XVI) |
| Lager | Holzwirtschaft | Holz wird 10 % schneller gesammelt | Steinaxt (I) → Bronzeaxt (IV) → Zugsäge (VII) → Sägemühle (X) → Dampfsäge (XIII) → Kettensäge (XV) → Holzernter (XVII) |
| Lager | Bergbau | Stein, Gold und Eisen werden 10 % schneller gesammelt | Schlägel und Eisen (II) → Stollenbau (V) → Grubenlampe (VIII) → Sprengpulver (XI) → Dampfpumpe (XIII) → Pressluftbohrer (XIV) → Asteroidenbergbau (XVII) |
| Lager | Ackerbau | Felder bringen 10 % mehr Nahrung | Hakenpflug (II) → Bewässerung (V) → Dreifelderwirtschaft (VII) → Kummet (IX) → Fruchtwechsel (XII) → Kunstdünger (XIII) → Traktoren (XIV) → Gentechnik (XVI) → Hydroponik (XVIII) |
| Tempel | Glaubensschutz | Bekehren gegen dich dauert 40 % länger | Amulette (II) → Ahnenkult (V) → Reliquien (VIII) → Bekenntnisschriften (XI) → Gewissensfreiheit (XIV) → Psi-Abschirmung (XVII) |
| Tempel | Heilkunst | Heilung durch Priester, Strategen und Kathedrale +25 % | Kräuterkunde (II) → Heilbäder (V) → Hospitäler (VIII) → Feldlazarette (XI) → Antibiotika (XIV) → Nanomedizin (XVII) |
| Tempel | Katastrophenschutz | −15 % Schaden durch Katastrophen (höchstens −75 %) | Opfergaben (III) → Deiche (VI) → Brandwachen (IX) → Quarantäne (XII) → Zivilschutz (XV) → Kraftfelder (XVIII) |
| Tempel | Glaubenseifer | Glauben 20 % schneller | Rituale (III) → Orakelstätten (VI) → Pilgerfahrten (IX) → Missionen (XII) → Massenmedien (XV) → Neuronale Netze (XVIII) |

## Ton und Musik

Alles wird mit der Web Audio API zur Laufzeit erzeugt: Oszillatoren, gefiltertes Rauschen und FM-Synthese. Das Spiel liefert keine einzige Audiodatei aus. Die Simulation meldet nur, *was* zu hören ist (`SoundCue`: Schuss, Hieb, Treffer, Explosion, Tod, Einsturz, Arbeit). Sie liest davon nichts zurück und bleibt so deterministisch.

- **Kampf**: Der Klang folgt der Waffe und ihrer Epoche. Steine und Pfeile surren, Keulen pochen, Bronze und Stahl klirren. Schwarzpulver knallt dumpf, Gewehre knallen scharf, Sturmtruppen und Panzerwagen feuern Salven. Dazu kommen Kanonendonner, Raketen, Laser und Plasma. Mit Holz zerbersten Belagerungsgeräte, mit Metall Fahrzeuge, Gebäude stürzen polternd ein.
- **Arbeit**: Axt auf Holz, Spitzhacke auf Stein, Gold und Eisen (mit unterschiedlichem Klang), raschelnde Felder, Hammer auf der Baustelle (in der Zukunft ein Schweißgerät).
- **Helden und Glaube**: Jede Fähigkeit hat ihren Klang: Sammelruf als aufsteigende Fanfare der Ära, Schildwall mit Pauke, Feldlazarett mit Glocken, Kampfschrei mit Ruf und Kriegshorn, Wirbelschlag zischt, Blutrausch stampft. Erdbeben grollen, Feuerstürme prasseln, Stürme heulen, die Seuche brummt kränklich. Bekehrung schwillt als Chorakkord an, Heilung klingt hell, ein fertiges Wunder hat eine eigene Fanfare.
- **Rückmeldungen**: Bei Auswahl, Bewegen, Angriff und Arbeit antworten Einheiten mit zwei Tönen auf dem Leitinstrument ihrer Ära, Reiter zusätzlich mit Hufschlag. Späher pfeifen, Fahrzeuge lassen den Motor aufheulen, Mechs surren, Drohnen brummen. Gebäude antworten mit einem kurzen Akkord.
- **Meldungen**: Gebäude fertig, Einheit bereit, Technik erforscht, Fehler, Sieg und Niederlage. Beim Aufstieg spielt eine Fanfare, die Musik wird dabei leiser.
- **Mischung**: Hörbar ist nur, was auf sichtbaren Feldern passiert. Lautstärke und Stereoposition ergeben sich aus der Bildschirmposition; Kampf ist noch 60 % einer Bildschirmbreite außerhalb zu hören, Arbeit nur im Bild. Jede Klangart hat einen Mindestabstand (z. B. 35 ms für Schüsse), höchstens 28 Effekte klingen gleichzeitig, ein Kompressor verhindert Übersteuern.
- **Musik**: Ein Komponist schreibt Takt für Takt aus Tonleiter, Akkordfolge, Rhythmusmustern und Motiven (A B A C, A B A Kadenz). So wiederholen sich Melodien, statt zufällig zu klingen. Jeder vierte ruhige Abschnitt lässt die Melodie pausieren. Sichtbare Kämpfe erhöhen die *Kampf-Hitze*; ab 18 Punkten wechselt die Musik zur Kampfvariante mit treibendem Bass und Schlagzeug, unter 8 Punkten zurück (Abklingzeit 8 s). Alle Ären sind gleich laut eingepegelt.

| Ära | Epochen | Tonleiter | Tempo | Instrumente | Alarm |
| --- | --- | --- | --- | --- | --- |
| Steinzeit | I–III | Moll-Pentatonik | 80 | Knochenflöte, Bordun, Rahmentrommel | Kriegshorn |
| Antike | IV–VI | Hijaz (phrygisch-dominant) | 88 | Leier, Harfen-Arpeggio, Bordun | Kriegshorn |
| Mittelalter | VII–IX | Dorisch, 6/8-Takt | 64 | Schalmei, Bordun, Tabor | Glocke |
| Imperial | X–XII | Dur | 104 | Blechbläser, Streicher, Marschtrommel, Pauke | Signalhorn |
| Moderne | XIII–XV | Natürliches Moll | 92 | E-Piano, Flächen, Sub-Bass, Schlagzeug | Sirene |
| Zukunft | XVI–XVIII | Natürliches Moll | 116 | Synthesizer-Arpeggios, Flächen, Sub-Bass | Sirene |

Lautstärke für Gesamt, Effekte und Musik sowie Stumm (`Strg`+`M`) stehen im Menü unter „Ton & Musik“ und werden im Browser gespeichert. Wegen der Autoplay-Regeln der Browser startet der Ton erst mit dem ersten Klick.

## Mehrspieler und Wiedergaben

### Lobby und Verbindung

- **Spiel erstellen**: Der Gastgeber bekommt einen Link (`#join=em-…`) und stellt die Partie ein. Vier Plätze, jeder ist *Offen (Mensch)*, *Computer* oder *Geschlossen*, dazu Team 1–4. Wer den Link öffnet, landet auf dem ersten offenen Platz. Gestartet wird ab zwei Spielern in zwei Teams. Offene Plätze ohne Spieler fallen weg.
- **Vermittlung**: WebRTC braucht einen Handschlag. Ihn übernimmt der öffentliche PeerJS-Server. Das Spiel spricht dessen Protokoll direkt (WebSocket mit JSON) und braucht keine Bibliothek. Danach laufen die Daten direkt über einen Datenkanal (zuverlässig, geordnet, große Nachrichten in Stücken). STUN-Server von Google und Cloudflare ermitteln die öffentliche Adresse; ein TURN-Relay gibt es nicht.
- **Code-Notlösung**: Ohne Server tauschen Gastgeber und Mitspieler je einen Code aus. Das ist die komplette, komprimierte Sitzungsbeschreibung, etwa 600 Zeichen.
- **Lokal**: `?signal=local` vermittelt zwischen Tabs desselben Browsers (BroadcastChannel), für Tests ohne Internet.

### Lockstep mit Relay

Jeder Browser rechnet die ganze Simulation selbst. Ausgetauscht werden nur Befehle.

- Gäste schicken ihre Befehle an den Gastgeber. Der setzt den Absender selbst ein, ein Gast kann also nur sein eigenes Reich steuern. Dann packt er die Befehle in einen **Frame** für einen Tick wenige Ticks in der Zukunft und schickt jeden Frame an alle, auch leere. Ein Frame ist die Erlaubnis, diesen Tick zu rechnen.
- **Eingabeverzögerung**: 2–8 Ticks (100–400 ms), angepasst an die gemessene Umlaufzeit (`delayFor`). Auch die Befehle des Gastgebers nehmen diesen Weg, das hält es fair.
- **Takt**: Gäste melden alle 5 Ticks ihren Stand. Fällt einer mehr als 2 s zurück, wartet der Gastgeber. Gäste, die hinterherhinken, rechnen ein paar Ticks pro Bild mehr. Versteckte Tabs rechnen über einen Timer weiter, damit niemand auf sie wartet.
- **Desync-Erkennung**: Jede Sekunde vergleicht der Gastgeber die Prüfsumme der Gäste (Positionen, Lebenspunkte, Vorräte, Zufallsgenerator) mit seiner eigenen. Weicht eine ab, sehen alle eine Warnung.
- **Bitgleich über Browser hinweg**: `Math.sin`, `cos`, `atan2`, `hypot` und `**` rechnen in Chrome, Firefox und Safari im letzten Bit verschieden. Die Simulation nutzt deshalb eigene Versionen aus exakten Grundrechenarten (`src/sim/fmath.ts`). Ein Test verbietet die Originale in Simulation und Daten. Jeder Befehl wird vor der Ausführung durch JSON geschickt, auch lokal. So bekommt jeder Rechner exakt dieselben Zahlen (kein `-0`, kein `undefined`).

### Pause, Abbruch, Wiedereinstieg

- **Pause** (`P`) gilt für alle, das Banner zeigt, wer pausiert hat. Menüs und Technologiebaum pausieren im Mehrspieler nicht. Die Geschwindigkeit stellt nur der Gastgeber ein.
- **Verbindung verloren**: Die Partie wartet bis zu 60 s mit Countdown. Der Gastgeber kann vorher „Nicht warten“ wählen. Danach übernimmt der Computer das Reich (Befehl `control`, ohne KI-Sammelbonus). Wer über das Menü geht, wird sofort ersetzt.
- **Wiedereinstieg**: Der Platz ist an ein Kennwort im Tab gebunden. Lädt jemand den Tab neu oder fliegt raus, bringt ihn derselbe Link zurück, auch nachdem der Computer übernommen hat. Der Gastgeber schickt die Befehle der ganzen Partie, der Browser rechnet sie im Schnelldurchlauf nach (Fortschritt für alle sichtbar), dann geht es synchron weiter. Eine 15-Minuten-Partie mit vier Reichen ist in wenigen Sekunden nachgerechnet.
- **Gastgeber weg**: Das Spiel endet für alle; die Partie lässt sich als Wiedergabe speichern.

### Chat und Markierungen

`Enter` öffnet die Chatzeile an alle, Umschalt+`Enter` ans Team (`Tab` wechselt beim Schreiben). `Alt`+Klick auf Karte oder Minikarte setzt eine Markierung mit Fähnchen und Ringen, die nur Verbündete sehen und hören. Der Chat landet auch in der Wiedergabe.

### Wiedergaben

Weil die Simulation deterministisch ist, reichen Einstellungen (mit Seed) und jeder Befehl mit seinem Tick. Computerspieler entscheiden beim Abspielen genauso wie im Spiel. Eine Partie braucht nur einige Kilobyte.

- **Aufnahme**: immer, im Einzel- wie im Mehrspieler. Die letzte Partie bleibt im Browser („Letzte Partie ansehen“); speichern als `.json` über das Menü, den Sieg- oder Niederlagendialog und den Dialog „Verbindung beendet“.
- **Abspielen**: Tempo ½× bis 16×, ±30 s, Zeitleiste zum Springen. Vorwärts wird schnell gerechnet, rückwärts startet die Partie neu und spult vor. Wählbar ist die Sicht jedes Spielers (mit seinem Nebel) oder „Alles zeigen“.
- **Prüfung**: Alle 5 s speichert die Aufnahme eine Prüfsumme. Läuft die Wiedergabe anders, zum Beispiel unter einer anderen Spielversion, zeigt die Leiste ab wann.

## KI

Die KI spielt nach denselben Regeln über dieselbe Befehlsschnittstelle wie Menschen. Sie kennt allerdings die Lage gegnerischer Gebäude, wie in klassischen RTS-KIs üblich.

- **Wirtschaft**: Zielverteilung der Bürger je Epoche, priorisiert Rohstoffe, die für den nächsten Aufstieg fehlen, und verteilt Arbeiter um.
- **Ausbau**: zuerst die Gebäude, die der nächste Aufstieg verlangt; dann Lager an entfernten Minen, Kaserne, Werkstatt, Stall, Türme, Felder sobald die Beeren aufgebraucht sind.
- **Mauern**: ab der Kupferzeit ein quadratischer Ring um das Dorfzentrum mit einem Tor je Seite; blockierte Torplätze rutschen an der Seite entlang.
- **Erkundung**: mit dem Späher im Erkundenmodus.
- **Forschung**: hält Forschungsgebäude beschäftigt. Fehlen Techniken für den Aufstieg, haben die der aktuellen Epoche Vorrang; sonst Wirtschaft vor Militär, Militärtechniken erst ab sechs Soldaten und nur aus Überschuss.
- **Militär**: Rollenmix, der auf die sichtbare gegnerische Armee kontert. Verteidigt die Basis und greift in wachsenden Wellen an.
- **Helden**: zuerst der Krieger, dann der Stratege. Fähigkeiten nach Lage: Kampfschrei ab 3 Gegnern im Radius, Wirbelschlag ab 2 direkt daneben, Blutrausch im Nahkampf; Feldlazarett ab 3 Verwundeten, Schildwall ab 4 Gegnern in der Nähe, Sammelruf mit mindestens 5 eigenen Einheiten um sich und 3 Gegnern im Umkreis von 12 Feldern.
- **Glaube**: Tempel ab II mit mindestens 16 Bürgern und 4 Soldaten. Ein Prophet zuerst, dazu ein Priester und je 10 Soldaten einer mehr, höchstens 3. Priester bekehren wertvolle Ziele, sobald ihr Glaube voll ist. Propheten werfen Feuersturm, Seuche oder Sturm auf Haufen ab 4 Gegnern, sonst ein Erdbeben auf Gebäude.
- **Wunder**: baut das Wunder der aktuellen Ära aus dem Überschuss. Mit Wundersieg spart sie gezielt dafür und schiebt den Aufstieg auf. Fremde Wunder sind bevorzugte Angriffsziele; läuft ein gegnerischer Countdown, greift sie sofort an.
- **Schwierigkeit**: Leicht, Mittel, Schwer. Unterschiede bei Reaktionszeit, Sammelrate und Angriffszeitpunkt.

## Technische Architektur

- **TypeScript + Vite**, keine Spiel-Engine, keine Laufzeit-Abhängigkeiten.
- **Simulation** (`src/sim`) mit festen 20 Ticks pro Sekunde, eigenem Zufallsgenerator (kein `Math.random`) und eigener Trigonometrie (`fmath`). Sie ist vollständig von Darstellung und Eingabe getrennt, läuft headless in Tests und rechnet in jedem Browser bitgleich.
- **Befehle** (`world.issue`) sind die einzige Schnittstelle für Spieler und KI. Das Spiel gibt sie nie direkt hinein, sondern über eine **Sitzung** (`src/session.ts`): Einzelspiel wendet sie sofort an, Lockstep-Sitzungen (`src/net`) verteilen sie in Frames, die Wiedergabe liest sie aus der Aufnahme.
- **Darstellung** mit Canvas 2D, isometrisch, alle Sprites prozedural. Gebäude und Einheiten werden pro Epoche umgefärbt und umgebaut, Positionen zwischen Ticks interpoliert.
- **Wegfindung**: A* auf 8er-Nachbarschaft mit wiederverwendeten Puffern und String-Pulling-Glättung.
- **Audio** (`src/audio`): Synthese-Bausteine, Instrumente, Klangrezepte, reiner Musik-Komponist (testbar ohne Browser) und ein Mischpult mit Bussen für Effekte, Oberfläche und Musik.

## Roadmap

Die Reihenfolge ab 0.3 folgt dem Spieler-Interview vom Oktober 2026 (siehe unten).

| Version | Inhalt |
| --- | --- |
| 0.1 | 18 Epochen, 5 Rollen, 8 Gebäude, Wirtschaft, KI, Fog of War, Minimap |
| 0.2 | Mauern und Tore (auch für die KI), Späher und Erkundenmodus, Aufstieg mit Gebäude-Voraussetzungen, Epochen-Embleme, Gruppenleiste, sichtbare Moral, Durchsicht hinter Gebäuden, Karte per Rechts-Ziehen verschieben, Einlagern per Rechtsklick, Abriss mit Entf |
| 0.3 | ✔ **Großer Technologiebaum** (165 Techniken, 24 Zweige, Schmiede und Akademie, Forschung als Aufstiegsvoraussetzung). ✔ **Ton und Musik** (Befehlsrückmeldungen, Kampf- und Arbeitsgeräusche, Alarm und Fanfaren je Ära, generative Musik je Ära mit Kampfvariante) |
| 0.4 | ✔ **Befehlsketten** mit Umschalt (Wegpunkte, Ziele, Bauaufträge, Mauerlinien), ✔ **Formationen** (Linie, Block, Keil; Fernkampf hinten; Gleichschritt; Blickrichtung per Rechts-Ziehen), ✔ **Patrouille**, ✔ **Sammelpunkt-Ketten**, ✔ Wegpunkt-Anzeige, ✔ **Gebäude-Hotkeys** (`Tab` + Bau-Taste), ✔ **Produktionsleiste**, ✔ Ausbilden über mehrere Gebäude, ✔ Forschungs- und Aufstiegs-Warteschlangen |
| 0.5 | ✔ **Mehrspieler per Link** (bis 4 Plätze, Menschen und KI, Teams mit geteilter Sicht; WebRTC direkt, Handschlag über PeerJS oder Codes; Lockstep mit Relay und Desync-Erkennung; Warten und KI-Übernahme bei Abbruch; Wiedereinstieg per Link), ✔ **Chat** und **Kartenmarkierungen**, ✔ **Wiedergaben** (automatisch, als Datei, Tempo, Springen, Sicht wählbar), ✔ browserübergreifend bitgleiche Simulation |
| **0.6** (jetzt) | ✔ **Helden** (Stratege und Krieger mit Auren, je 3 Fähigkeiten, Titel je Epoche), ✔ **Tempel, Priester und Propheten** (Bekehren, Heilen, vier Katastrophen nur gegen Gegner, Gegenmittel-Techniken), ✔ **Wunder** (eines je Ära mit eigener Wirkung) mit einstellbarem **Wundersieg**, ✔ KI nutzt alles davon |
| 0.7 | Seekrieg und Luftkrieg, Kartentypen, Speichern & Laden, Tutorial |
| 1.0 | Kampagne und Szenario-Editor, Balancing, WebGL-Renderer für große Schlachten, Lokalisierung |

### Interview-Ergebnisse (Oktober 2026)

| Bereich | Gewünscht | Nicht genannt (später) |
| --- | --- | --- |
| Inhalte | Technologien & Upgrades (großer Baum), Sound & Musik | Helden, See- und Luftkrieg |
| Bedienung | Befehlsketten, Formationen, globale Gebäude-Hotkeys | Kampfhaltung |
| Rahmen | Mehrspieler per Link (P2P) – in 0.5 umgesetzt | Speichern & Laden, Tutorial, Kartentypen |
| Spielgefühl | Lesbarkeit: „Sachen hinter Gebäuden sind komplett verborgen“ – in 0.2 behoben | Partielänge, KI-Stärke, Mikromanagement wurden nicht bemängelt |

## Offene Entscheidungen

1. **Endgültige Plattform**: Bleibt es ein Browserspiel (sofort spielbar, leicht teilbar) oder kommt später ein Port in eine Engine wie Godot (3D, Steam)? Die Simulation ist so geschrieben, dass beides möglich bleibt.
2. **Grafikstil**: Prozedurale Vektorgrafik (wie jetzt) gegen gezeichnete oder gerenderte Sprites. Mit echten Assets steigt der Produktionsaufwand stark.
3. **Name**: „EmpireMarv“ ist ein Arbeitstitel. Ein eigener Name ist nötig, bevor das Spiel öffentlich beworben wird.
