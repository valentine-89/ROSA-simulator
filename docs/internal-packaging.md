# Internal Windows Packaging Notes

This document is for the team that maintains ROSA-simulator releases. Customers should use the root `README.md`.

## Bootstrapper Model

The public repository should stay lightweight:

```text
ROSA-simulator.exe
server.js
package.json
package-lock.json
src/
simulator_ui/
sample_templates/
docs/
```

Do not commit:

```text
runtime/
node_modules/
dist/
```

`ROSA-simulator.exe` is a bootstrapper. It checks for a compatible installed Node.js, downloads portable Node into `%LOCALAPPDATA%\ROSA-simulator` when needed, installs dependencies into the same user cache, then starts `server.js` from the source folder.

## Refresh Root Bootstrapper

Compile the root exe from a Windows-capable shell:

```bash
npm run refresh:bootstrapper:win
```

This only refreshes `ROSA-simulator.exe`. It does not install or copy Node runtime files into the repo.

## Build Source ZIP Artifact

Build a customer-friendly folder and ZIP artifact:

```bash
npm run package:win
```

Output:

```text
dist/ROSA-simulator-win-x64/
  ROSA-simulator.exe
  server.js
  package.json
  package-lock.json
  src/
  simulator_ui/
  sample_templates/
  docs/
```

ZIP output:

```text
dist/ROSA-simulator-win-x64.zip
```

The package intentionally does not include `runtime/` or `node_modules/`. First run may need internet; later runs reuse `%LOCALAPPDATA%\ROSA-simulator`.

## PowerShell Entry Point

Run the PowerShell script directly when needed:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

Useful switches:

- `-RootLauncher`: refresh root `ROSA-simulator.exe`.
- `-NoZip`: build the package folder without creating the ZIP.
- `-OutputRoot <path>`: write the package to another output folder.

## Validation Before Publishing

Run:

```bash
npm run check
npm run validate
npm run package:win
```

Then test on Windows:

```cmd
ROSA-simulator.exe
```

The CMD window should show boxed `#` status messages in Vietnamese and English while it checks Node, installs dependencies if needed, starts the server, and opens the browser.
