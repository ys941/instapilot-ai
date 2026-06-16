# ==============================================================================
# package-zip.ps1 — build a clean, shareable zip of InstaPilot AI
# ==============================================================================
# Produces ../instapilot-share.zip excluding secrets, git history, dependencies,
# build output and logs — so you can safely hand it to anyone.
#
# Run from the project root:   powershell -ExecutionPolicy Bypass -File scripts/package-zip.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"
$root    = Split-Path -Parent $PSScriptRoot
$name    = "instapilot-share"
$staging = Join-Path $env:TEMP $name
$zipPath = Join-Path (Split-Path -Parent $root) "$name.zip"

Write-Host "Packaging from: $root" -ForegroundColor Cyan

# Things we NEVER ship
$exclude = @(
  "node_modules", ".next", ".git", ".turbo", ".vscode", ".idea",
  ".env", ".env.local", ".env.production",
  "dev-server.log", "tsconfig.tsbuildinfo",
  "Dockerfile.bak", "docker-entrypoint.sh.bak",
  # throwaway local card-render / preview scratch scripts (not part of the app,
  # still contain old demo data) — never ship them
  "render-all.ts", "render-all2.ts", "render-test.ts", "render-edu-v2.mjs"
)

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Write-Host "Copying project files (excluding secrets, node_modules, .git, logs)..." -ForegroundColor Cyan
Get-ChildItem -Path $root -Force | Where-Object {
  $exclude -notcontains $_.Name -and $_.Extension -ne ".log" -and $_.Extension -ne ".bak"
} | ForEach-Object {
  Copy-Item $_.FullName -Destination (Join-Path $staging $_.Name) -Recurse -Force
}

# Safety: make sure no real .env files slipped in; keep only .env.example
Get-ChildItem -Path $staging -Recurse -Force -Filter ".env*" |
  Where-Object { $_.Name -ne ".env.example" } |
  ForEach-Object { Remove-Item $_.FullName -Force }

# Clear any generated content (keep the .gitkeep folder markers)
Get-ChildItem -Path (Join-Path $staging "generated") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Write-Host "Creating zip: $zipPath" -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -Force

Remove-Item $staging -Recurse -Force
Write-Host "Done -> $zipPath" -ForegroundColor Green
Write-Host "Recipients: unzip, run 'npm install', copy .env.example to .env.local, then follow the README." -ForegroundColor Green
