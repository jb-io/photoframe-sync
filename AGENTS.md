# AGENTS.md

Anleitung für KI-Agenten und Entwickler in diesem Repository.

## Projekt

**Bilderrahmen Sync** (`photoframe-sync`): Web-App im Heimnetz. Sie wählt Bilder-Ordner von einem read-only eingebundenen Netzlaufwerk aus, bereitet die Bilder auf (800 × 600, JPEG) und spiegelt sie per WLAN auf eine Toshiba FlashAir W-03 im digitalen Bilderrahmen. Strom schaltet ein Shelly Plug Gen3. Ein einzelner Node.js-Container.

Bevor du etwas änderst, lies:
- `.dev/requirements.md`: Anforderungen (FA-xx, NFA-xx), maßgeblich
- `.dev/architecture.md`: Aufbau und Abläufe
- `.dev/decisions.md`: bewusste Abweichungen
- `.dev/status.md`: was fertig ist und was offen

## Befehle

```bash
npm install
npm run dev            # API (tsx watch, Port 8080) + Vite (Port 5173, Proxy auf /api)
npm test               # Vitest
npm run lint           # ESLint
npm run typecheck      # tsc für Server, Tests und Web
npm run build          # dist/web (Vite) + dist/server (tsc)
npm run photos:test    # Test-Bilderordner testdata/photos erzeugen
docker compose -f compose.dev.yml up -d --build   # Test-Umgebung mit echten Geräten
```

Für `npm run dev` liest der Server `.env.local` (falls vorhanden). Lokal mindestens setzen: `PHOTOS_DIR=testdata/photos DATA_DIR=.local/data CACHE_DIR=.local/cache`. Läuft parallel der Test-Container auf 8080, einen anderen `PORT` setzen und Vite mit `API_URL=http://localhost:<PORT> npm run dev` starten. Im Dev-Server keine `FLASHAIR_IP` setzen, solange der Container mit derselben Karte synchronisiert.

## Struktur

```
src/shared/   Typen und Datumslogik für Server und Browser
src/server/   Fastify, Core (Steuerung), Scanner, sharp-Pipeline, Sync, Geräte-Clients
src/web/      Preact-Oberfläche (Vite-Root), Stile aus dem Design
test/         Vitest, FlashAir-Mock
scripts/      Test-Bilder erzeugen, Screenshots
example/      compose.yml + .env.dist für Endanwender (Image von Docker Hub)
.dev/         Interne Doku, Anforderungen, Design-Prototypen
```

## Regeln

- **Nie** in das Bilderverzeichnis (`PHOTOS_DIR`) schreiben. Es ist read-only eingebunden.
- **Spiegelbetrieb vorsichtig behandeln:** Auf der Karte nur Dateien direkt in `FLASHAIR_DIR` löschen, nie Ordner, nie geschützte Dateien (schreibgeschützt, versteckt, System, Punktdateien). Ein leerer oder fehlerhafter Scan darf nie zum Löschen auf der Karte führen.
- Auf die Karte kommen nur Rahmenbilder aus `/cache/frame`, nie Originale.
- Rahmenbilder sind Baseline-JPEGs (kein `mozjpeg: true` in sharp). Ändert sich die Aufbereitung, `FRAME_ENCODER_VERSION` in `src/server/config.ts` erhöhen.
- Oberfläche, Log-Meldungen, Fehlermeldungen und Code-Kommentare auf **Deutsch**; Bezeichner im Code auf Englisch.
- Die UI folgt dem abgenommenen Design (`.dev/design/`). Klassen und Maße kommen von dort. Abweichungen in `.dev/decisions.md` begründen.
- Barrierefreiheit: echte Buttons, ARIA-Beschriftungen, Touch-Ziele ≥ 44 px, Kontrast ≥ 4,5:1.
- Reine Logik (Auswahl, Zeitraum, Namen, Diff) gehört in testbare Funktionen ohne I/O (`sync/plan.ts`, `sync/runner.ts#diffCard`). Neue Logik bekommt Tests.
- Konfiguration nur über Umgebungsvariablen (`src/server/config.ts`, zod). Neue Variablen auch in `example/.env.dist` (kommentiert, dient Endanwendern als Referenz) und `.dev/requirements.md` (5.3) eintragen.
- Nach jeder Änderung: `npm run lint && npm run typecheck && npm test`.
- `.dev/status.md` und `.dev/decisions.md` aktuell halten.
- `README.md` ist ausschließlich für Endanwender: kurzer Projekt-Teaser plus Kurzanleitung. Entwicklerthemen gehören nach `.dev/`. Screenshots in `docs/screenshots/` mit `node scripts/screenshots.mjs` neu erzeugen, wenn sich die Oberfläche ändert.
- Keine Zugangsdaten einchecken. `.env*` (außer `example/.env.dist`), Zertifikate (`certs/`, `*.pem`, `*.key`), lokale Daten (`testdata/`, `.local/`, `data/`, `*.db`) sind in `.gitignore` und `.dockerignore`. Neue lokale Dateien mit Zugangsdaten dort ergänzen.
- Lizenz: GPL-3.0 (`LICENSE`). Neue Abhängigkeiten müssen GPL-3.0-kompatibel sein (MIT, BSD, ISC, Apache-2.0, LGPL o. ä.).

## Testgeräte

Siehe `.dev/testing.md`. Die Adressen von FlashAir und Shelly stehen nur in der lokalen `.env` (`FLASHAIR_IP`, `SHELLY_IP`); keine IPs oder Hostnamen des Heimnetzes einchecken. Der Shelly schaltet den Rahmen derzeit noch nicht. Den Webhook mit `curl` emulieren. Der Alt-Container `photorahmen` muss gestoppt sein.
