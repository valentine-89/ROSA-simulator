param(
  [string]$OutputRoot = "",
  [switch]$NoZip,
  [switch]$RootLauncher
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $RepoRoot "dist"
}

$PackageName = "ROSA-simulator-win-x64"
$PackageRoot = Join-Path $OutputRoot $PackageName
$LauncherSource = Join-Path $RepoRoot "packaging\windows\ROSA-simulator-launcher.cs"

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

function Compile-Launcher($TargetRoot) {
  if (!(Test-Path $LauncherSource)) {
    throw "Launcher source not found: $LauncherSource"
  }

  $CscPath = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) "csc.exe"
  if (!(Test-Path $CscPath)) {
    throw "C# compiler not found: $CscPath"
  }

  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
  $LauncherExe = Join-Path $TargetRoot "ROSA-simulator.exe"
  & $CscPath `
    /nologo `
    /target:exe `
    /platform:x64 `
    /optimize+ `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    /out:$LauncherExe `
    $LauncherSource
  $ExitCodeVariable = Get-Variable LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
  $ExitCode = if ($ExitCodeVariable) { $ExitCodeVariable.Value } else { 0 }
  if ($ExitCode -ne 0) {
    throw "Launcher compile failed."
  }
  Write-Host "Created: $LauncherExe"
}

function Build-SourcePackage() {
  New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
  Remove-Tree $PackageRoot
  New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null

  Copy-Item (Join-Path $RepoRoot "server.js") $PackageRoot -Force
  Copy-Item (Join-Path $RepoRoot "package.json") $PackageRoot -Force
  Copy-Item (Join-Path $RepoRoot "package-lock.json") $PackageRoot -Force
  Copy-Item (Join-Path $RepoRoot "README.md") $PackageRoot -Force
  Copy-Directory (Join-Path $RepoRoot "src") (Join-Path $PackageRoot "src")
  Copy-Directory (Join-Path $RepoRoot "simulator_ui") (Join-Path $PackageRoot "simulator_ui")
  Copy-Directory (Join-Path $RepoRoot "sample_templates") (Join-Path $PackageRoot "sample_templates")
  Copy-Directory (Join-Path $RepoRoot "docs") (Join-Path $PackageRoot "docs")
  Compile-Launcher $PackageRoot

  Write-TextFile (Join-Path $PackageRoot "README-Windows.txt") @"
ROSA-simulator Windows bootstrap package

Start:
  Double-click ROSA-simulator.exe.
  The launcher checks Node.js, downloads portable Node if needed, installs Node dependencies into the user cache, starts the local server, and opens http://localhost:4177.
  Keep the terminal open while using the simulator. Closing it stops the web server.

First run:
  Internet is required if Node.js or npm dependencies are not already cached.
  Later runs reuse the cache under %LOCALAPPDATA%\ROSA-simulator.

Source mode:
  Developers can still run npm install and npm start from this folder.
"@

  if (!$NoZip) {
    $ZipPath = Join-Path $OutputRoot ($PackageName + ".zip")
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Compress-Archive -Path $PackageRoot -DestinationPath $ZipPath -Force
    Write-Host "Created: $ZipPath"
  }

  Write-Host "Created: $PackageRoot"
}

if ($RootLauncher) {
  Compile-Launcher $RepoRoot
}
else {
  Build-SourcePackage
}
