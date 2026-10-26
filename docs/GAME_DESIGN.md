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

**Aufstieg braucht Gebäude.** Neben Rohstoffen verlangt jeder Aufstieg fertige Gebäude, die in den Epochen davor freigeschaltet wurden – in wachsender Zahl. So wächst die Stadt mit ihrer Epoche, statt nur das Dorfzentrum durchzuklicken. Die Stadt zieht beim Aufstieg weiterhin als Ganzes in die neue Ära um.

Aufstiegskosten wachsen linear (+35 % der Grundkosten pro Epoche). Stein wird ab III verlangt, Gold ab V, Eisen ab VII. In einem KI-gegen-KI-Testlauf mit Gebäude-Voraussetzungen (mittlere Karte, Seed 7) stehen nach 40 Minuten beide Seiten in der Renaissance (X) bzw. im Zeitalter der Imperien (XI). Eine Partie über alle 18 Epochen dürfte demnach 1,5 bis 2 Stunden dauern. Für kürzere Partien wählt man Start- und Endepoche.

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
- **Späher** stehen außerhalb des Kampfdreiecks: schnell, Sichtweite 11, kaum Kampfkraft, greifen nie von selbst an. Stufen: Läufer → Kundschafter → Meldereiter → Spähwagen → Aufklärungsdrohne. Jede Einheit kann in den **Erkundenmodus** geschickt werden und zieht dann selbstständig zum nächsten unerkundeten Rand.

## Gebäude

| Gebäude | Ab Epoche | Funktion |
| --- | --- | --- |
| Dorfzentrum / Stadtzentrum / Rathaus | 1 | Bürger, Späher, Abgabe, Epochenaufstieg, schießt |
| Hütte / Haus / Wohnblock | 1 | Moral für Einheiten in der Nähe |
| Lager / Depot | 1 | Abgabestelle |
| Kriegerlager / Kaserne | 1 | Sturm-, Abwehr- und Fernkampfinfanterie |
| Feld / Bauernhof | 2 | Unerschöpfliche Nahrung |
| Wachturm / Bastion / Bunker | 2 | Verteidigung |
| Palisade → Steinmauer → Betonmauer → Energiebarriere | 2 | Mauer (1×1), als Linie gezogen; schließt an Türme an |
| Palisadentor → Torhaus → Schranke → Energietor | 2 | Lässt eigenes Team durch, Gegner nicht |
| Belagerungswerkstatt / Gießerei / Waffenfabrik | 3 | Belagerung und Artillerie |
| Stall / Fahrzeugwerk / Mech-Hangar | 4 | Kavallerie, Fahrzeuge, Mechs |

## KI

Die KI spielt nach denselben Regeln über dieselbe Befehlsschnittstelle wie Menschen. Sie kennt allerdings die Lage gegnerischer Gebäude, wie in klassischen RTS-KIs üblich.

- **Wirtschaft**: Zielverteilung der Bürger je Epoche, priorisiert Rohstoffe, die für den nächsten Aufstieg fehlen, und verteilt Arbeiter um.
- **Ausbau**: zuerst die Gebäude, die der nächste Aufstieg verlangt; dann Lager an entfernten Minen, Kaserne, Werkstatt, Stall, Türme, Felder sobald die Beeren aufgebraucht sind.
- **Mauern**: ab der Kupferzeit ein quadratischer Ring um das Dorfzentrum mit einem Tor je Seite; blockierte Torplätze rutschen an der Seite entlang.
- **Erkundung**: mit dem Späher im Erkundenmodus.
- **Militär**: Rollenmix, der auf die sichtbare gegnerische Armee kontert. Verteidigt die Basis und greift in wachsenden Wellen an.
- **Schwierigkeit**: Leicht, Mittel, Schwer. Unterschiede bei Reaktionszeit, Sammelrate und Angriffszeitpunkt.

## Technische Architektur

