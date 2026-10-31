<!-- Export des Claude-Docs „Bilderrahmen Sync – Anforderungen & Umsetzungsplan“
     Quelle: https://claude.ai/artifact/Q2QGLtnsA9ZNgwvVKy3zSG (Stand: Rev. 310, 31.10.2026)
     Das Original ist maßgeblich. Abweichungen in der Umsetzung stehen in decisions.md. -->

# Bilderrahmen Sync – Anforderungen & Umsetzungsplan

Stand: 31.10.2026

## 1. Ziel und Abgrenzung

Bilderrahmen Sync ist eine Web-App im Heimnetz, mit der man Bilder-Ordner vom Netzlaufwerk auswählt und auf einen digitalen Bilderrahmen (Toshiba FlashAir W-03) überträgt. Sie läuft als einzelner Node.js-Container und wird über GitHub Actions auf Docker Hub veröffentlicht. Das GitHub-Repository heißt jb-io/photoframe-sync, das Image auf Docker Hub jbiohub/photoframe-sync (Docker-Hub-Namespaces erlauben keine Bindestriche).

**Grundlage:** das abgenommene Design (Canvas „Bilderrahmen Sync – Design“, Mobil + Desktop), die Anforderungen aus diesem Projekt und die README des Vorgängerprojekts *photorahmen*. Bei Widersprüchen gelten die Anforderungen dieses Projekts (Abgleich in Kapitel 6).

**Im Umfang:**

- Ordner (Präfix `yyyy-mm-dd_`) aus einem **schreibgeschützt** eingebundenen Bilderverzeichnis auflisten, mit lazy geladener Vorschau.
- Auswahl **automatisch** (letzte 1–36 Monate) oder **manuell** (einzelne Ordner, mit Suche und Zeitraumfilter), dauerhaft gespeichert.
- Bilder für den Rahmen aufbereiten (Skalierung, Zuschnitt, JPEG) und mit der Karte spiegeln, sobald der Rahmen erreichbar ist.
- Rahmen ein- und ausschalten, Online-Status anzeigen, alle Änderungen per WebSocket live in der Oberfläche.

**Nicht im Umfang:**

- Hochladen, Bearbeiten oder Löschen von Originalbildern (das Bilderverzeichnis ist read-only).
- Benutzerkonten und Login: Betrieb nur im vertrauten Heimnetz.
- Mehrere Rahmen: Es gibt genau einen Rahmen.

## 2. Systemüberblick

*(Diagramm im Original-Dokument)*

Die Originale werden nur gelesen. Der Zustand liegt im Volume `/data`, alles Abgeleitete (Vorschauen, Rahmenbilder) im Cache-Ordner `/cache`. Zum Rahmen gehen zwei Wege: ausschließlich verkleinerte, optimierte Rahmenbilder per WLAN-HTTP auf die FlashAir, Strom über einen Shelly Plug Gen3.

**Begriffe:**

- **Ordner:** Unterordner der ersten Ebene von `/photos`, Name `yyyy-mm-dd_<Titel>`.
- **Rahmenbild:** die für den Rahmen zugeschnittene, verkleinerte und als JPEG optimierte Kopie eines Originals in `/cache/frame`. Nur Rahmenbilder werden übertragen.
- **Auswahl (Soll):** die Ordner, die auf dem Rahmen sein sollen, aus Modus und Umfang berechnet.
- **Karte (Ist):** die Dateien, die tatsächlich in `FLASHAIR_DIR` liegen.
- **Sync:** Abgleich von Soll und Ist: hochladen, was fehlt, löschen, was überzählig ist.
- **Sync ausstehend:** gespeicherte Auswahl, die noch nicht auf der Karte ist, weil der Rahmen offline war.

## 3. Funktionale Anforderungen

Version 1.0 umfasst alle Anforderungen mit Priorität *Muss* (37 von 44). *Soll* folgt, wenn es den Zeitplan nicht gefährdet, *Kann* bleibt optional.

### 3.1 Bildquelle und Ordner-Scan

| ID | Anforderung | Prio |
|---|---|---|
| FA-01 | Das Bilderverzeichnis ist read-only unter `/photos` eingebunden. Die App schreibt dort nie. | Muss |
| FA-02 | Erkannt werden Ordner der ersten Ebene mit dem Muster `yyyy-mm-dd_<Titel>`. Datum und Titel (Unterstriche als Leerzeichen) kommen aus dem Namen. | Muss |
| FA-03 | Berücksichtigt werden nur JPEG-Dateien (`.jpg`, `.jpeg`, Groß-/Kleinschreibung egal), auch in Unterordnern beliebiger Tiefe; sie zählen, als lägen sie direkt im Ordner. Je Ordner wird die Zahl dieser Bilder ermittelt. | Muss |
| FA-04 | Scan beim Start, im Intervall `SCAN_INTERVAL_SEC` und auf Knopfdruck. Ergebnisse gehen per WebSocket an die Oberfläche. | Muss |
| FA-05 | Ordner ohne gültiges Datumspräfix werden ignoriert und im Log (Stufe `debug`) genannt. | Muss |

