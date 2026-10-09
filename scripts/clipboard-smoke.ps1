$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$clipboardOriginal = [System.Windows.Forms.Clipboard]::GetDataObject()
$clipboardBackup = $null
if ($null -ne $clipboardOriginal) {
    # Materialize before replacing the clipboard; the original IDataObject may
    # otherwise request delayed data from an owner which no longer owns it.
    $clipboardBackup = New-Object System.Windows.Forms.DataObject
    foreach ($format in $clipboardOriginal.GetFormats($false)) {
        $value = $clipboardOriginal.GetData($format, $false)
        if ($null -ne $value) { $clipboardBackup.SetData($format, $false, $value) }
    }
}
try {
    & node "$PSScriptRoot/clipboard-smoke.mjs"
    if ($LASTEXITCODE -ne 0) { throw 'Native clipboard smoke test failed' }
} finally {
    if ($null -ne $clipboardBackup) {
        [System.Windows.Forms.Clipboard]::SetDataObject($clipboardBackup, $true, 10, 100)
    } else {
        [System.Windows.Forms.Clipboard]::Clear()
    }
}
