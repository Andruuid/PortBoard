# Portboard

Portboard is a private Windows dashboard for the Next.js, Node.js, and Bun apps
currently listening on your machine. It shows each app's port, package name,
project folder, and Git branch, with actions to open the site or stop its verified
process tree.

## Start Portboard

Double-click `start-portboard.cmd`, or run:

```powershell
npm run dashboard
```

The launcher installs or rebuilds only when necessary, chooses the first free port
from `43110` through `43119`, binds to `127.0.0.1`, and opens the dashboard in your
default browser.

## How discovery works

- Reads Windows TCP listeners and process ancestry through PowerShell.
- Keeps only `node.exe` and `bun.exe` listeners owned by the current Windows user.
- Recovers project metadata from process command lines, `package.json`, and Git.
- Excludes Portboard itself and known internal Codex runtime helpers.
- Supports Windows-native apps only; WSL, Docker, Deno, and unrelated services are
  intentionally outside version one's scope.

The Close action always asks for confirmation. The server rescans and verifies the
listener PID, creation time, owner, runtime, port, and signed fingerprint before
attempting a normal process-tree stop and, if necessary, a force-stop.

## Development

```powershell
npm run dev
npm run lint
npm test
npm run build
```

The development server uses `http://127.0.0.1:43110`. The production launcher is
the recommended day-to-day entry point.