### 3.2 Vorschau

| ID | Anforderung | Prio |
|---|---|---|
| FA-06 | Je Ordner ein Vorschaubild (erstes JPEG nach Pfad, Unterordner eingeschlossen), serverseitig verkleinert und in `/cache/thumbs` abgelegt. | Muss |
| FA-07 | Vorschauen laden lazy (nur sichtbare Kacheln) mit Platzhalter. Zugriffe auf das Netzlaufwerk sind auf `THUMB_CONCURRENCY` parallel begrenzt. | Muss |
| FA-08 | Der Cache eines Ordners wird erneuert, wenn sich dessen Inhalt ändert (Änderungszeit). | Soll |

### 3.3 Ordnerliste

| ID | Anforderung | Prio |
|---|---|---|
| FA-09 | Kachel- und Listenansicht umschaltbar. Die Liste zeigt zusätzlich den vollen Ordnernamen. | Muss |
| FA-10 | Gruppierung nach Jahr oder Monat, neueste zuerst. | Muss |
| FA-11 | Je Ordner: Titel, Datum, Bildanzahl (bei Begrenzung als „50 / 142“) und Rahmen-Status. | Muss |
| FA-12 | Rahmen-Status je Ordner: *Auf dem Rahmen*, *Upload ausstehend*, *Wird entfernt* oder keiner. Unterscheidung ohne Rot/Grün. | Muss |
| FA-13 | Paginierung „Zeige 12 / 24 / 48 / Alle“ mit Bereichsanzeige und Vor/Zurück. Bei Filteränderung zurück auf Seite 1. | Muss |
| FA-14 | Ansicht, Gruppierung und Seitengröße merkt sich der Browser. | Kann |

### 3.4 Auswahlmodus

| ID | Anforderung | Prio |
|---|---|---|
| FA-15 | Expliziter Umschalter *Automatisch* oder *Manuell*; genau einer ist aktiv. | Muss |
| FA-16 | Automatisch: Zeitraum 1 bis 36 Monate in Monatsschritten, relativ zum aktuellen Datum (Regler, Plus/Minus, Sprungmarken). | Muss |
| FA-17 | Automatisch: Die Auswahl wird täglich und vor jedem Sync neu berechnet. Neue Ordner kommen dazu, ältere fallen heraus. | Muss |
| FA-18 | Manuell: Ordner einzeln an- und abwählen, „Alle/Keine“ je Gruppe, „Auswahl leeren“. | Muss |
| FA-19 | Manuell: Suche im Ordnernamen (Teilstring, ohne Groß-/Kleinschreibung). | Muss |
| FA-20 | Manuell: Zeitraumfilter per Zeitstrahl von Januar 1991 bis heute, monatsgenau (Start- und Endmonat anklicken), oder per Von/Bis-Feld. Er filtert nur die Anzeige. | Muss |
| FA-21 | Beim Wechsel von Automatisch zu Manuell wird die aktuelle Automatik-Auswahl übernommen. | Soll |

### 3.5 Übertragungsumfang

| ID | Anforderung | Prio |
|---|---|---|
| FA-22 | Wahl zwischen „Alle Bilder“ und „Begrenzt pro Ordner“ mit 1 bis 999 Bildern (Stepper, Schnellwahl 10 / 25 / 50 / 100). | Muss |
| FA-23 | Bei Begrenzung werden die Bilder eines Ordners **zufällig** gewählt, mit einem **Seed pro Tag** (Datum in `TZ` plus Ordnername). Innerhalb eines Tages bleibt die Auswahl stabil, ab Mitternacht gilt eine neue. Der Tageswechsel erzeugt eine neue Soll-Liste; ist der Rahmen online, startet der Sync sofort, sonst beim nächsten Einschalten. | Muss |
| FA-24 | Die resultierende Bildmenge wird angezeigt. Übersteigt sie den freien Speicher der Karte, erscheint eine Warnmeldung; der Sync wird nicht blockiert und bricht bei vollem Speicher sauber ab. | Soll |

### 3.6 Speichern und Synchronisation

