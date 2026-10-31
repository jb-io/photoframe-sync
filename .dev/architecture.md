# Architektur

Ein Node.js-Prozess (Node 22, TypeScript, ESM) mit HTTP-Server, WebSocket, Scanner, Bildaufbereitung und Sync-Worker. Die Oberfläche ist eine Preact-SPA, die Vite nach `dist/web` baut und Fastify statisch ausliefert.

```
 /photos (ro) ──scan──► SQLite (/data/state.db) ──plan──► Soll-Liste ──sync──► FlashAir (WLAN-HTTP)
      │                        ▲                              │
      └──sharp──► /cache/thumbs, /cache/frame ◄───────────────┘
 Shelly Plug (RPC) ◄──Ein/Aus── Core ──WebSocket──► Browser (n Clients)
                     ──Webhook──►
```

## Module (`src/`)

| Datei | Aufgabe |
|---|---|
| `shared/types.ts` | Datentypen für REST und WebSocket (`Snapshot`, `ServerMessage`, `Selection` …) |
| `shared/dates.ts` | Datumsrechnung auf `yyyy-mm-dd`-Strings (Server und Browser identisch) |
| `server/index.ts` | Start: Konfiguration, Store, Core, HTTP- und optional HTTPS-Server, SIGTERM |
| `server/app.ts` | `buildApp`: Fastify-Instanz mit API, WebSocket, Oberfläche, optional HTTPS bzw. Umleitung |
| `server/tls.ts` | Zertifikat laden (eigene Dateien) oder selbstsigniert erzeugen/wiederverwenden; Dateien beobachten |
| `server/config.ts` | Umgebungsvariablen mit zod prüfen; `frameConfigHash` für den Rahmenbild-Cache |
| `server/db.ts` | `Store`: SQLite über `node:sqlite` (kv, folders, images, card_files) |
| `server/core.ts` | Zentrale Steuerung: Scan, Plan, Gerätestatus, Sync-Auslöser, Tageswechsel, Events |
| `server/routes.ts` | REST-API und WebSocket-Hub |
| `server/folders/parse.ts` | Ordnernamen `yyyy-mm-dd_<Titel>`, Jahresordner, JPEG-Erkennung, Ordner-ID |
| `server/folders/scanner.ts` | Bilderverzeichnis rekursiv lesen (Parallelität begrenzt) |
| `server/frame/processor.ts` | sharp-Pipeline: EXIF-Rotation, `crop`/`fill`/`crop+fill`, Baseline-JPEG, Vorschauen |
| `server/frame/cache.ts` | `/cache/frame` und `/cache/thumbs`: erzeugen, deduplizieren, aufräumen |
| `server/sync/plan.ts` | Reine Logik: Ordnerauswahl, Tages-Seed-Begrenzung, Reihenfolge, Kartennamen |
| `server/sync/runner.ts` | Ein Sync-Lauf: Soll/Ist-Diff, Löschen, Upload mit Wiederholung, Speicher-Check |
| `server/device/flashair.ts` | FlashAir-HTTP-Client (`command.cgi`, `upload.cgi`) |
| `server/device/shelly.ts` | Shelly-RPC-Client (`Switch.GetStatus`, `Switch.Set`, Neustart per `toggle_after`, Digest-Auth optional) |
| `web/store.ts` | WebSocket mit Reconnect/Backoff, Server-Zustand als Signal, REST-Aufrufe |
| `web/model.ts` | View-Model: Entwurf der Auswahl, Filter, Paginierung, Status-Texte (aus dem Design-Prototyp) |
| `web/parts.tsx`, `web/layouts.tsx` | Bausteine und die beiden Layouts (Mobil < 1024 px, Desktop) |
| `web/styles.css` | Stile aus dem Design; Dunkelmodus per `prefers-color-scheme` |

## Zustand (SQLite)

| Tabelle | Inhalt |
|---|---|
| `kv` | `selection`, `lastSyncAt`, `lastScanAt`, `cardFreeBytes`, `cardTotalBytes`, `cardReclaimableBytes`, `shuffleSeed`, `namingScheme`, `cardNames` (Soll-Zuordnung Quellbild → Kartenname) |
| `folders` | Letzter erfolgreicher Scan (ID, Name, Pfad, Datum, Titel, Bildanzahl) |
| `images` | Alle JPEGs je Ordner mit Änderungszeit |
| `card_files` | Was die App auf die Karte geschrieben hat: Kartenname → Quellbild, Rahmenbild-Schlüssel, Größe |

