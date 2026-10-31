# Projekt-Dokumentation (intern)

Dokumentation für die Entwicklung. Die `README.md` im Hauptordner richtet sich nur an Endanwender.

| Datei | Inhalt |
|---|---|
| [requirements.md](requirements.md) | Anforderungen und Umsetzungsplan (Export des abgenommenen Claude-Docs) |
| [design/](design/) | Abgenommene Design-Prototypen: `mobile.dc.html`, `desktop.dc.html` |
| [architecture.md](architecture.md) | Module, Zustand, Sync-Ablauf, API, WebSocket |
| [decisions.md](decisions.md) | Entscheidungen und Abweichungen von den Anforderungen |
| [status.md](status.md) | Umsetzungsstand je Anforderung, offene Punkte |
| [testing.md](testing.md) | Tests, Test-Bilderordner, lokale Docker-Umgebung, Testgeräte |

Quellen der Originale:
- Anforderungen: https://claude.ai/artifact/Q2QGLtnsA9ZNgwvVKy3zSG
- Design: https://claude.ai/artifact/E15sJonABT9CQ4he4RLpRh

Die Design-Prototypen laden `./support.js` aus der Canvas-Umgebung und laufen deshalb nicht eigenständig. Sie dienen als Referenz für Markup, CSS und Verhalten (Klasse `Component` im Skript am Ende).