| ID | Anforderung | Prio |
|---|---|---|
| FA-25 | Modus, Auswahl und Umfang werden serverseitig gespeichert, unabhängig davon, ob der Rahmen online ist. | Muss |
| FA-26 | Ist der Rahmen online, startet „Speichern & synchronisieren“ den Sync sofort. | Muss |
| FA-27 | Ist er offline, wird gespeichert und „Sync ausstehend“ gesetzt. Der Sync startet automatisch, sobald der Rahmen erreichbar ist (Webhook oder Erreichbarkeitsprüfung). | Muss |
| FA-28 | Anzeige von: letztem erfolgreichem Sync (Zeitpunkt), ausstehendem Sync, laufendem Sync mit Fortschritt (Dateien x von y) und ungespeicherten Änderungen. | Muss |
| FA-29 | Spiegelbetrieb: Dateien, die nicht mehr zur Auswahl gehören, werden von der Karte gelöscht. Nur direkt in `FLASHAIR_DIR`; Unterordner, versteckte, schreibgeschützte und System-Dateien bleiben unberührt. | Muss |
| FA-30 | Inkrementell: Nur neue oder geänderte Dateien werden übertragen. Ein abgebrochener Sync setzt beim nächsten Lauf fort. | Muss |
| FA-31 | Dateibenennung per `NAMING` (`dcim` oder `original`) und `NAMING_ORDER` (`original` oder `random`), bei `random` mit Aktion „Reihenfolge neu mischen“. Standard ist `random`: Die Bilder bekommen beim Upload zufällige Nummern, bereits vergebene Nummern bleiben stabil. | Soll |

### 3.7 Bildaufbereitung

| ID | Anforderung | Prio |
|---|---|---|
| FA-32 | Zuschnitt und Verkleinerung wie in photorahmen: Aus jedem Original entsteht ein Rahmenbild mit EXIF-Rotation, Zielgröße `TARGET_WIDTH` × `TARGET_HEIGHT`, Zuschnitt per `FIT_MODE` (`crop`, `fill`, `crop+fill`) mit `CROP_GRAVITY` und `FILL_BACKGROUND`, optimiert als JPEG (`JPEG_QUALITY`, Metadaten entfernt). **Auf die Karte gelangen ausschließlich Rahmenbilder, nie Originale****.** | Muss |
| FA-33 | Rahmenbilder liegen im Cache-Ordner `/cache/frame`, Schlüssel aus Pfad, Änderungszeit und Konfigurations-Hash. Aufbereitet wird nur, was ausgewählt ist und noch nicht im Cache liegt. Nicht mehr ausgewählte Rahmenbilder werden aufgeräumt. Ändert sich die Zielkonfiguration, wird alles neu aufbereitet. | Muss |
| FA-34 | Hochkantbilder werden nicht automatisch gedreht. | Muss |

### 3.8 Gerät: Status und Ein/Aus

| ID | Anforderung | Prio |
|---|---|---|
| FA-35 | Der Online-Status der Karte (Prüfung per `command.cgi?op=108`) steht im Kopf, mit eindeutigem Icon für *online* und *offline*. | Muss |
| FA-36 | Ein/Aus schaltet den Rahmen vollständig über einen **Shelly Plug Gen3** mit fest konfigurierter IP-Adresse (`SHELLY_IP`, RPC-Aufruf `Switch.Set`). Aus heißt offline. Der Schaltzustand wird vom Shelly gelesen (`Switch.GetStatus`), damit auch ein Druck auf die Taste am Plug angezeigt wird. Nach dem Einschalten zeigt die UI „startet …“ und startet den Sync verzögert wie bei FA-37. Neben Ein/Aus gibt es **Neustart**: aus und nach `RESTART_OFF_SEC` wieder an (der Shelly schaltet per `toggle_after` selbst wieder ein). Nach einem Sync, der etwas auf der Karte geändert hat, startet die App den Rahmen nach einer Wartezeit (`RESTART_DELAY_SEC`, damit die Karte fertig schreiben kann) automatisch neu (`RESTART_AFTER_SYNC`, abschaltbar). Ein Sync, der innerhalb des Neustart-Fensters startet (Ausschaltzeit + `BOOT_TIMEOUT_SEC` + `POWER_ON_SYNC_DELAY_SEC` + 60 s), löst nie einen weiteren Neustart aus. So entsteht mit dem Webhook keine Neustart-Schleife. | Muss |
| FA-37 | GET-Endpunkt `/api/hooks/power-on?token=…`, den der Shelly per Webhook nach dem Einschalten aufruft. Er antwortet sofort und startet den Sync um `POWER_ON_SYNC_DELAY_SEC` (Default 30 s) verzögert. Weitere Aufrufe in der Wartezeit lösen keinen zweiten Sync aus. Polling im Intervall `REACHABILITY_INTERVAL_SEC` bleibt als Rückfall. | Muss |
| FA-38 | Freier Speicher auf der Karte wird angezeigt. | Soll |

### 3.9 Live-Updates

| ID | Anforderung | Prio |
|---|---|---|
| FA-39 | Eine WebSocket-Verbindung je Client. Der Server pusht Geräte- und Power-Status, Sync-Status mit Fortschritt, Scan-Ergebnisse, fertige Vorschauen und gespeicherte Auswahl, sodass mehrere Clients synchron bleiben. | Muss |
| FA-40 | Automatischer Reconnect mit Backoff. Nach jedem (Re-)Connect schickt der Server einen vollständigen Status-Snapshot. | Muss |