`card_files` ist die Grundlage für Inkrementalität und Fortsetzen: Jeder Upload wird sofort eingetragen. Vor jedem Lauf werden Einträge verworfen, deren Datei nicht mehr auf der Karte liegt.

## Ablauf eines Syncs

1. **Plan** (`Core.recomputePlan`): Ordner aus Auswahl und heutigem Datum (TZ), Bilder je Ordner (bei Begrenzung zufällig mit Seed `Datum|Ordnername`), Reihenfolge chronologisch, Kartennamen nach `NAMING`/`NAMING_ORDER`. Ergebnis: Liste `{rel, frameKey, cardName}`.
2. **pending** = Plan weicht von `card_files` ab. Das ist der Zustand „Sync ausstehend“.
3. **Lauf** (`runSync`): Kartenliste lesen (nur Dateien direkt in `FLASHAIR_DIR`, Ordner werden verworfen), Diff bilden, Überzähliges löschen (nicht geschützt: schreibgeschützt/versteckt/System/Punktdateien), dann je Bild: Rahmenbild sicherstellen, Platz prüfen, ggf. alte Datei gleichen Namens löschen, hochladen, `card_files` aktualisieren.
4. Danach Plan neu berechnen, Status per WebSocket verteilen.

Der Rahmenbild-Schlüssel ist `sha1(rel, mtime, frameConfigHash)`. Ändert sich eine bildrelevante Variable (oder `FRAME_ENCODER_VERSION` in `config.ts`), entstehen neue Schlüssel: Alles wird neu aufbereitet und übertragen, alte Rahmenbilder werden aufgeräumt.

## Auslöser

| Auslöser | Verhalten |
|---|---|
| „Speichern & Sync“ | Auswahl speichern; Sync sofort, wenn die Karte online ist |
| „Jetzt syncen“ | Sync sofort (nur online) |
| Karte wird erreichbar (Polling) | Sync, wenn `pending` und kein verzögerter Sync geplant ist |
| Webhook / Einschalten per App / Taste am Plug | `booting`, Sync nach `POWER_ON_SYNC_DELAY_SEC`; weitere Auslöser in der Wartezeit werden ignoriert |
| Scan findet Neues, Tageswechsel | Plan neu; Sync sofort, wenn online und sich der Plan geändert hat |

Läuft bereits ein Sync, wird ein Folgelauf vorgemerkt.

## HTTPS

Mit `HTTPS_ENABLED=true` laufen zwei Fastify-Instanzen aus `buildApp` mit denselben Routen und demselben `Core`:

| Server | Port | Verhalten |
|---|---|---|
| HTTP | `PORT` (8080) | Bei `HTTP_REDIRECT=true` 308-Umleitung auf `https://<host>:HTTPS_PUBLIC_PORT/…` (Standard `HTTPS_PORT`); ungültiger `Host` → 400. Ausgenommen: `/api/hooks/*` (Shelly kann kein selbstsigniertes Zertifikat prüfen) und `/api/health` (Docker-Healthcheck) |
| HTTPS | `HTTPS_PORT` (8443) | Volle App inkl. `wss://…/api/ws` |

Zertifikat (`tls.ts`):
- `TLS_CERT_FILE` + `TLS_KEY_FILE` gesetzt → diese Dateien. Alle 10 Minuten wird die Änderungszeit geprüft; bei Änderung `server.setSecureContext()` ohne Neustart.
- Sonst selbstsigniert unter `/data/tls/selfsigned-{cert,key}.pem` (Schlüssel `0600`): RSA 2048, SHA-256, 10 Jahre, SAN = `TLS_HOSTNAMES` + `localhost` + `127.0.0.1`. Wiederverwendet, solange es alle Namen abdeckt und noch > 30 Tage gilt; sonst neu erzeugt. Bewusst ohne Container-Hostnamen, weil der sich bei jedem Update ändert.

## Neustart und Schutz gegen Schleifen

