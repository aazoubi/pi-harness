# pi-harness

Meine persönliche [pi](https://github.com/earendil-works/pi) Coding-Agent Konfiguration:
Settings, Extensions, Sub-Agents, Prompt-Templates und Themes — zum schnellen
Wiederherstellen auf einem neuen Rechner.

`pi` selbst ist **nicht** Teil dieses Repos, sondern wird als npm-Package installiert.

## Voraussetzungen

- Node.js (>= 20 empfohlen)
- `pi` als npm-Package installiert:

```bash
npm install -g @earendil-works/pi-coding-agent
```

## Installation

```bash
git clone https://github.com/aazoubi-da3m/pi-harness.git
cd pi-harness
./install.sh
```

Das Script kopiert die Konfiguration nach `~/.pi/agent/` (Pfad überschreibbar via
`PI_DIR=/pfad ./install.sh`). Existierende Dateien/Ordner werden vorher als
`*.bak.<timestamp>` gesichert, nichts wird stillschweigend überschrieben.

Danach einmalig einloggen (Auth-Daten sind bewusst **nicht** im Repo):

```bash
pi auth
```

## Inhalt

| Pfad | Zweck |
|---|---|
| `settings.json` | globale pi-Settings (Theme, Default-Provider/Model, installierte Packages) |
| `mcp.json` | MCP-Server-Konfiguration (z. B. Playwright) |
| `models-store.json` | zusätzliche/benutzerdefinierte Modell-Definitionen |
| `agents/` | Sub-Agent-Definitionen (planner, reviewer, scout, worker) |
| `extensions/` | eigene pi-Extensions (Memory, Side-Chat, Subagents-UI, Workflow-Runner, Firecrawl, Fast-Mode, Code-State, Tool-Display, RTK-Plugin …) |
| `prompts/` | wiederverwendbare Prompt-Templates |
| `themes/` | eigenes Terminal-Theme (Catppuccin Mocha) |

## Hinweise

- Dieses Repo ist **privat** und enthält keine Secrets/API-Keys. `auth.json` und
  Session-/Memory-Verlauf sind bewusst ausgeschlossen.
- Manche Extensions haben eigene `package.json`/Dependencies (z. B. `extensions/workflow`);
  dort ggf. `npm install` im jeweiligen Ordner ausführen.
- Nach dem Sync: pi neu starten, damit Settings/Extensions geladen werden.