- **TypeScript + Vite**, keine Spiel-Engine, keine Laufzeit-Abhängigkeiten.
- **Simulation** (`src/sim`) mit festen 20 Ticks pro Sekunde und eigenem Zufallsgenerator (kein `Math.random`). Sie ist vollständig von Darstellung und Eingabe getrennt, läuft headless in Tests und ist bereit für Lockstep-Mehrspieler.
- **Befehle** (`world.issue`) sind die einzige Schnittstelle für Spieler und KI. Für Replays reicht es, sie aufzuzeichnen.
- **Darstellung** mit Canvas 2D, isometrisch, alle Sprites prozedural. Gebäude und Einheiten werden pro Epoche umgefärbt und umgebaut, Positionen zwischen Ticks interpoliert.
- **Wegfindung**: A* auf 8er-Nachbarschaft mit wiederverwendeten Puffern und String-Pulling-Glättung.

## Roadmap

Die Reihenfolge ab 0.3 folgt dem Spieler-Interview vom Oktober 2026 (siehe unten).

| Version | Inhalt |
| --- | --- |
| 0.1 | 18 Epochen, 5 Rollen, 8 Gebäude, Wirtschaft, KI, Fog of War, Minimap |
| **0.2** (jetzt) | Mauern und Tore (auch für die KI), Späher und Erkundenmodus, Aufstieg mit Gebäude-Voraussetzungen, Epochen-Embleme, Gruppenleiste, sichtbare Moral, Durchsicht hinter Gebäuden, Karte per Rechts-Ziehen verschieben, Einlagern per Rechtsklick, Abriss mit Entf |
| 0.3 | **Großer Technologiebaum** wie in den Klassikern (viele Einzeltechnologien mit Abhängigkeiten, je Epoche neue Zweige: Angriff, Rüstung, Sammelrate, Bauzeit, Reichweite …) und **Sound & Musik** (Befehlsrückmeldungen, Kampfgeräusche, Alarm, Musik je Ära) |
| 0.4 | **Bedienung**: Befehlsketten mit Umschalt (Wegpunkte, mehrere Bauaufträge), Formationen (Linie, Block, Keil; Fernkampf hinten), globale Gebäude-Hotkeys |
| 0.5 | **Mehrspieler per Link** (Spiel erstellen, Link teilen, direkt über WebRTC verbunden; Lockstep auf der deterministischen Simulation), Replays |
| 0.6 | Helden (Stratege, Krieger), Priester und Propheten, Wunder mit Wundersieg |
| 0.7 | Seekrieg und Luftkrieg, Kartentypen, Speichern & Laden, Tutorial |
| 1.0 | Kampagne und Szenario-Editor, Balancing, WebGL-Renderer für große Schlachten, Lokalisierung |

### Interview-Ergebnisse (Oktober 2026)

| Bereich | Gewünscht | Nicht genannt (später) |
| --- | --- | --- |
| Inhalte | Technologien & Upgrades (großer Baum), Sound & Musik | Helden, See- und Luftkrieg |
| Bedienung | Befehlsketten, Formationen, globale Gebäude-Hotkeys | Kampfhaltung |
| Rahmen | Mehrspieler per Link (P2P) | Speichern & Laden, Tutorial, Kartentypen |
| Spielgefühl | Lesbarkeit: „Sachen hinter Gebäuden sind komplett verborgen“ – in 0.2 behoben | Partielänge, KI-Stärke, Mikromanagement wurden nicht bemängelt |

## Offene Entscheidungen

1. **Endgültige Plattform**: Bleibt es ein Browserspiel (sofort spielbar, leicht teilbar) oder kommt später ein Port in eine Engine wie Godot (3D, Steam)? Die Simulation ist so geschrieben, dass beides möglich bleibt.
2. **Grafikstil**: Prozedurale Vektorgrafik (wie jetzt) gegen gezeichnete oder gerenderte Sprites. Mit echten Assets steigt der Produktionsaufwand stark.
3. **Name**: „EmpireMarv“ ist ein Arbeitstitel. Ein eigener Name ist nötig, bevor das Spiel öffentlich beworben wird.
