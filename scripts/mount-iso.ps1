[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"

$mount = Mount-DiskImage -ImagePath $ImagePath -PassThru
Start-Sleep -Seconds 2

$volume = $mount | Get-Volume
if (-not $volume -or -not $volume.DriveLetter) {
    throw "Unable to determine mounted ISO drive letter."
}

Write-Output $volume.DriveLetter
