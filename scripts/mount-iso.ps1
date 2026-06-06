[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"

# Mount-DiskImage returns before every runner reliably exposes the volume.
# The short wait avoids a race where Get-Volume sees the disk object but not the
# assigned drive letter yet.
$mount = Mount-DiskImage -ImagePath $ImagePath -PassThru
Start-Sleep -Seconds 2

$volume = $mount | Get-Volume
if (-not $volume -or -not $volume.DriveLetter) {
    throw "Unable to determine mounted ISO drive letter."
}

Write-Output $volume.DriveLetter