### 3.10 Oberfläche

| ID | Anforderung | Prio |
|---|---|---|
| FA-41 | Umsetzung nach dem abgenommenen Design: mobile first, am Desktop mit Seitenleiste. | Muss |
| FA-42 | Hell- und Dunkelmodus nach Systemeinstellung. | Soll |
| FA-43 | Barrierearm: echte Buttons, vollständig per Tastatur bedienbar, ARIA-Beschriftungen, Kontrast mindestens 4,5:1, Touch-Ziele mindestens 44 px. | Muss |
| FA-44 | Oberfläche auf Deutsch. | Muss |

## 4. Nicht-funktionale Anforderungen

Der Container läuft dauerhaft und ohne Aufsicht auf einem Heimserver, daher stehen Robustheit gegenüber langsamem Netzlaufwerk und langsamer Karte im Vordergrund.

| ID | Thema | Anforderung |
|---|---|---|
| NFA-01 | Plattform | Node.js 22 LTS (mindestens 22.13 wegen des eingebauten `node:sqlite`). Vorschlag: TypeScript, Fastify mit WebSocket-Plugin, `sharp` für Bilder, Frontend mit Vite. |
| NFA-02 | Performance | Die erste Seite der Ordnerliste steht bei 2.000 Ordnern in unter 1 s (ohne Vorschauen). Scan-Ergebnisse werden gecacht, Vorschauen nachgeladen. |
| NFA-03 | Robustheit Quelle | Ist das Netzlaufwerk nicht erreichbar, bleibt der letzte Scan sichtbar und die UI meldet es. Kein Absturz, kein Löschen auf der Karte aufgrund eines leeren Scans. |
| NFA-04 | Robustheit Karte | WLAN der Karte schafft etwa 1–2 MB/s: Uploads nacheinander, mit Timeout und Wiederholung. Offline ist der Normalfall, kein Fehler. |
| NFA-05 | Sicherheit | Keine Anmeldung, Betrieb nur im Heimnetz. Bilderordner read-only. Zugangsdaten nur per Umgebungsvariable. Webhook optional per Token (`WEBHOOK_TOKEN`) abgesichert. Optional HTTPS (`HTTPS_ENABLED`): eigenes Zertifikat (`TLS_CERT_FILE`/`TLS_KEY_FILE`, Erneuerung wird ohne Neustart übernommen) oder selbstsigniert, 10 Jahre gültig, gespeichert in `/data/tls`. Die Oberfläche wird dann von HTTP auf HTTPS umgeleitet; Webhook und Healthcheck bleiben per HTTP erreichbar. |
| NFA-06 | Container-Benutzer | Läuft als Benutzer `node` (UID 1000), nicht als root. Auf den Bilderordner braucht er nur Leserechte. |
| NFA-07 | Persistenz | Zustand (Auswahl, Sync-Stand, Dateizuordnung) in SQLite im Volume `/data`. Überlebt Neustarts und Image-Updates. |
| NFA-08 | Betrieb | Healthcheck `GET /api/health` plus Docker-`HEALTHCHECK`. Logs strukturiert auf stdout, Stufe per `LOG_LEVEL`, Zeitzone per `TZ`. |
| NFA-09 | Image | Multi-Arch `linux/amd64` und `linux/arm64`, schlankes Basis-Image, Ziel unter 250 MB. |
| NFA-10 | Qualität | Unit-Tests für Namensparser, Auswahl- und Zeitraumlogik, Aufbereitung. Integrationstests gegen einen FlashAir-Mock. Die CI führt Lint und Tests vor jedem Publish aus. |
| NFA-11 | Browser | Aktuelle Versionen von Safari (iOS), Chrome (Android) sowie Chrome, Firefox, Safari und Edge am Desktop. |

## 5. Betrieb und Deployment

Ausgeliefert wird ein fertiges Image auf Docker Hub. Betrieben wird es mit `compose.yml` und `.env` aus dem Ordner `example/`. Nutzer bauen also nichts selbst.

### 5.1 Container

- Multi-Stage-`Dockerfile`: Build-Stage (Frontend und Backend bauen, Abhängigkeiten installieren), Runtime-Stage auf `node:22-slim` mit nur den Produktionsabhängigkeiten.
- Im Container läuft genau ein Node.js-Prozess: HTTP-Server, WebSocket, Scanner, Aufbereitung und Sync-Worker.
- `USER node`, `EXPOSE 8080 8443`, `HEALTHCHECK` auf `/api/health`.
- Sauberes Herunterfahren bei `SIGTERM`: laufender Upload wird abgeschlossen oder sauber abgebrochen, Zustand gesichert.

### 5.2 Mounts und Volumes

