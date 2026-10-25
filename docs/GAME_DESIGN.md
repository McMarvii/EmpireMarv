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

| # | Epoche | Zeitraum | Baustil | Neu in dieser Epoche |
| --- | --- | --- | --- | --- |
| 1 | Urzeit | bis 10.000 v. Chr. | Stein | Keulenkrieger, Speerträger, Steinwerfer |
| 2 | Jungsteinzeit | 10.000–5.000 v. Chr. | Stein | Axtkämpfer, Schleuderer · Felder, Wachturm |
| 3 | Kupferzeit | 5.000–3.000 v. Chr. | Stein | Speerkämpfer, Bogenschütze, Rammbock · Belagerungswerkstatt |
| 4 | Bronzezeit | 3.000–1.200 v. Chr. | Antike | Bronzeschwertkämpfer, Streitwagen · Stall |
| 5 | Eisenzeit | 1.200–500 v. Chr. | Antike | Hoplit, Kompositbogenschütze |
| 6 | Antike | 500 v. Chr.–500 n. Chr. | Antike | Legionär, Reiter, Katapult |
| 7 | Frühmittelalter | 500–1000 | Mittelalter | Schildwallkrieger, Panzerreiter · Bürger werden zu Bauern |
| 8 | Hochmittelalter | 1000–1300 | Mittelalter | Langschwertkämpfer, Pikenier, Armbrust, Ritter, Trebuchet |
| 9 | Spätmittelalter | 1300–1500 | Mittelalter | Hellebardier, Langbogenschütze |
| 10 | Renaissance | 1500–1650 | Imperial | Landsknecht, Arkebusier, Kürassier, Bombarde |
| 11 | Zeitalter der Imperien | 1650–1789 | Imperial | Musketier, Dragoner, Kanone |
| 12 | Revolutionszeit | 1789–1850 | Imperial | Grenadier, Füsilier, Husar |
| 13 | Industrialisierung | 1850–1914 | Modern | Gewehrschütze, Panzerbüchse, Panzerwagen, Feldgeschütz |
| 14 | Weltkriege | 1914–1945 | Modern | Sturmtruppe, Infanterist, Panzer, Haubitze |
| 15 | Atomzeitalter | 1945–1991 | Modern | Bazooka, Sturmgewehr, Kampfpanzer, Raketenartillerie |
| 16 | Digitalzeitalter | 1991–2040 | Zukunft | Spezialeinheit, Lenkwaffen, Präzisionsschütze |
| 17 | Nanozeitalter | 2040–2100 | Zukunft | Nano-Soldat, Plasma-Lanzer, Laserschütze, Kampfmech, Ionenkanone |
| 18 | Weltraumzeitalter | ab 2100 | Zukunft | Exo-Krieger, Plasmaschütze, Titan-Mech, Plasmaartillerie |

Aufstiegskosten wachsen linear (+35 % der Grundkosten pro Epoche). Stein wird ab Epoche 3 verlangt, Gold ab Epoche 5, Eisen ab Epoche 7. In KI-gegen-KI-Testläufen erreichen beide Seiten nach 40 Minuten die Renaissance (Epoche 10). Eine Partie über alle 18 Epochen dürfte demnach 1,5 bis 2 Stunden dauern. Für kürzere Partien wählt man Start- und Endepoche.

## Wirtschaft

| Rohstoff | Quelle | Wofür |
| --- | --- | --- |
| Nahrung | Beerensträucher, Felder (unerschöpflich, 2 Bauern) | Bürger, Infanterie, Kavallerie, Epochen |
| Holz | Bäume | Gebäude, Fernkampf, Belagerung |
| Stein | Steinbrüche | Türme, Dorfzentren, Epochen |
| Gold | Goldminen | Fernkampf, Kavallerie, Epochen ab 5 |
| Eisen | Eisenminen | Sturminfanterie, Kavallerie, Belagerung, Epochen ab 7 |

- Bürger tragen 10 Einheiten und liefern sie im Dorfzentrum oder Lager ab. Mit jeder Epoche sammeln sie 4 % schneller.
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

## Gebäude

