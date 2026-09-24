#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v pwsh.exe >/dev/null 2>&1; then
  echo "PowerShell 7 (pwsh.exe) is required to package the Windows simulator." >&2
  exit 1
fi
if ! command -v wslpath >/dev/null 2>&1; then
  echo "wslpath is required to translate package paths." >&2
  exit 1
fi
SCRIPT_WIN="$(wslpath -w "$ROOT/scripts/package-windows.ps1")"
pwsh.exe -NoProfile -File "$SCRIPT_WIN"
