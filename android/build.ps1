param(
    [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$Jdk = 'C:\Program Files\Android\Android Studio\jbr',
    [string]$BouncyCastle = '',
    [string]$ZXing = "$PSScriptRoot\vendor\zxing-core-3.5.3.jar",
    [string]$OutputDirectory = "$PSScriptRoot\..\..\releas"
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[xml]$manifest = Get-Content -LiteralPath AndroidManifest.xml -Raw
$version = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
if ($version -notmatch '^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$') { throw 'Invalid Android versionName' }
$outputApk = Join-Path $OutputDirectory "universal-clipboard-$version.apk"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
if (!$BouncyCastle) {
    $BouncyCastle = (Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\org.bouncycastle\bcprov-jdk18on\1.79" -Recurse -Filter '*.jar' | Select-Object -First 1).FullName
}
if (!(Test-Path -LiteralPath $BouncyCastle)) { throw 'Supply -BouncyCastle with bcprov-jdk18on-1.79.jar (https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk18on/1.79/).' }
if (!(Test-Path -LiteralPath $ZXing)) { throw 'Missing vendor/zxing-core-3.5.3.jar; restore the pinned scanner dependency.' }
if ((Get-FileHash -LiteralPath $ZXing -Algorithm SHA256).Hash -ne '8D8064C1636FDAEF7189DD9055C7D59950A8940A12F2293956446EC3C109FD82') { throw 'ZXing checksum mismatch' }
$buildTools = Join-Path $Sdk 'build-tools\36.0.0'
$androidJar = Join-Path $Sdk 'platforms\android-36.1\android.jar'
$env:JAVA_HOME = $Jdk
$env:PATH = "$Jdk\bin;$env:PATH"
function Run([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed with exit code $LASTEXITCODE" }
}
New-Item -ItemType Directory -Force -Path build,build/classes,build/generated,build/dex,build/assets | Out-Null
Copy-Item -LiteralPath THIRD-PARTY-NOTICES.md -Destination build/assets/THIRD-PARTY-NOTICES.md
Copy-Item -LiteralPath vendor/LICENSE-ZXing.txt -Destination build/assets/LICENSE-ZXing.txt
Run "$buildTools\aapt2.exe" @('compile','--dir','res','-o','build/resources.zip')
Run "$buildTools\aapt2.exe" @('link','-o','build/unsigned.apk','-I',$androidJar,'--manifest','AndroidManifest.xml','--java','build/generated','--auto-add-overlay','-A','build/assets','build/resources.zip')
$sources = @(Get-ChildItem src,build/generated -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
Run "$Jdk\bin\javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-classpath',"$androidJar;$BouncyCastle;$ZXing",'-d','build/classes') + $sources)
Run "$Jdk\bin\jar.exe" @('cf','build/classes.jar','-C','build/classes','.')
Run "$buildTools\d8.bat" @('--release','--min-api','29','--lib',$androidJar,'--output','build/dex','build/classes.jar',$BouncyCastle,$ZXing)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open((Join-Path $PSScriptRoot 'build/unsigned.apk'),[IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($dex in Get-ChildItem build/dex -Filter '*.dex') {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$dex.FullName,$dex.Name) | Out-Null
    }
} finally { $archive.Dispose() }
if (!(Test-Path 'demo-signing.jks')) {
    Run "$Jdk\bin\keytool.exe" @('-genkeypair','-keystore','demo-signing.jks','-storepass','android','-keypass','android','-alias','demo','-keyalg','RSA','-keysize','3072','-validity','3650','-dname','CN=Universal Clipboard Demo')
}
Run "$buildTools\zipalign.exe" @('-f','-p','4','build/unsigned.apk','build/aligned.apk')
Run "$buildTools\apksigner.bat" @('sign','--ks','demo-signing.jks','--ks-key-alias','demo','--ks-pass','pass:android','--key-pass','pass:android','--out',$outputApk,'build/aligned.apk')
Run "$buildTools\apksigner.bat" @('verify','--verbose',$outputApk)
Write-Output "APK: $outputApk"
