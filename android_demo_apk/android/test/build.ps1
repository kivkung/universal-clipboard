$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot)
$sdk="$env:LOCALAPPDATA\Android\Sdk"
$jdk='C:\Program Files\Android\Android Studio\jbr'
$env:JAVA_HOME=$jdk
$bt="$sdk\build-tools\36.0.0"
$api="$sdk\platforms\android-36.1\android.jar"
New-Item -ItemType Directory -Force build/test-classes,build/test-dex | Out-Null
& "$bt/aapt2.exe" link -o build/test-unsigned.apk -I $api --manifest test/AndroidManifest.xml
if($LASTEXITCODE){throw 'test resources failed'}
$sources=@(Get-ChildItem test -Filter '*.java' | ForEach-Object FullName)
& "$jdk/bin/javac.exe" -encoding UTF-8 -source 8 -target 8 -classpath "$api;build/classes" -d build/test-classes @sources
if($LASTEXITCODE){throw 'test compile failed'}
& "$jdk/bin/jar.exe" cf build/test.jar -C build/test-classes .
& "$bt/d8.bat" --min-api 29 --lib $api --classpath build/classes.jar --output build/test-dex build/test.jar
if($LASTEXITCODE){throw 'test dex failed'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::Open((Join-Path (Get-Location) 'build/test-unsigned.apk'),[IO.Compression.ZipArchiveMode]::Update)
try{[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path (Get-Location) 'build/test-dex/classes.dex'),'classes.dex')|Out-Null}finally{$zip.Dispose()}
& "$bt/zipalign.exe" -f -p 4 build/test-unsigned.apk build/test-aligned.apk
& "$bt/apksigner.bat" sign --ks demo-signing.jks --ks-key-alias demo --ks-pass pass:android --key-pass pass:android --out build/tests.apk build/test-aligned.apk
if($LASTEXITCODE){throw 'test signing failed'}