| Pfad im Container | Art | Inhalt |
|---|---|---|
| `/photos` | Bind-Mount, **read-only** (`:ro`) | Bilderordner vom Netzlaufwerk (auf dem Host per NFS/SMB eingehängt). Source of Truth. |
| `/data` | Volume `photoframe_data` | `state.db` (SQLite): Auswahl, Sync-Stand, Dateizuordnung. Nicht löschen. |
| `/cache` | Volume `photoframe_cache` | `thumbs/` (Vorschauen) und `frame/` (Rahmenbilder für den Upload). Darf gelöscht werden; alles wird bei Bedarf neu erzeugt. |

### 5.3 Konfiguration

Alle Einstellungen per Umgebungsvariable. Werte in eckigen Klammern sind vom Nutzer einzutragen.

| Variable | Default | Bedeutung |
|---|---|---|
| `PHOTOS_DIR` | `/photos` | Pfad des read-only Bilderordners im Container |
| `CACHE_DIR` | `/cache` | Cache-Ordner für Vorschauen (`thumbs/`) und Rahmenbilder (`frame/`) |
| `SCAN_INTERVAL_SEC` | `3600` | Abstand der automatischen Ordner-Scans |
| `THUMB_SIZE` | `480` | Lange Kante der Vorschaubilder in px |
| `THUMB_CONCURRENCY` | `2` | Parallele Lesezugriffe für Vorschauen |
| `FLASHAIR_IP` | – | IP der Karte. Leer = Sync deaktiviert |
| `FLASHAIR_USER` / `FLASHAIR_PASSWORD` | – | HTTP Basic Auth der Karte |
| `FLASHAIR_DIR` | `/` | Zielordner auf der Karte |
| `REACHABILITY_INTERVAL_SEC` | `60` | Polling-Abstand für Karte und Shelly-Schaltzustand (Rückfall zum Webhook) |
| `SYNC_DELETE_EXTRA` | `true` | Spiegelbetrieb: überzählige Dateien auf der Karte löschen |
| `NAMING` | `dcim` | `dcim` (`IMG_0001.JPG`) oder `original` |
| `NAMING_ORDER` | `random` | `random` (zufällige Nummern beim Upload) oder `original` (chronologisch) |
| `TARGET_WIDTH` / `TARGET_HEIGHT` | `800` / `600` | Zielauflösung des Rahmens |
| `FIT_MODE` | `crop` | `crop`, `fill` oder `crop+fill` |
| `FILL_BACKGROUND` | `blur` | `blur` oder Hex-Farbe |
| `CROP_GRAVITY` | `attention` | `center`, `attention` oder `entropy` |
| `CROP_MAX_RATIO` | `0.2` | Nur bei `crop+fill`: maximal weggeschnittener Anteil |
| `JPEG_QUALITY` | `88` | JPEG-Qualität der Rahmenbilder |
| `SHELLY_IP` | – | Feste IP des Shelly Plug Gen3, der den Rahmen schaltet. Leer = Ein/Aus ausgeblendet |
| `SHELLY_SWITCH_ID` | `0` | Kanal des Schaltausgangs am Shelly |
| `SHELLY_PASSWORD` | – | Nur nötig, wenn am Shelly die Authentifizierung aktiv ist (Digest, Benutzer `admin`) |
| `POWER_ON_SYNC_DELAY_SEC` | `30` | Verzögerung zwischen Einschalten bzw. Webhook-Aufruf und Sync-Start |
| `BOOT_TIMEOUT_SEC` | `120` | So lange gilt der Rahmen nach dem Einschalten als „startet …“ |
| `RESTART_AFTER_SYNC` | `true` | Rahmen nach einem Sync mit Änderungen per Shelly neu starten. Nur mit SHELLY_IP |
| `RESTART_OFF_SEC` | `5` | So lange bleibt der Rahmen beim Neustart aus (Sekunden) |
| `RESTART_DELAY_SEC` | `10` | Wartezeit zwischen Sync-Ende und Neustart, damit die Karte fertig schreiben kann (Sekunden) |
| `WEBHOOK_TOKEN` | – | Optionales Token für `GET /api/hooks/power-on`, übergeben als `?token=` |
| `PORT` | `8080` | Port der Web-UI |
| `HTTPS_ENABLED` | `false` | HTTPS einschalten. Ohne eigenes Zertifikat wird ein selbstsigniertes erzeugt (10 Jahre, in /data/tls) |
| `HTTPS_PORT` | `8443` | Port für HTTPS |
| `HTTPS_PUBLIC_PORT` | = HTTPS_PORT | Ziel der HTTP→HTTPS-Umleitung, falls der Host-Port vom Container-Port abweicht |
| `TLS_CERT_FILE / TLS_KEY_FILE` | – | Eigenes Zertifikat (PEM), z. B. aus einem nach /certs eingebundenen Ordner. Nur gemeinsam setzen |
| `TLS_HOSTNAMES` | – | Nur selbstsigniert: zusätzliche Namen und IPs, kommagetrennt |
| `HTTP_REDIRECT` | `true` | Oberfläche von HTTP auf HTTPS umleiten (Webhook und Healthcheck ausgenommen) |
| `TZ` | `Europe/Berlin` | Zeitzone (relevant für die Zeitraum-Berechnung) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

