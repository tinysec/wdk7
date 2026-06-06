[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath
)

$ErrorActionPreference = "SilentlyContinue"
Dismount-DiskImage -ImagePath $ImagePath
