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
  $versionParts = $version.Split(".")
  $expectedBranch = "v$($versionParts[0]).$($versionParts[1])"

  if ($env:GITHUB_REF_NAME -ne $expectedBranch) {
    throw "Release branch $env:GITHUB_REF_NAME must match manifest version $version. Expected branch: $expectedBranch"
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
  "i18n.js",
  "_locales",
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

$defaultLocale = [string]$manifest.default_locale
if ([string]::IsNullOrWhiteSpace($defaultLocale)) {
  throw "manifest.json must declare default_locale."
}

$defaultMessagesPath = Join-Path "_locales" (Join-Path $defaultLocale "messages.json")
if (-not (Test-Path -LiteralPath $defaultMessagesPath -PathType Leaf)) {
  throw "Default locale messages are missing: $defaultMessagesPath"
}

$defaultMessages = Get-Content -Raw -Encoding UTF8 -LiteralPath $defaultMessagesPath | ConvertFrom-Json
foreach ($messageName in @("extensionName", "extensionDescription")) {
  if (-not $defaultMessages.PSObject.Properties[$messageName]) {
    throw "Default locale is missing required message: $messageName"
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path

Get-ChildItem -LiteralPath $resolvedOutputDirectory -File -Filter "quick-side-nav-v*.zip" | ForEach-Object {
  Remove-Item -Force -LiteralPath $_.FullName
}

$zipPath = Join-Path $resolvedOutputDirectory "quick-side-nav-v$version.zip"

Compress-Archive -LiteralPath $packageEntries -DestinationPath $zipPath -Force

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "quick-side-nav-package-$([Guid]::NewGuid().ToString('N'))"
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir

  if (-not (Test-Path -LiteralPath (Join-Path $tempDir "manifest.json") -PathType Leaf)) {
    throw "Package validation failed: manifest.json is not at the ZIP root."
  }

  $packagedManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $tempDir "manifest.json") | ConvertFrom-Json
  $packagedVersion = [string]$packagedManifest.version
  if ($packagedVersion -ne $version) {
    throw "Package validation failed: ZIP manifest version $packagedVersion does not match source manifest version $version."
  }

  foreach ($iconPath in ($manifestIconPaths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath (Join-Path $tempDir $iconPath) -PathType Leaf)) {
      throw "Package validation failed: missing icon in ZIP: $iconPath"
    }
  }

  foreach ($locale in @("en", "ja")) {
    $messagesPath = Join-Path $tempDir (Join-Path "_locales" (Join-Path $locale "messages.json"))
    if (-not (Test-Path -LiteralPath $messagesPath -PathType Leaf)) {
      throw "Package validation failed: missing locale messages in ZIP: $locale"
    }

    Get-Content -Raw -Encoding UTF8 -LiteralPath $messagesPath | ConvertFrom-Json | Out-Null
  }
} finally {
  Remove-Item -Recurse -Force -LiteralPath $tempDir -ErrorAction SilentlyContinue
}

Write-Output "Created $zipPath"