### 5.4 Ordner `example/`

Im Repository liegt `example/` mit zwei Dateien, die man kopiert und anpasst:

- `example/.env.dist`: alle Variablen aus 5.3 mit Defaults und Kommentaren, Pflichtwerte leer.
- `example/compose.yml`: zieht das Image von Docker Hub, kein Build. Kern:

```yaml
services:
  photoframe-sync:
    image: jbiohub/photoframe-sync:latest
    env_file: .env
    ports:
      - "${PORT:-8080}:${PORT:-8080}"
      - "${HTTPS_PORT:-8443}:${HTTPS_PORT:-8443}"
    volumes:
      - [PFAD_ZUM_BILDERORDNER]:/photos:ro
      - photoframe_data:/data
      - photoframe_cache:/cache
    restart: unless-stopped
volumes:
  photoframe_data:
  photoframe_cache:
```

Schnellstart: beide Dateien in einen eigenen Ordner kopieren, `.env.dist` in `.env` umbenennen, Werte eintragen, dort `docker compose up -d`. `.env` und `compose.yml` liegen so im selben Verzeichnis, wie Compose es für `env_file` und die Variablen-Ersetzung erwartet.

### 5.5 CI/CD-Pipeline (GitHub Actions)

Code liegt im GitHub-Repository `jb-io/photoframe-sync`, das Image auf Docker Hub unter `jbiohub/photoframe-sync`. Workflow `.github/workflows/docker-publish.yml`:

1. **Auslöser:** Push auf `main`, Tags `v*`, Pull Requests (nur bauen und testen, kein Publish).
2. **Job ****`test`****:** `npm ci`, Lint, Typprüfung, Unit- und Integrationstests.
3. **Job ****`publish`** (nur wenn `test` grün): QEMU und Buildx einrichten, Login bei Docker Hub mit den Secrets `DOCKERHUB_USERNAME` und `DOCKERHUB_TOKEN`, Multi-Arch-Build (`amd64`, `arm64`) mit Build-Cache, Push.
4. **Tags** per `docker/metadata-action`: `latest` für `main`, `1.2.3` / `1.2` / `1` für Release-Tags, zusätzlich `sha-<kurz>`.
5. Optional: Beschreibung auf Docker Hub aus der README aktualisieren.

### 5.6 Shelly Plug Gen3 einrichten

Der Plug wird von der App per lokaler RPC-API geschaltet und meldet sich selbst per Webhook zurück.

1. Dem Shelly im Router eine feste IP geben (DHCP-Reservierung) und sie als `SHELLY_IP` eintragen. Test: `http://<SHELLY_IP>/rpc/Switch.GetStatus?id=0` liefert den Schaltzustand.
2. In der Weboberfläche des Shelly unter *Actions* einen Webhook für das Ereignis *Switch turned on* anlegen, URL: `http://<host>:8080/api/hooks/power-on?token=<WEBHOOK_TOKEN>`.
3. Ablauf: Einschalten (per App, Taste am Plug oder Automation) → Shelly ruft den Endpunkt auf → App zeigt „startet …“ → nach `POWER_ON_SYNC_DELAY_SEC` prüft sie die Karte und synchronisiert. Ist die Karte dann noch nicht erreichbar, übernimmt das Polling.

## 6. Abgleich mit der README von photorahmen

Aus der README übernehmen wir die komplette Bildaufbereitung und den FlashAir-Sync. Verworfen wird alles, was Schreibzugriff auf die Bilder braucht, denn der Bilderordner ist hier read-only.

