# Builds ActivityVisualizer-portable.exe from the latest commit of the original repo.
# Usage (from anywhere): powershell -ExecutionPolicy Bypass -File desktop\build.ps1
$ErrorActionPreference = "Stop"
$Upstream = "https://github.com/theinhumaneme/activity-visualizer"
$Desktop = $PSScriptRoot
$Src = Join-Path $Desktop ".upstream"

function Run($exe, [string[]]$params) {
  & $exe @params
  if ($LASTEXITCODE -ne 0) { throw "$exe $params failed ($LASTEXITCODE)" }
}

if (Test-Path (Join-Path $Src ".git")) {
  Run git @("-C", $Src, "fetch", "--depth", "1", "origin", "HEAD")
  Run git @("-C", $Src, "reset", "--hard", "FETCH_HEAD")
} else {
  Run git @("clone", "--depth", "1", $Upstream, $Src)
}
$Sha = (git -C $Src rev-parse --short HEAD).Trim()

# Build the web app (vite only: an upstream type error shouldn't block a working build).
Push-Location $Src
try {
  Run npm @("ci", "--no-audit", "--no-fund")
  Run npx @("vite", "build")
} finally { Pop-Location }

$App = Join-Path $Desktop "app"
if (Test-Path $App) { Remove-Item -Recurse -Force $App }
Copy-Item -Recurse (Join-Path $Src "dist\client") $App
# CI tags builds by both commits (original app + desktop shell); the exe compares it with the latest release.
$Tag = if ($env:DESKTOP_SHA) { "build-$Sha-$($env:DESKTOP_SHA.Substring(0, 7))" } else { "local-$Sha" }
@{ tag = $Tag; upstream = $Sha } | ConvertTo-Json | Out-File -Encoding ascii (Join-Path $Desktop "build.json")
if ($env:GITHUB_OUTPUT) { "tag=$Tag" | Out-File -Append -Encoding ascii $env:GITHUB_OUTPUT }

Push-Location $Desktop
try {
  Run npm @("ci", "--no-audit", "--no-fund")
  Run npm @("run", "dist")
} finally { Pop-Location }
Write-Host "Done: $(Join-Path $Desktop 'release\ActivityVisualizer-portable.exe')"
