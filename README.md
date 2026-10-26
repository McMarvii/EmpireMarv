# EmpireMarv

Echtzeitstrategie über **18 Epochen** der Menschheitsgeschichte – von Keulenkriegern in der Urzeit bis zu Titan-Mechs im Weltraumzeitalter. Ein geistiger Nachfolger der klassischen Epochen-RTS, spielbar direkt im Browser.

![Frühzeit-Siedlung](docs/screenshots/fruehzeit.jpg)

> **Status: spielbarer Prototyp (v0.3).** Wirtschaft, Kampf, 18 Epochen, 165 Technologien, Mauern und Tore, Späher, KI-Gegner, Fog of War sowie Ton und Musik funktionieren. Befehlsketten, Formationen und Mehrspieler fehlen noch – siehe [Roadmap](docs/GAME_DESIGN.md#roadmap).

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Dann <http://localhost:5173> öffnen, Einstellungen wählen und auf **Spiel starten** klicken.

| Befehl              | Zweck                                   |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Entwicklungsserver mit Live-Reload      |
| `npm test`          | Alle Tests (Simulation, Kampf, KI …)    |
| `npm run typecheck` | TypeScript-Prüfung                      |
| `npm run build`     | Produktionsbuild nach `dist/`           |

## Was schon drin ist

- **18 Epochen** mit eigenem Namen, Zeitraum, Baustil, eigenen Einheiten und einem Emblem mit römischer Ziffer (I–XVIII). Start- und Endepoche sind pro Partie wählbar – wie früher.
- **Aufstieg braucht Gebäude und Forschung**: Jede Epoche verlangt Gebäude der bisherigen Epochen, z. B. für die Bronzezeit ein Kriegerlager, eine Werkstatt und zwei Hütten, und zwei erforschte Techniken der aktuellen Epoche. Der Tooltip zeigt die Checkliste.
- **Technologiebaum mit 165 Techniken** in 24 Zweigen – Waffen, Rüstungen, Werkzeuge, Bergbau, Ackerbau, Medizin, Schrift, Mathematik, Antriebe … Jede Epoche schaltet neue Stufen frei, von Feuersteinklingen bis Nanoklingen. Geforscht wird in Schmiede, Akademie und den Produktionsgebäuden.
- **5 Rohstoffe**: Nahrung, Holz, Stein, Gold, Eisen. Bürger sammeln, bauen und reparieren; Felder liefern unbegrenzt Nahrung. Rechtsklick auf Dorfzentrum oder Lager lagert die Ladung sofort ein.
- **Kampfdreieck**, das über alle Epochen gleich bleibt: Sturminfanterie › Abwehrinfanterie › Kavallerie & Fahrzeuge › Fernkampf › Sturminfanterie. Belagerung und Artillerie zerstören Gebäude.
- **12 Gebäudetypen**, deren Namen und Aussehen mit der Epoche wechseln (Hütte → Haus → Wohnblock → Wohnturm). Beim Aufstieg zieht die ganze Stadt in die neue Ära um.
- **Mauern und Tore**, als Linie gezogen: Palisade, Lehmziegel, Zinnenmauer, Bastion, Beton, Energiebarriere. Tore lassen nur das eigene Team durch.
- **Späher** mit großer Sichtweite und **Erkundenmodus** für jede Einheit.
- **Moral**: Häuser stärken Einheiten in ihrer Nähe – sichtbar als Punkte am Lebensbalken und als Kreis um das Haus.
- **Lesbarkeit**: Einheiten, Minen und Büsche hinter Gebäuden scheinen durch.
- **Ton und Musik**, komplett im Browser erzeugt, ohne Audiodateien: Waffen klingen nach ihrer Epoche (Schleuder, Bogen, Muskete, Gewehr, Kanone, Laser), Bürger hacken, schürfen und hämmern, Einheiten antworten auf Befehle. Ein Alarm passend zur Ära (Kriegshorn, Glocke, Signalhorn, Sirene) und eine Fanfare beim Aufstieg. Die Musik wird für jede Ära neu komponiert, von der Knochenflöte bis zum Synthesizer, und wird im Kampf treibender. Man hört nur, was man sieht.
- **KI-Gegner** in drei Stufen: baut Wirtschaft und die nötigen Gebäude auf, steigt in Epochen auf, erkundet mit Spähern, mauert ihre Basis ein, verteidigt, greift in Wellen an und kontert deine Armee.
- **Fog of War**, Minimap, Sammelpunkte, Kontrollgruppen mit Gruppenleiste, Angriffsbewegung, Anzeige untätiger Bürger.
- **Deterministische Simulation**: Gleicher Seed und gleiche Befehle ergeben dieselbe Partie. Das ist die Grundlage für Replays und Mehrspieler.

![Architektur der Epochen](docs/screenshots/epochen-architektur.jpg)

## Steuerung

| Eingabe                         | Wirkung                                             |
| ------------------------------- | --------------------------------------------------- |
| Linksklick / Ziehen             | Auswählen / Rahmenauswahl                           |
| Doppelklick                     | Alle sichtbaren Einheiten dieses Typs               |
| Rechtsklick                     | Bewegen, Angreifen, Sammeln, Bauen, Einlagern – je nach Ziel |
| Rechts oder Mitte gedrückt ziehen | Karte verschieben                                 |
| Rechtsklick mit Gebäude         | Sammelpunkt setzen                                  |
| `A`, dann Klick                 | Angriffsbewegung                                    |
| `E`                             | Erkunden (mit Einheiten ausgewählt)                 |
| `M` / `G`, dann ziehen          | Mauer / Tor als Linie bauen                         |
| `Entf`                          | Auswahl abreißen bzw. entlassen                     |
| `A`, `S`, `D` … (Gebäude gewählt) | Nächste Stufe eines Forschungszweigs              |
| `F2` oder „Forschung“           | Technologiebaum                                     |
| Buchstaben                      | Befehle (stehen auf den Knöpfen, z. B. `H` = Haus)  |
| Umschalt + Bauen / Ausbilden    | Mehrfach platzieren / 5 Einheiten                   |
| `Strg`+`1–9`, dann `1–9`        | Gruppe speichern / wählen (zweimal: hinspringen); auch über die Gruppenleiste |
| `.`                             | Nächster untätiger Bürger                           |
| `Pos1`                          | Dorfzentrum                                         |
| Leertaste                       | Zum letzten Angriff springen                        |
| Pfeiltasten, Bildschirmrand, Mausrad | Kamera bewegen und zoomen                      |
| `+` / `−`                       | Spielgeschwindigkeit                                |
| `P` / `Esc` / `F1`              | Pause / Menü / Hilfe                                |
| `Strg`+`M` oder 🔊              | Ton ein/aus; Lautstärke unter Menü → Ton & Musik    |

![Schlacht in den Weltkriegen](docs/screenshots/schlacht.jpg)

## Projektaufbau

```
src/
  data/      Spielinhalte als Daten: Epochen, Einheiten, Gebäude, Kampfdreieck
  sim/       Deterministische Simulation: Welt, Befehle, Verhalten, Kampf, Wegfindung, KI
  render/    Isometrische Darstellung, prozedurale Sprites, Minimap
  audio/     Prozedurale Klänge, generative Musik je Ära, Mischpult
  ui/        HUD, Eingabe, Startmenü
tests/       Vitest: Daten, Wegfindung, Wirtschaft, Kampf, KI-gegen-KI, Klänge und Musik
docs/        Game Design und Screenshots
```

Neue Inhalte entstehen fast immer nur in `src/data/`. Eine weitere Einheitenstufe ist ein Eintrag in `ROLE_DEFS`, eine neue Epoche ein Eintrag in `EPOCHS`.

Das Design, die Epochen-Tabelle und die Roadmap stehen in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Veröffentlichen (GitHub Pages)

Der Workflow `.github/workflows/pages.yml` baut das Spiel bei jedem Push auf den Standard-Branch und veröffentlicht den Ordner `dist/`.

Einmalig nötig: unter *Settings → Pages → Build and deployment → Source* **GitHub Actions** auswählen. Mit „Deploy from a branch“ liefert GitHub den Quellcode aus, die `.ts`-Dateien laufen im Browser nicht, und die Seite bleibt leer.

## Rechtliches

EmpireMarv ist ein eigenständiges Fanprojekt. Es verwendet weder Code noch Grafiken, Namen oder Sounds aus anderen Spielen. Alle Grafiken werden prozedural im Code gezeichnet, alle Klänge und die Musik zur Laufzeit synthetisiert. „Empire Earth“ ist eine Marke ihrer jeweiligen Rechteinhaber und wird hier nur zur Einordnung des Genres erwähnt.