| Thema | README photorahmen | Dieses Projekt | Entscheidung |
|---|---|---|---|
| Bildquelle | Beschreibbarer Ordner `./input`, Upload über die Web-UI | Read-only Ordner vom Netzlaufwerk unter `/photos` | Verworfen |
| Upload, Kamera, Zuschnitt pro Bild | Mehrfach-Upload, Kamera, Vollbild-Zuschnitt mit Pinch-Zoom, `UPLOAD_MAX_EDGE` | Entfällt; Zuschnitt nur automatisch per `FIT_MODE` | Verworfen |
| Löschen | Löscht Original, verarbeitetes Bild und Kopie auf der Karte | Nur Abwählen; das Original bleibt unberührt | Verworfen |
| Einheit der Auswahl | Galerie einzelner Bilder | Ordner mit Vorschau, Auswahl automatisch oder manuell | Angepasst |
| Bildaufbereitung | EXIF-Rotation, Fit-Modi, Skalierung, JPEG, zugehörige Variablen | Übernommen: automatischer Zuschnitt, Verkleinerung und JPEG-Optimierung (FA-32 bis FA-34). Hochgeladen werden nur Rahmenbilder aus `/cache/frame`. | Übernommen |
| Zielgerät | FlashAir W-03 im STA-Modus, `UPLOAD=1`, Test per `op=108` | Gleiches Zielgerät; die Inbetriebnahme-Anleitung wandert in die neue README | Übernommen |
| Spiegelbetrieb | `SYNC_DELETE_EXTRA`, Unterordner und Systemdateien geschützt | Übernommen (FA-29) | Übernommen |
| Sync-Auslöser | Beim Start, im festen Intervall, nach jeder Verarbeitung | Nach dem Speichern, per Webhook und per Erreichbarkeitsprüfung; `SYNC_INTERVAL_SEC` wird zu `REACHABILITY_INTERVAL_SEC` | Angepasst |
| Dateibenennung | `NAMING`, `NAMING_ORDER`, Neu mischen | Übernommen (FA-31) | Übernommen |
| Neuaufbereitung | Bei geänderter Zielkonfiguration automatisch | Übernommen (FA-33) | Übernommen |
| Speicherorte | Volumes `photorahmen_output` und `photorahmen_state` | Volume `/data` für `state.db`, Cache-Ordner `/cache` für Vorschauen und Rahmenbilder | Angepasst |
| Auslieferung | `.env.example` im Root, `docker compose up --build` | `example/.env.dist` und `example/compose.yml`, fertiges Image von Docker Hub | Angepasst |
| Authentifizierung | Keine, nur Heimnetz | Keine; zusätzlich optionales Webhook-Token | Übernommen |
| Container-Rechte | Benutzer `node`, braucht Schreibrecht auf `./input` | Benutzer `node`, nur Leserecht auf `/photos` | Angepasst |
| Statusanzeige | Karte erreichbar, freier Speicher, offene Uploads, Warteschlange | In der Statuskarte des Designs (FA-28, FA-35, FA-38) | Übernommen |
| Aktualisierung der UI | Nicht beschrieben | Live per WebSocket (FA-39, FA-40) | Angepasst |
| Mobile und Dark Mode | Einspaltig, große Bedienelemente, Dark Mode | Abgenommenes Design, Dunkelmodus nach Systemeinstellung | Übernommen |
| Entwicklung | Node 22.5 oder neuer, `npm run dev`, `CLAUDE.md`, `PROJECT_CONTEXT.md` | Übernommen | Übernommen |

Neu und ohne Vorbild in der README sind: Auswahlmodus Automatisch/Manuell, Zeitstrahl-Filter, Übertragungsumfang pro Ordner, Ein/Aus-Schalter, Webhook und die Docker-Hub-Pipeline.

## 7. Offene Punkte

Alle Fragen sind entschieden und in die Anforderungen eingearbeitet; Ein/Aus und Webhook waren schon vorher mit dem Shelly Plug Gen3 geklärt.

| Frage | Entscheidung | Eingearbeitet in |
|---|---|---|
| Begrenzung pro Ordner | Zufällige Auswahl mit Seed pro Tag: täglich neue Bilder, innerhalb eines Tages stabil | FA-23, Phase 3 |
| Unterordner | Bilder in Unterordnern zählen, als lägen sie im Hauptordner | FA-03, FA-06 |
| Ordner ohne Datumspräfix | Werden ignoriert | FA-05 |
| Dateitypen | Nur JPG/JPEG | FA-03 |
| Neustart nach Sync | Automatischer Neustart nach einem Sync mit Änderungen, abschaltbar per `RESTART_AFTER_SYNC`, mit Schutz gegen Neustart-Schleifen | FA-36 |
| Speicher voll | Warnmeldung reicht | FA-24 |
| Anzahl Rahmen | Genau ein Rahmen | Kapitel 1 |
| Zielauflösung | 800 × 600 | Kapitel 5.3 (Default) |
| Repository und Image | GitHub: `jb-io/photoframe-sync`, Docker Hub: `jbiohub/photoframe-sync` | Kapitel 1, 5.2, 5.4, 5.5 |

Fragen, die während der Umsetzung neu entstehen, werden hier ergänzt.

## 8. Umsetzungsplan

Sieben Phasen, jede endet mit einem lauffähigen, über die Pipeline veröffentlichten Image. Die Pipeline steht deshalb ganz am Anfang. Phase 3 (Aufbereitung) kann parallel zu Phase 2 laufen, weil sie nur das Backend betrifft.

*(Diagramm im Original-Dokument)*

### Phase 0: Fundament und Pipeline

- Repository mit TypeScript, Lint, Tests, `CLAUDE.md`, `PROJECT_CONTEXT.md`.
- Fastify-Gerüst mit `/api/health`, Konfiguration aus Umgebungsvariablen mit Prüfung beim Start.
- `Dockerfile` (Multi-Stage, `USER node`, `HEALTHCHECK`), Workflow `docker-publish.yml`, Ordner `example/`.

