param(
    [switch]$SkipAndroid,
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version' }
[xml]$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'android/AndroidManifest.xml') -Raw
$androidVersion = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
if ($androidVersion -ne $version) {
    throw 'package.json, package-lock.json and Android versionName must match before building a release'
}
$releaseDirectory = Join-Path $repoRoot "releases/$version"
New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Push-Location $repoRoot
try {
    # PowerShell 5 cannot deserialize package-lock's empty root package key.
    & node -e "const p=require('./package.json'),l=require('./package-lock.json');if(p.version!==l.version||p.version!==l.packages[''].version)throw new Error('Lockfile release version mismatch');"
    if ($LASTEXITCODE -ne 0) { throw 'Release version validation failed' }
    if (!$SkipTests) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Release tests failed' }
    }
    if (!$SkipAndroid) {
        & (Join-Path $repoRoot 'android/build.ps1') -OutputDirectory $releaseDirectory
    }
    # Android's build changes the current directory. Pack the repository root.
    Set-Location $repoRoot
    & npm.cmd pack --pack-destination $releaseDirectory --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Desktop release packaging failed' }
    Write-Output "Release ${version}: $releaseDirectory"
} finally {
    Pop-Location
}
