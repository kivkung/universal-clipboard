$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$clipboardBackup = [System.Windows.Forms.Clipboard]::GetDataObject()
try {
    & node "$PSScriptRoot/clipboard-smoke.mjs"
    if ($LASTEXITCODE -ne 0) { throw 'Native clipboard smoke test failed' }
} finally {
    if ($null -ne $clipboardBackup) {
        [System.Windows.Forms.Clipboard]::SetDataObject($clipboardBackup, $true)
    } else {
        [System.Windows.Forms.Clipboard]::Clear()
    }
}