**Abnahme:** Ein Push auf `main` legt `latest` für `amd64` und `arm64` auf Docker Hub ab. Mit `example/` startet der Container, `/api/health` antwortet mit 200, `/photos` ist read-only eingebunden.

### Phase 1: Ordner-Scan, API und WebSocket

- Scanner für `/photos` (FA-01 bis FA-05), SQLite-Schema, REST-API für Ordner mit Filter und Paginierung.
- Vorschau-Endpunkt mit Cache und Parallelitätslimit (FA-06 bis FA-08).
- WebSocket-Server mit Snapshot beim Verbinden und Scan-Ereignissen (FA-39, FA-40).

**Abnahme:** Bei 2.000 Testordnern steht die erste Seite in unter 1 s. Vorschauen laden nur auf Anforderung. Ein Schreibversuch nach `/photos` schlägt fehl, ohne dass die App abstürzt.

### Phase 2: Web-Oberfläche und Auswahl

- Frontend nach dem abgenommenen Design, mobil und Desktop (FA-41 bis FA-44).
- Ordnerliste, Ansichten, Gruppierung, Paginierung (FA-09 bis FA-14).
- Auswahlmodus, Suche, Zeitstrahl, Übertragungsumfang, Speichern (FA-15 bis FA-25).
- Rahmen-Status je Ordner zunächst aus dem gespeicherten Soll-Zustand.

**Abnahme:** Alle genannten Anforderungen sind im Browser bedienbar. Eine Änderung in einem Browser erscheint ohne Neuladen in einem zweiten.

### Phase 3: Bildaufbereitung

- Pipeline mit `sharp`: EXIF-Rotation, Zuschnitt per Fit-Modus, Verkleinerung, JPEG-Optimierung (FA-32 bis FA-34).
- Cache-Ordner `/cache/frame` mit Neuaufbereitung bei geänderter Zielkonfiguration und Aufräumen nicht mehr ausgewählter Bilder (FA-33).
- Auswahlregel für die Begrenzung pro Ordner (FA-23).

**Abnahme:** Testbilder in Hoch- und Querformat ergeben je Fit-Modus ein Rahmenbild in 800 × 600. Bei Begrenzung liefert derselbe Tag dieselbe zufällige Auswahl, der Folgetag eine andere. Eine geänderte `TARGET_WIDTH` löst beim Start die Neuaufbereitung aus.

### Phase 4: Sync zur FlashAir

- FlashAir-Client: Erreichbarkeit, Dateiliste, Upload, Löschen, freier Speicher.
- Sync-Planer (Soll gegen Ist), Spiegelregeln, Benennung, Fortsetzen nach Abbruch (FA-26 bis FA-31).
- Erreichbarkeits-Polling, Zustand „Sync ausstehend“, Fortschritt per WebSocket (FA-27, FA-28, FA-35).

**Abnahme:** Gegen einen FlashAir-Mock und eine echte Karte: Es werden nur Änderungen übertragen. Ein abgebrochener Sync setzt fort. Unterordner bleiben unberührt. Offline gespeicherte Änderungen werden automatisch übertragen, sobald die Karte erreichbar ist.

### Phase 5: Gerätesteuerung und Webhook

- Shelly-Client (RPC `Switch.Set`, `Switch.GetStatus`, optional Digest-Auth), Ein/Aus in der UI, Zustand „startet …“ mit `BOOT_TIMEOUT_SEC` (FA-36).
- GET-Webhook `/api/hooks/power-on` mit optionalem Token und um `POWER_ON_SYNC_DELAY_SEC` verzögertem Sync (FA-37).
- Anzeige des freien Speichers und Warnung bei zu großer Auswahl (FA-24, FA-38).

**Abnahme:** Ausschalten in der App schaltet den Shelly und zeigt in allen Clients sofort *offline*. Ein Druck auf die Taste am Plug erscheint spätestens nach einem Polling-Intervall in der UI. Der Shelly-Webhook löst genau einen Sync aus, frühestens 30 s nach dem Aufruf. Ein Aufruf ohne gültiges Token wird abgelehnt.

### Phase 6: Härtung und Release 1.0

- Fehlerfälle: Netzlaufwerk weg, Karte voll, Abbruch mitten im Upload (NFA-03, NFA-04).
- Sauberes Herunterfahren, strukturierte Logs, Barrierefreiheits-Prüfung.
- README mit Schnellstart und FlashAir-Inbetriebnahme, Release-Tag `v1.0.0`.

**Abnahme:** Der Tag `v1.0.0` veröffentlicht die Image-Tags `1.0.0`, `1.0`, `1` und `latest`. Der Container läuft sieben Tage ohne Neustart und ohne manuellen Eingriff.