Neustart (Button oder `RESTART_AFTER_SYNC`) = `Switch.Set?on=false&toggle_after=RESTART_OFF_SEC`. Der Shelly schaltet selbst wieder ein, danach läuft der normale Einschaltablauf: Webhook bzw. Polling → „startet …“ → verzögerter Sync.

Ohne Schutz entstünde eine Schleife: Sync → Neustart → Webhook → Sync → Neustart … Abgefangen wird das in `Core`:

- **Nur bei Änderungen:** Ein Neustart nach dem Sync erfolgt nur, wenn der Lauf etwas hochgeladen oder gelöscht hat.
- **Schutzfenster:** Jeder Neustart setzt `restartGuardUntil` = Ausschaltzeit + `BOOT_TIMEOUT_SEC` + `POWER_ON_SYNC_DELAY_SEC` + 60 s. Ein Sync, der vor diesem Zeitpunkt *startet*, merkt sich das und löst auch nach Ende (auch wenn er lange läuft oder Änderungen überträgt) keinen Neustart aus. Zusätzlich wird ein Neustart nach Sync innerhalb des Fensters übersprungen.
- **Wartezeit vor dem Neustart:** Nach dem Sync wartet die App `RESTART_DELAY_SEC` (Standard 10 s), damit die Karte ihre Schreibvorgänge abschließt; ein Stromausfall mitten im Schreiben kann das FAT-Dateisystem beschädigen. Startet in der Wartezeit ein neuer Sync, wird der Neustart an dessen Ende verschoben; wird ausgeschaltet, entfällt er.
- **Erst nach dem letzten Folgelauf:** Der Neustart wird vorgemerkt und erst ausgelöst, wenn kein Folgelauf mehr ansteht, damit er keinen laufenden Upload abbricht.
- **Aus-Phase:** Während der Aus-Phase meldet das Polling „Neustart …“ statt „ausgeschaltet“, und der verzögerte Sync wird verworfen.

Abgesichert durch `test/restart.test.ts` mit Shelly-Mock, der wie der echte Webhook `powerOnHook()` aufruft. Polling: `REACHABILITY_INTERVAL_SEC`, während des Startens alle 5 s. Ist der Shelly aus, gilt die Karte als offline und wird nicht abgefragt.

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Healthcheck |
| GET | `/api/state` | Vollständiger Snapshot |
| GET | `/api/folders?q=&from=&to=&page=&size=` | Ordnerliste mit Filter/Paginierung (`size=0`: alle) |
| PUT | `/api/selection` | Auswahl speichern (`Selection`) |
| POST | `/api/sync` | Sync starten (409, wenn offline) |
| POST | `/api/scan` | Ordner neu einlesen |
| POST | `/api/shuffle` | Reihenfolge neu mischen (`NAMING_ORDER=random`) |
| POST | `/api/power` | `{"on": true\|false}` über den Shelly |
| POST | `/api/power/restart` | Rahmen neu starten (409, wenn aus) |
| GET | `/api/hooks/power-on?token=` | Shelly-Webhook, antwortet sofort mit 202 |
| GET | `/api/thumbs/:id` | Vorschau eines Ordners (JPEG) |
| GET | `/api/ws` | WebSocket: zuerst `snapshot`, danach Teil-Updates |

WebSocket-Nachrichten: `snapshot`, `folders`, `scan`, `selection`, `frame`, `device`, `sync`, `plan` (siehe `shared/types.ts`).

## Oberfläche

Die Oberfläche hält einen **Entwurf** der Auswahl. „Nicht gespeichert“ heißt: Entwurf ≠ gespeicherte Auswahl. Speichert ein anderer Client, übernimmt ein Client ohne eigene Änderungen den neuen Stand. Ansicht, Gruppierung und Seitengröße liegen im `localStorage` (FA-14).

Rahmen-Status je Ordner (FA-12), aus Entwurf und Kartenstand berechnet:
- **Auf dem Rahmen**: ausgewählt und alle Soll-Bilder (gespeicherter Stand) auf der Karte
- **Upload ausstehend**: ausgewählt, aber noch nicht (vollständig) auf der Karte
- **Wird entfernt**: nicht ausgewählt, liegt aber auf der Karte
