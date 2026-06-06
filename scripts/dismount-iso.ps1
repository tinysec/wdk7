[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath
)

$ErrorActionPreference = "SilentlyContinue"

# Dismount is intentionally best-effort because callers run this from finally
# blocks. A missing or already-dismounted image should not hide the original
# installation or extraction error.
Dismount-DiskImage -ImagePath $ImagePath
