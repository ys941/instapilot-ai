# ─────────────────────────────────────────────────────────────────────────────
# package-zip.ps1  —  Build a clean, shippable InstaPilot AI zip.
#
# Produces a distributable archive that EXCLUDES build artifacts, dependencies,
# local caches, and — critically — any secret/env files. The recipient unzips,
# runs `npm install` (or `docker compose up`), supplies their OWN keys in .env,
# and configures their brand in Settings → Brand.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\package-zip.ps1
#   powershell -ExecutionPolicy Bypass -File .\package-zip.ps1 -OutFile C:\path\instapilot.zip
# ─────────────────────────────────────────────────────────────────────────────
param(
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = Join-Path $root "instapilot-ai.zip"
}

# Never ship these — build output, deps, caches, and ALL secret/env files.
$excludeDirs = @(
  "node_modules", ".next", ".git", ".turbo", ".vscode", ".idea",
  "generated\images", "backup", "dist", "out"
)
$excludePatterns = @(
  "*.env", ".env", ".env.*", "*.log", "*.bak", "tsconfig.tsbuildinfo",
  "instapilot-ai.zip", "cardioflow-ai.zip"
)

Write-Host "Packaging InstaPilot AI from $root" -ForegroundColor Cyan
Write-Host "Output: $OutFile" -ForegroundColor Cyan

# Stage into a temp folder so we can prune secrets/artifacts cleanly.
$stage = Join-Path $env:TEMP ("instapilot-pkg-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
  Write-Host "Copying source (excluding artifacts + secrets)..." -ForegroundColor Yellow

  $allItems = Get-ChildItem -Path $root -Recurse -Force -File | Where-Object {
    $rel = $_.FullName.Substring($root.Length).TrimStart('\')
    $skip = $false
    foreach ($d in $excludeDirs) {
      if ($rel -like "$d\*" -or $rel -eq $d) { $skip = $true; break }
    }
    if (-not $skip) {
      foreach ($p in $excludePatterns) {
        if ($_.Name -like $p) { $skip = $true; break }
      }
    }
    -not $skip
  }

  foreach ($item in $allItems) {
    $rel = $item.FullName.Substring($root.Length).TrimStart('\')
    $dest = Join-Path $stage $rel
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item $item.FullName -Destination $dest -Force
  }

  # Guarantee a .env.example ships even if it was named differently.
  if (-not (Test-Path (Join-Path $stage ".env.example"))) {
    if (Test-Path (Join-Path $root ".env.example")) {
      Copy-Item (Join-Path $root ".env.example") (Join-Path $stage ".env.example") -Force
    }
  }

  # Final safety sweep: assert no real secret files slipped through.
  $leaked = Get-ChildItem -Path $stage -Recurse -Force -File |
    Where-Object { $_.Name -eq ".env" -or $_.Name -like "*.env" -or $_.Name -like ".env.*" }
  if ($leaked) {
    Write-Host "ABORT: secret env file(s) staged:" -ForegroundColor Red
    $leaked | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Red }
    throw "Refusing to package — env file detected."
  }

  if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
  Write-Host "Compressing..." -ForegroundColor Yellow
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $OutFile -Force

  $sizeMB = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
  Write-Host "Done: $OutFile ($sizeMB MB)" -ForegroundColor Green
  Write-Host "Recipient steps: unzip -> cp .env.example .env -> add keys -> npm install -> npm run dev (or docker compose up)" -ForegroundColor Green
}
finally {
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
