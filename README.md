# Portboard

Portboard is a private Windows dashboard for the Next.js, Node.js, and Bun apps
currently listening on your machine. It shows each app's port, package name,
project folder, and Git branch, with actions to open the site or stop its verified
process tree.

When a listener is managed by a verified project-local supervisor such as
`concurrently`, Portboard labels it as managed and **Stop stack** terminates the
supervisor plus its sibling commands. Direct listeners retain the narrower
**Close** action. Portboard never crosses into the launching terminal, VS Code,
or an agent process.

The **Background** tab lists the opposite case: same-user Node.js and Bun
processes that belong to a project but hold no port and sit under no listening
app, such as queue workers left behind by a checkout you no longer use. Each
entry is the root of its process tree and reports how many processes it covers,
how many outbound connections they hold, and where those connections point, so
an abandoned worker fleet that is still doing paid work is visible rather than
silent. **Stop** ends the verified tree without crossing into the launching
terminal.

The **Uncommitted** tab also scans Git repositories below `C:\Codex` and
`C:\ClaudeCode`. It lists only projects with staged, modified, conflicted, or
untracked work, ordered by the most recently changed local file. Ignored files are
not included and the view never changes repository state. Each result includes an
**Open** action that revalidates the repository against those two roots before
opening its folder in Visual Studio Code.

## Start Portboard

Double-click `start-portboard.cmd`, or run:

```powershell
npm run dashboard
```

The launcher installs or rebuilds only when necessary, chooses the first free port
from `43110` through `43119`, binds to `127.0.0.1`, and opens the dashboard in your
default browser.


## Start in the system tray (Windows)

Double-click `start-portboard-tray.cmd` (or run it from Explorer). Portboard starts hidden and shows a tray icon with:

- **Open dashboard**
- **Restart**
- **Quit** (stops Portboard)

The classic console launcher `start-portboard.cmd` still works when you want a visible terminal.

## How discovery works

- Reads Windows TCP listeners, established connections, and process ancestry
  through PowerShell.
- Keeps only `node.exe` and `bun.exe` processes owned by the current Windows user.
- Routes each one by port ownership: listeners become **Running** entries, while
  portless processes that resolve to a project root become **Background**
  entries. Anything descending from a listener stays on **Running** only.
- Derives worker names from command lines as a bare script basename, because a
  raw command line can carry API keys and never leaves the server.
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

