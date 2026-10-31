# Testen

## Automatisierte Tests

```bash
npm test            # Vitest: Unit-Tests + Integrationstests gegen den FlashAir-Mock
npm run lint
npm run typecheck
```

`test/flashair-mock.ts` bildet `command.cgi` (op=100/108/140) und `upload.cgi` nach und kann Abbrüche (`failAfterUploads`) und knappen Speicher (`capacityBytes`) simulieren.

## Test-Bilderordner

```bash
npm run photos:test   # erzeugt testdata/photos: 3 Jahre × 10 Ordner × 25 Bilder (ca. 30 MB)
```

Struktur `testdata/photos/<Jahr>/<yyyy-mm-dd>_<Titel>/IMG_nnn.jpg`. Enthalten sind Hochformat (jedes 5. Bild), EXIF-Orientation 6 (jedes 8.), gemischte Endungen und in jedem dritten Ordner der Unterordner `Handy/`. Jedes Bild zeigt Titel, Datum und einen Pfeil nach oben, damit Rotation und Zuschnitt auf dem Rahmen sofort erkennbar sind.

## Lokale Docker-Umgebung

```bash
docker compose -f compose.dev.yml up -d --build
docker logs -f photoframe-sync-dev
```

- Baut das Image aus dem Quellcode und bindet `testdata/photos` read-only als `/photos` ein.
- Zugangsdaten stehen in `.env` im Projektordner (nicht eingecheckt). Vorlage: `example/.env.dist`.
- Oberfläche: http://localhost:8080 bzw. `https://<host-ip>:8443`. HTTPS mit selbstsigniertem Zertifikat ist in `.env` aktiv, `http://` leitet um. Die Host-IP steht in `.env` unter `TLS_HOSTNAMES`. Zertifikat zum Prüfen: `docker cp photoframe-sync-dev:/data/tls/selfsigned-cert.pem .` und `curl --cacert selfsigned-cert.pem https://<host-ip>:8443/api/health`.
- Zustand und Cache liegen in den Volumes `photoframe-sync-dev_dev_data` und `photoframe-sync-dev_dev_cache`. Kompletter Neustart: `docker compose -f compose.dev.yml down -v`.

## Testgeräte

Die Adressen der Testgeräte stehen nur in der lokalen `.env` (nicht eingecheckt): `FLASHAIR_IP`, `SHELLY_IP`.

| Gerät | Adresse | Hinweis |
|---|---|---|
| FlashAir W-03 im Rahmen | `$FLASHAIR_IP` | Basic Auth (`admin`), Zugangsdaten in `.env`. Auf der Karte liegen außerdem `Anleitungen_Scripte/` und `.Trash-1000/`; der Sync muss beide unangetastet lassen |
| Shelly Plug S Gen3 | `$SHELLY_IP` | Keine Authentifizierung. **Schaltet den Rahmen derzeit noch nicht**, die Karte bleibt beim Ausschalten also erreichbar |

Der alte Container `photorahmen` schreibt ebenfalls auf diese Karte und muss während der Tests gestoppt sein (`docker stop photorahmen`), sonst löschen sich beide Apps gegenseitig die Dateien.

## Webhook emulieren

Der Shelly-Webhook ist noch nicht eingerichtet. So lässt er sich lokal auslösen (`WEBHOOK_TOKEN=devtoken` in `.env`):

```bash
curl -i "http://localhost:8080/api/hooks/power-on?token=devtoken"   # 202, Sync nach POWER_ON_SYNC_DELAY_SEC
curl -i "http://localhost:8080/api/hooks/power-on?token=falsch"     # 403
```

## Nützliche Aufrufe

```bash
curl -s localhost:8080/api/state | jq '.device, .sync, .plan'
curl -s -X POST localhost:8080/api/sync
curl -s -X POST -H 'Content-Type: application/json' -d '{"on":false}' localhost:8080/api/power

# Karte direkt prüfen
set -a; . ./.env; set +a
curl -s -u "$FLASHAIR_USER:$FLASHAIR_PASSWORD" "http://$FLASHAIR_IP/command.cgi?op=100&DIR=/"
```

## Screenshots

```bash
node scripts/screenshots.mjs http://localhost:8080 docs/screenshots
```

Nutzt das installierte Google Chrome über Playwright (Kanal `chrome`).