| Gebäude | Ab Epoche | Funktion |
| --- | --- | --- |
| Dorfzentrum / Stadtzentrum / Rathaus | 1 | Bürger, Abgabe, Epochenaufstieg, schießt |
| Hütte / Haus / Wohnblock | 1 | Moral für Einheiten in der Nähe |
| Lager / Depot | 1 | Abgabestelle |
| Kriegerlager / Kaserne | 1 | Sturm-, Abwehr- und Fernkampfinfanterie |
| Feld / Bauernhof | 2 | Unerschöpfliche Nahrung |
| Wachturm / Bastion / Bunker | 2 | Verteidigung |
| Belagerungswerkstatt / Gießerei / Waffenfabrik | 3 | Belagerung und Artillerie |
| Stall / Fahrzeugwerk / Mech-Hangar | 4 | Kavallerie, Fahrzeuge, Mechs |

## KI

Die KI spielt nach denselben Regeln über dieselbe Befehlsschnittstelle wie Menschen. Sie kennt allerdings die Lage gegnerischer Gebäude, wie in klassischen RTS-KIs üblich.

- **Wirtschaft**: Zielverteilung der Bürger je Epoche, priorisiert Rohstoffe, die für den nächsten Aufstieg fehlen, und verteilt Arbeiter um.
- **Ausbau**: Lager an entfernten Minen, Kaserne, Werkstatt, Stall, Türme, Felder sobald die Beeren aufgebraucht sind.
- **Militär**: Rollenmix, der auf die sichtbare gegnerische Armee kontert. Verteidigt die Basis und greift in wachsenden Wellen an.
- **Schwierigkeit**: Leicht, Mittel, Schwer. Unterschiede bei Reaktionszeit, Sammelrate und Angriffszeitpunkt.

## Technische Architektur

- **TypeScript + Vite**, keine Spiel-Engine, keine Laufzeit-Abhängigkeiten.
- **Simulation** (`src/sim`) mit festen 20 Ticks pro Sekunde und eigenem Zufallsgenerator (kein `Math.random`). Sie ist vollständig von Darstellung und Eingabe getrennt, läuft headless in Tests und ist bereit für Lockstep-Mehrspieler.
- **Befehle** (`world.issue`) sind die einzige Schnittstelle für Spieler und KI. Für Replays reicht es, sie aufzuzeichnen.
- **Darstellung** mit Canvas 2D, isometrisch, alle Sprites prozedural. Gebäude und Einheiten werden pro Epoche umgefärbt und umgebaut, Positionen zwischen Ticks interpoliert.
- **Wegfindung**: A* auf 8er-Nachbarschaft mit wiederverwendeten Puffern und String-Pulling-Glättung.

## Roadmap

| Version | Inhalt |
| --- | --- |
| **0.1** (jetzt) | 18 Epochen, 5 Rollen, 8 Gebäude, Wirtschaft, KI, Fog of War, Minimap |
| 0.2 | Helden (Stratege heilt und stärkt Moral, Krieger verstärkt Angriff), Mauern und Tore, Einheiten-Upgrades (LP, Angriff, Reichweite), Sounds |
| 0.3 | Priester (bekehren) und Propheten (Seuche, Erdbeben, Vulkan, Sturm), Wunder mit Sonderfähigkeiten und Wundersieg |
| 0.4 | Seekrieg (Häfen, Fischfang, Schiffe je Epoche), Luftkrieg ab den Weltkriegen (Flughafen, Jäger, Bomber, Hubschrauber), Flugabwehr |
| 0.5 | Zivilisations-Editor mit Bonuspunkten, Kartentypen (Kontinente, Inseln, Wüste), Diplomatie und Teams |
| 0.6 | Mehrspieler (Lockstep über WebRTC), Replays, Zuschauermodus |
| 0.7 | Kampagne und Szenario-Editor |
| 1.0 | Balancing, WebGL-Renderer für große Schlachten, Musik, Lokalisierung |

## Offene Entscheidungen

1. **Endgültige Plattform**: Bleibt es ein Browserspiel (sofort spielbar, leicht teilbar) oder kommt später ein Port in eine Engine wie Godot (3D, Steam)? Die Simulation ist so geschrieben, dass beides möglich bleibt.
2. **Grafikstil**: Prozedurale Vektorgrafik (wie jetzt) gegen gezeichnete oder gerenderte Sprites. Mit echten Assets steigt der Produktionsaufwand stark.
3. **Name**: „EmpireMarv“ ist ein Arbeitstitel. Ein eigener Name ist nötig, bevor das Spiel öffentlich beworben wird.
