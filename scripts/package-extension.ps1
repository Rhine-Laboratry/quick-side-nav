param(
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath "manifest.json" | ConvertFrom-Json
$version = [string]$manifest.version

if ($version -notmatch "^\d+\.\d+\.\d+(\.\d+)?$") {
  throw "manifest.json version must be a Chrome extension version such as 1.2.3. Found: $version"
}

if ($env:GITHUB_REF_NAME -match "^v(?<minor>\d+\.\d+)$") {
  $expectedPrefix = "$($Matches.minor)."

  if (-not $version.StartsWith($expectedPrefix)) {
    throw "Release branch $env:GITHUB_REF_NAME must match manifest version $version. Expected version prefix: $expectedPrefix"
  }
}

$packageEntries = @(
  "manifest.json",
  "background.js",
  "content.js",
  "options.html",
  "options.js",
  "options.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "README.md",
  "PRIVACY.md",
  "icons"
)

foreach ($entry in $packageEntries) {
  if (-not (Test-Path -LiteralPath $entry)) {
    throw "Required package entry is missing: $entry"
  }
}

$manifestIconPaths = @()
$manifest.icons.PSObject.Properties | ForEach-Object {
  $manifestIconPaths += [string]$_.Value
}
$manifest.action.default_icon.PSObject.Properties | ForEach-Object {
  $manifestIconPaths += [string]$_.Value
}

foreach ($iconPath in ($manifestIconPaths | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
    throw "Manifest references missing icon: $iconPath"
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$zipPath = Join-Path $OutputDirectory "quick-side-nav-v$version.zip"
Remove-Item -Force -LiteralPath $zipPath -ErrorAction SilentlyContinue

Compress-Archive -LiteralPath $packageEntries -DestinationPath $zipPath -Force

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "quick-side-nav-package-$([Guid]::NewGuid().ToString('N'))"
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir

  if (-not (Test-Path -LiteralPath (Join-Path $tempDir "manifest.json") -PathType Leaf)) {
    throw "Package validation failed: manifest.json is not at the ZIP root."
  }

  foreach ($iconPath in ($manifestIconPaths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath (Join-Path $tempDir $iconPath) -PathType Leaf)) {
      throw "Package validation failed: missing icon in ZIP: $iconPath"
    }
  }
} finally {
  Remove-Item -Recurse -Force -LiteralPath $tempDir -ErrorAction SilentlyContinue
}

Write-Output "Created $zipPath"
