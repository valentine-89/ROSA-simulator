#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_ROOT="$ROOT/dist/ROSA-simulator-win-x64"
ZIP_PATH="$ROOT/dist/ROSA-simulator-win-x64.zip"

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "powershell.exe is required to build the Windows launcher." >&2
  exit 1
fi
if ! command -v cmd.exe >/dev/null 2>&1; then
  echo "cmd.exe is required to run Windows npm from WSL." >&2
  exit 1
fi
if ! command -v wslpath >/dev/null 2>&1; then
  echo "wslpath is required to translate package paths." >&2
  exit 1
fi

SCRIPT_WIN="$(wslpath -w "$ROOT/scripts/package-windows.ps1")"
PACKAGE_WIN="$(wslpath -w "$PACKAGE_ROOT")"
ZIP_WIN="$(wslpath -w "$ZIP_PATH")"
DIST_WIN="$(wslpath -w "$ROOT/dist")"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT_WIN" -SkipNpm -NoZip

NPM_BATCH="$PACKAGE_ROOT/_package-npm-ci.cmd"
cat > "$NPM_BATCH" <<'EOF'
@echo off
cd /d "%~dp0"
if exist node_modules rmdir /s /q node_modules
npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 exit /b %ERRORLEVEL%
npm ls --depth=0
exit /b %ERRORLEVEL%
EOF
NPM_BATCH_WIN="$(wslpath -w "$NPM_BATCH")"
cmd.exe /c "$NPM_BATCH_WIN"
rm -f "$NPM_BATCH"

if [ ! -d "$PACKAGE_ROOT/node_modules/better-sqlite3" ]; then
  echo "better-sqlite3 was not installed in package folder." >&2
  exit 1
fi

for attempt in 1 2 3 4 5; do
  sleep "$attempt"
  if cmd.exe /c "cd /d $DIST_WIN && if exist ROSA-simulator-win-x64.zip del /f /q ROSA-simulator-win-x64.zip && tar -a -cf ROSA-simulator-win-x64.zip ROSA-simulator-win-x64"; then
    for _ in $(seq 1 60); do
      if [ -f "$ZIP_PATH" ] && [ "$(stat -c%s "$ZIP_PATH")" -gt 1000000 ]; then
        break 2
      fi
      sleep 0.5
    done
  fi
  if [ "$attempt" = "5" ]; then
    echo "zip creation failed after retries." >&2
    exit 1
  fi
  echo "zip creation failed, retrying..."
done
ls -lh "$ZIP_PATH"

echo "Created: $PACKAGE_ROOT"
echo "Created: $ZIP_PATH"
