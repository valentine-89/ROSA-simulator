param(
  [string]$OutputRoot = "",
  [switch]$SkipNpm,
  [switch]$NoZip
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $RepoRoot "dist"
}

$PackageName = "ROSA-simulator-win-x64"
$PackageRoot = Join-Path $OutputRoot $PackageName
$RuntimeRoot = Join-Path $PackageRoot "runtime"
$LauncherSource = Join-Path $RepoRoot "packaging\windows\ROSA-simulator-launcher.cs"
$LauncherExe = Join-Path $PackageRoot "ROSA-simulator.exe"

function Remove-Tree($Path) {
  if (!(Test-Path $Path)) { return }
  for ($Attempt = 1; $Attempt -le 5; $Attempt += 1) {
    try {
      Remove-Item $Path -Recurse -Force -ErrorAction Stop
      return
    }
    catch {
      cmd.exe /d /c ("rmdir /s /q """ + $Path + """") | Out-Null
      if (!(Test-Path $Path)) { return }
      if ($Attempt -ge 5) { throw }
      Start-Sleep -Milliseconds (400 * $Attempt)
    }
  }
}

function Copy-Directory($Source, $Destination) {
  Remove-Tree $Destination
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Write-TextFile($Path, $Content) {
  $Parent = Split-Path -Parent $Path
  if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.Encoding]::UTF8)
}

if (!(Test-Path $LauncherSource)) {
  throw "Launcher source not found: $LauncherSource"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Remove-Tree $PackageRoot
New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot ".sim\state") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "logs") | Out-Null

Copy-Item (Join-Path $RepoRoot "server.js") $PackageRoot -Force
Copy-Item (Join-Path $RepoRoot "package.json") $PackageRoot -Force
Copy-Item (Join-Path $RepoRoot "package-lock.json") $PackageRoot -Force
Copy-Item (Join-Path $RepoRoot "README.md") $PackageRoot -Force
Copy-Directory (Join-Path $RepoRoot "src") (Join-Path $PackageRoot "src")
Copy-Directory (Join-Path $RepoRoot "simulator_ui") (Join-Path $PackageRoot "simulator_ui")
Copy-Directory (Join-Path $RepoRoot "sample_templates") (Join-Path $PackageRoot "sample_templates")
Copy-Directory (Join-Path $RepoRoot "docs") (Join-Path $PackageRoot "docs")

$NodeCommand = Get-Command node.exe -ErrorAction Stop
Copy-Item $NodeCommand.Source (Join-Path $RuntimeRoot "node.exe") -Force

$CscPath = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) "csc.exe"
if (!(Test-Path $CscPath)) {
  throw "C# compiler not found: $CscPath"
}

& $CscPath /nologo /target:exe /platform:x64 /optimize+ /out:$LauncherExe $LauncherSource
if (-not $?) {
  throw "Launcher compile failed."
}

Write-TextFile (Join-Path $PackageRoot "ROSA-simulator.env") @"
# ROSA-simulator runtime config
PORT=4177
SIM_SESSION_ID=IO123abcd@simulate
SIM_SYNC_ID=SIM_SYNC
"@

Write-TextFile (Join-Path $PackageRoot "ROSA-simulator.cmd") @"
@echo off
cd /d "%~dp0"
echo.
echo +---------------------------------------------------------------+
echo ^| ROSA-simulator fallback launcher                              ^|
echo ^| Web address : http://localhost:4177                            ^|
echo ^| Keep this terminal open. Close it to stop the web server.      ^|
echo +---------------------------------------------------------------+
echo.
start "" "http://localhost:4177"
"%~dp0runtime\node.exe" "%~dp0server.js"
pause
"@

Write-TextFile (Join-Path $PackageRoot "README-Windows.txt") @"
ROSA-simulator Windows portable package

Start:
  Double-click ROSA-simulator.exe.
  The launcher opens a terminal, starts the local server, and opens http://localhost:4177.
  Keep the terminal open while using the simulator. Closing it stops the web server.

Editable external folders:
  sample_templates\      Template manifest, HTML, CSS, runtime JS, sample SQLite files.
  .sim\state\            Simulator runtime state and loaded IoData databases.
  logs\                  Launcher/server logs.

Config:
  Edit ROSA-simulator.env to change PORT, SIM_SESSION_ID, or SIM_SYNC_ID.

Reset:
  Use the simulator UI clear buttons, or delete .sim\state while the app is closed.

Fallback:
  If the exe is blocked by Windows policy, run ROSA-simulator.cmd.
"@

if (!$SkipNpm) {
  $NpmCommand = Get-Command npm.cmd -ErrorAction Stop
  Remove-Tree (Join-Path $PackageRoot "node_modules")
  $NpmBatch = Join-Path $PackageRoot "_package-npm-ci.cmd"
  [System.IO.File]::WriteAllText($NpmBatch, @"
@echo off
cd /d "%~dp0"
set "PATH=%CD%\node_modules\.bin;%ProgramFiles%\nodejs;%APPDATA%\npm;%SystemRoot%\System32;%SystemRoot%;%PATH%"
call npm.cmd ci --omit=dev --no-audit --no-fund
exit /b %ERRORLEVEL%
"@, [System.Text.Encoding]::ASCII)
  $NpmProcess = Start-Process `
    -FilePath (Join-Path $env:SystemRoot "System32\cmd.exe") `
    -ArgumentList @("/d", "/c", "`"$NpmBatch`"") `
    -WorkingDirectory $PackageRoot `
    -Wait `
    -PassThru `
    -NoNewWindow
  Remove-Item $NpmBatch -Force -ErrorAction SilentlyContinue
  if ($NpmProcess.ExitCode -ne 0) {
    throw "npm ci failed in package folder."
  }
  if (!(Test-Path (Join-Path $PackageRoot "node_modules\better-sqlite3"))) {
    throw "better-sqlite3 was not installed in package folder."
  }
}

if (!$NoZip) {
  $ZipPath = Join-Path $OutputRoot ($PackageName + ".zip")
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  $Compressed = $false
  for ($Attempt = 1; $Attempt -le 3 -and !$Compressed; $Attempt += 1) {
    try {
      Start-Sleep -Milliseconds (500 * $Attempt)
      Compress-Archive -Path $PackageRoot -DestinationPath $ZipPath -Force
      $Compressed = $true
    }
    catch {
      if ($Attempt -ge 3) { throw }
      Write-Warning ("Compress-Archive failed, retrying: " + $_.Exception.Message)
    }
  }
  Write-Host "Created: $ZipPath"
}

Write-Host "Created: $PackageRoot"
