# Umsetzungsstand

Stand 31.10.2026, Version 0.1.0. Nur lokal: noch kein GitHub-Repository und kein Docker-Hub-Image.

Legende: ✅ umgesetzt und geprüft · 🟡 umgesetzt, Prüfung offen oder eingeschränkt · ❌ offen

## Funktionale Anforderungen

| ID | Stand | Nachweis / Bemerkung |
|---|---|---|
| FA-01 | ✅ | `/photos` in compose read-only; die App öffnet Originale nur lesend |
| FA-02 | ✅ | `test/parse.test.ts`, `test/scanner.test.ts`; zusätzlich Jahresordner (siehe decisions.md) |
| FA-03 | ✅ | Unterordner beliebiger Tiefe, `.jpg/.jpeg` ohne Rücksicht auf Groß-/Kleinschreibung (`scanner.test.ts`) |
| FA-04 | ✅ | Start, `SCAN_INTERVAL_SEC`, Button „Ordner neu einlesen“; Ergebnis per WebSocket |
| FA-05 | ✅ | Log `debug` „Ordner ohne gültiges Datumspräfix ignoriert“ |
| FA-06 – FA-08 | ✅ | `/api/thumbs/:id`, Cache `/cache/thumbs`, Dateiname enthält Änderungszeit, `THUMB_CONCURRENCY` |
| FA-09 – FA-14 | ✅ | Im Browser geprüft (Playwright, Desktop und Mobil) |
| FA-15 – FA-21 | ✅ | Im Browser geprüft; Zeitraumlogik in `dates.test.ts`, `plan.test.ts` |
| FA-22, FA-23 | ✅ | Tages-Seed in `plan.test.ts` |
| FA-24 | ✅ | Warnung in der UI; Abbruch bei vollem Speicher in `sync.test.ts` |
| FA-25 – FA-30 | ✅ | `sync.test.ts` (Mock) und echte Karte: 300 Bilder in ca. 30 s, inkrementell, Spiegelbetrieb, Unterordner/`.Trash-1000` unberührt |
| FA-31 | ✅ | Standard `dcim` + `random` (siehe decisions.md). `core.test.ts`: zufällige Nummern, „neu mischen“, Wechsel des Schemas. Echte Karte: 125 Bilder zufällig nummeriert |
| FA-32 – FA-34 | ✅ | `processor.test.ts`; auf der Karte: 800 × 600, Baseline, ohne EXIF, EXIF-Rotation korrekt |
| FA-35 | ✅ | `op=108`, Icon online/offline |
| FA-36 | 🟡 | Shelly schaltet (App, Taste am Plug, Neustart per `toggle_after` geprüft). Neustart nach Sync und Schleifenschutz in `restart.test.ts`. Der Plug schaltet den Rahmen noch nicht, Boot-Verhalten deshalb nicht real geprüft |
| FA-37 | 🟡 | Webhook per `curl`: Token, 202, genau ein Sync nach 30 s. Webhook im Shelly noch nicht eingerichtet |
| FA-38 | ✅ | „Frei auf der Karte“ in der Übertragungs-Karte |
| FA-39, FA-40 | ✅ | Zwei Browser parallel: Speichern erscheint live im zweiten Client; Reconnect mit Backoff und Snapshot |
| FA-41 – FA-44 | 🟡 | Design umgesetzt, Hell/Dunkel. Barrierefreiheit (Tastatur, Kontrast) noch nicht systematisch geprüft (Phase 6) |

## Nicht-funktionale Anforderungen

| ID | Stand | Bemerkung |
|---|---|---|
| NFA-01 | ✅ | Node 22, TypeScript 6, Fastify 5, sharp, Vite, Preact |
| NFA-02 | ✅ | 2.000 Ordner: Scan 190 ms, erste Seite nach ca. 240 ms im Browser |
| NFA-03 | 🟡 | Nicht lesbares oder leer gewordenes Verzeichnis: letzter Scan bleibt, UI zeigt einen Hinweis. Noch kein automatisierter Test |
| NFA-04 | ✅ | Uploads nacheinander, Timeouts, 3 Versuche, Abbruch nach 3 Fehlern in Folge |
| NFA-05 | ✅ | Keine Anmeldung, Webhook-Token mit konstantem Zeitvergleich. Optional HTTPS (eigenes oder selbstsigniertes Zertifikat), im Test-Container aktiv und von außen geprüft (`https.test.ts`) |
| NFA-06 | ✅ | `USER node` |
| NFA-07 | ✅ | `/data/state.db` |
| NFA-08 | ✅ | `/api/health`, Docker-`HEALTHCHECK`, JSON-Logs, `LOG_LEVEL`, `TZ`, SIGTERM |
| NFA-09 | ❌ | Lokal nur amd64 gebaut, 270 MB (siehe decisions.md) |
| NFA-10 | 🟡 | 69 Tests (Unit, FlashAir- und Shelly-Mock, Core-Integration, HTTPS). CI-Workflow geschrieben, aber noch nicht gelaufen |
| NFA-11 | 🟡 | Nur Chrome (Desktop und mobile Emulation) geprüft |

## Phasen (Kap. 8)

| Phase | Stand |
|---|---|
| 0 Fundament und Pipeline | 🟡 Repository `jb-io/photoframe-sync` (privat). Test-Job auf GitHub grün; Docker-Job wartet auf die Secrets `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`. Docker Hub: `jbiohub/photoframe-sync` |
| 1 Scan, API, WebSocket | ✅ |
| 2 Oberfläche und Auswahl | ✅ |
| 3 Bildaufbereitung | ✅ |
| 4 Sync zur FlashAir | ✅ mit Mock und echter Karte |
| 5 Gerätesteuerung und Webhook | 🟡 Webhook im Shelly noch nicht eingerichtet, Rahmen noch nicht am Plug |
| 6 Härtung und Release | ❌ Barrierefreiheits-Prüfung, Fehlerfall-Tests, 7-Tage-Lauf, `v1.0.0` |

## Nächste Schritte

1. Rahmen an den Shelly hängen und Boot-Ablauf (Einschalten → „startet …“ → Sync) real prüfen.
2. Shelly-Webhook „Switch turned on“ auf `http://<host>:8080/api/hooks/power-on?token=…` einrichten.
3. GitHub-Repository und Docker-Hub-Secrets anlegen, Pipeline laufen lassen (Multi-Arch).
4. Phase 6: Barrierefreiheit prüfen, Fehlerfälle (Netzlaufwerk weg, Abbruch mitten im Upload) testen, 7 Tage Dauerlauf.
