# EmpireMarv

Echtzeitstrategie über **18 Epochen** der Menschheitsgeschichte – von Keulenkriegern in der Urzeit bis zu Titan-Mechs im Weltraumzeitalter. Ein geistiger Nachfolger der klassischen Epochen-RTS, spielbar direkt im Browser.

![Frühzeit-Siedlung](docs/screenshots/fruehzeit.jpg)

> **Status: spielbarer Prototyp (v0.1).** Wirtschaft, Kampf, 18 Epochen, KI-Gegner und Fog of War funktionieren. Helden, Propheten, Wunder, See- und Luftkrieg, Sound und Mehrspieler fehlen noch – siehe [Roadmap](docs/GAME_DESIGN.md#roadmap).

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

- **18 Epochen** mit eigenem Namen, Zeitraum, Baustil und eigenen Einheiten. Start- und Endepoche sind pro Partie wählbar – wie früher.
- **5 Rohstoffe**: Nahrung, Holz, Stein, Gold, Eisen. Bürger sammeln, bauen und reparieren; Felder liefern unbegrenzt Nahrung.
- **Kampfdreieck**, das über alle Epochen gleich bleibt: Sturminfanterie › Abwehrinfanterie › Kavallerie & Fahrzeuge › Fernkampf › Sturminfanterie. Belagerung und Artillerie zerstören Gebäude.
- **8 Gebäudetypen**, deren Namen und Aussehen mit der Epoche wechseln (Hütte → Haus → Wohnblock → Wohnturm). Beim Aufstieg zieht die ganze Stadt in die neue Ära um.
- **Moral**: Häuser stärken Einheiten in ihrer Nähe.
- **KI-Gegner** in drei Stufen: baut Wirtschaft auf, steigt in Epochen auf, erkundet, verteidigt, greift in Wellen an und kontert deine Armee.
- **Fog of War**, Minimap, Sammelpunkte, Kontrollgruppen, Angriffsbewegung, Anzeige untätiger Bürger.
- **Deterministische Simulation**: Gleicher Seed und gleiche Befehle ergeben dieselbe Partie. Das ist die Grundlage für Replays und Mehrspieler.

![Architektur der Epochen](docs/screenshots/epochen-architektur.jpg)

## Steuerung

| Eingabe                         | Wirkung                                             |
| ------------------------------- | --------------------------------------------------- |
| Linksklick / Ziehen             | Auswählen / Rahmenauswahl                           |
| Doppelklick                     | Alle sichtbaren Einheiten dieses Typs               |
| Rechtsklick                     | Bewegen, Angreifen, Sammeln, Bauen – je nach Ziel   |
| Rechtsklick mit Gebäude         | Sammelpunkt setzen                                  |
| `A`, dann Klick                 | Angriffsbewegung                                    |
| Buchstaben                      | Befehle (stehen auf den Knöpfen, z. B. `H` = Haus)  |
| Umschalt + Bauen / Ausbilden    | Mehrfach platzieren / 5 Einheiten                   |
| `Strg`+`1–9`, dann `1–9`        | Gruppe speichern / wählen (zweimal: hinspringen)    |
| `.`                             | Nächster untätiger Bürger                           |
| `Pos1`                          | Dorfzentrum                                         |
| Leertaste                       | Zum letzten Angriff springen                        |
| Pfeiltasten, Bildschirmrand, Mausrad | Kamera bewegen und zoomen                      |
| `+` / `−`                       | Spielgeschwindigkeit                                |
| `P` / `Esc` / `F1`              | Pause / Menü / Hilfe                                |

![Schlacht in den Weltkriegen](docs/screenshots/schlacht.jpg)

## Projektaufbau

```
src/
  data/      Spielinhalte als Daten: Epochen, Einheiten, Gebäude, Kampfdreieck
  sim/       Deterministische Simulation: Welt, Befehle, Verhalten, Kampf, Wegfindung, KI
  render/    Isometrische Darstellung, prozedurale Sprites, Minimap
  ui/        HUD, Eingabe, Startmenü
tests/       Vitest: Daten, Wegfindung, Wirtschaft, Kampf, KI-gegen-KI
docs/        Game Design und Screenshots
```

Neue Inhalte entstehen fast immer nur in `src/data/`. Eine weitere Einheitenstufe ist ein Eintrag in `ROLE_DEFS`, eine neue Epoche ein Eintrag in `EPOCHS`.

Das Design, die Epochen-Tabelle und die Roadmap stehen in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Veröffentlichen (GitHub Pages)

Der Workflow `.github/workflows/pages.yml` baut das Spiel bei jedem Push auf den Standard-Branch und veröffentlicht den Ordner `dist/`.

Einmalig nötig: unter *Settings → Pages → Build and deployment → Source* **GitHub Actions** auswählen. Mit „Deploy from a branch“ liefert GitHub den Quellcode aus, die `.ts`-Dateien laufen im Browser nicht, und die Seite bleibt leer.

## Rechtliches

EmpireMarv ist ein eigenständiges Fanprojekt. Es verwendet weder Code noch Grafiken, Namen oder Sounds aus anderen Spielen. Alle Grafiken werden prozedural im Code gezeichnet. „Empire Earth“ ist eine Marke ihrer jeweiligen Rechteinhaber und wird hier nur zur Einordnung des Genres erwähnt.
