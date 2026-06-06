[CmdletBinding()]
param(
    [string]$Arch = "amd64",
    [string]$Root = "",
    [string]$Download = "true",
    [string]$DownloadUrl = "",
    [string]$Sha256 = "",
    [string]$CacheRoot = "",
    [string]$InstallRoot = "",
    [string]$FailOnError = "false"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function ConvertTo-ActionBool {
    param([string]$Value)

    if ($null -eq $Value) {
        return $false
    }

    switch ($Value.Trim().ToLowerInvariant()) {
        "1" { return $true }
        "true" { return $true }
        "yes" { return $true }
        "on" { return $true }
        "0" { return $false }
        "false" { return $false }
        "no" { return $false }
        "off" { return $false }
        default { throw "Invalid boolean value '$Value'." }
    }
}

function Normalize-Arch {
    param([string]$Value)

    switch ($Value.Trim().ToLowerInvariant()) {
        "amd64" { return "amd64" }
        "x64" { return "amd64" }
        "64" { return "amd64" }
        "i386" { return "i386" }
        "x86" { return "i386" }
        "win32" { return "i386" }
        "32" { return "i386" }
        default { throw "Unsupported WDK7 architecture '$Value'. Use amd64 or i386." }
    }
}

function Write-ActionOutput {
    param(
        [string]$Name,
        [string]$Value
    )

    if ($env:GITHUB_OUTPUT) {
        Add-Content -Path $env:GITHUB_OUTPUT -Value "$Name=$Value"
    }
}

function Write-ActionEnv {
    param(
        [string]$Name,
        [string]$Value
    )

    Set-Item -Path "Env:$Name" -Value $Value
    if ($env:GITHUB_ENV) {
        Add-Content -Path $env:GITHUB_ENV -Value "$Name=$Value"
    }
}

function Add-ActionPath {
    param([string]$Path)

    $env:PATH = "$Path;$env:PATH"
    if ($env:GITHUB_PATH) {
        Add-Content -Path $env:GITHUB_PATH -Value $Path
    }
}

function Get-FullPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
}

function Get-TargetBin {
    param(
        [string]$WdkRoot,
        [string]$TargetArch
    )

    if ($TargetArch -eq "amd64") {
        return Join-Path $WdkRoot "bin\x86\amd64"
    }

    return Join-Path $WdkRoot "bin\x86\x86"
}

function Test-Wdk7Root {
    param(
        [string]$WdkRoot,
        [string]$TargetArch
    )

    if ([string]::IsNullOrWhiteSpace($WdkRoot)) {
        return $false
    }

    $rootPath = Get-FullPath $WdkRoot
    $targetBin = Get-TargetBin $rootPath $TargetArch
    $hostBin = Join-Path $rootPath "bin\x86"

    $required = @(
        (Join-Path $rootPath "bin\setenv.bat"),
        (Join-Path $rootPath "inc\api"),
        (Join-Path $rootPath "inc\ddk"),
        (Join-Path $targetBin "cl.exe"),
        (Join-Path $targetBin "link.exe"),
        (Join-Path $hostBin "nmake.exe"),
        (Join-Path $hostBin "rc.exe")
    )

    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path)) {
            return $false
        }
    }

    return $true
}

function Get-DefaultCacheRoot {
    if ($env:RUNNER_TOOL_CACHE) {
        return (Join-Path $env:RUNNER_TOOL_CACHE "wdk7")
    }

    if ($env:LOCALAPPDATA) {
        return (Join-Path $env:LOCALAPPDATA "actions-tool-cache\wdk7")
    }

    return (Join-Path $env:TEMP "actions-tool-cache\wdk7")
}

function Add-Candidate {
    param(
        [System.Collections.ArrayList]$Candidates,
        [string]$Path,
        [string]$Source
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    $fullPath = Get-FullPath $Path
    foreach ($candidate in $Candidates) {
        if ($candidate.Path -ieq $fullPath) {
            return
        }
    }

    [void]$Candidates.Add([PSCustomObject]@{
        Path = $fullPath
        Source = $Source
    })
}

function Find-Wdk7Root {
    param(
        [string]$TargetArch,
        [string]$RequestedRoot,
        [string]$CacheBase
    )

    $candidates = New-Object System.Collections.ArrayList

    Add-Candidate $candidates $RequestedRoot "input"
    Add-Candidate $candidates $env:WDK7_ROOT "environment"
    Add-Candidate $candidates $env:W7BASE "environment"

    Add-Candidate $candidates (Join-Path $CacheBase "7600.16385.1") "cache"
    Add-Candidate $candidates (Join-Path $CacheBase "7600.16385.win7_wdk.100208-1538") "cache"
    Add-Candidate $candidates (Join-Path $CacheBase "wdk7\7600.16385.1") "cache"
    Add-Candidate $candidates (Join-Path $CacheBase "wdk7\7600.16385.win7_wdk.100208-1538") "cache"

    Add-Candidate $candidates "C:\WinDDK\7600.16385.1" "default"
    Add-Candidate $candidates "C:\WinDDK\7600.16385.win7_wdk.100208-1538" "default"

    foreach ($candidate in $candidates) {
        if (Test-Wdk7Root $candidate.Path $TargetArch) {
            return $candidate
        }
    }

    return $null
}

function Find-Wdk7RootUnder {
    param(
        [string]$BasePath,
        [string]$TargetArch
    )

    if ([string]::IsNullOrWhiteSpace($BasePath) -or -not (Test-Path -LiteralPath $BasePath)) {
        return $null
    }

    if (Test-Wdk7Root $BasePath $TargetArch) {
        return (Get-FullPath $BasePath)
    }

    $setenvFiles = Get-ChildItem -LiteralPath $BasePath -Recurse -Filter setenv.bat -ErrorAction SilentlyContinue
    foreach ($setenv in $setenvFiles) {
        $root = Split-Path -Parent (Split-Path -Parent $setenv.FullName)
        if (Test-Wdk7Root $root $TargetArch) {
            return (Get-FullPath $root)
        }
    }

    return $null
}

function Download-File {
    param(
        [string]$Url,
        [string]$OutputPath
    )

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null

    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -L --fail --retry 3 --output $OutputPath $Url
        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe failed with exit code $LASTEXITCODE."
        }
        return
    }

    Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
}

function Assert-FileHash {
    param(
        [string]$Path,
        [string]$ExpectedSha256
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
        return
    }

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -ine $ExpectedSha256.Trim()) {
        throw "SHA-256 mismatch for '$Path'. Expected $ExpectedSha256, got $actual."
    }
}

function Install-Wdk7FromIso {
    param(
        [string]$IsoPath,
        [string]$TargetRoot
    )

    if (-not (Get-Command Mount-DiskImage -ErrorAction SilentlyContinue)) {
        throw "Mount-DiskImage is unavailable on this runner."
    }

    $mount = $null
    try {
        Write-Host "Mounting WDK7 ISO: $IsoPath"
        $mount = Mount-DiskImage -ImagePath $IsoPath -PassThru
        Start-Sleep -Seconds 2

        $volume = $mount | Get-Volume
        if (-not $volume -or -not $volume.DriveLetter) {
            throw "Unable to determine mounted ISO drive letter."
        }

        $mediaRoot = "$($volume.DriveLetter):\WDK"
        if (-not (Test-Path -LiteralPath $mediaRoot)) {
            throw "Mounted ISO does not contain a WDK directory: $mediaRoot"
        }

        New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
        $logRoot = Join-Path $TargetRoot "_install_logs"
        New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

        $msis = Get-ChildItem -LiteralPath $mediaRoot -Filter *.msi
        if (-not $msis) {
            throw "No WDK MSI packages found under '$mediaRoot'."
        }

        foreach ($msi in $msis) {
            $logPath = Join-Path $logRoot "$($msi.BaseName).log"
            Write-Host "Extracting $($msi.Name)"
            $arguments = @(
                "/a",
                "`"$($msi.FullName)`"",
                "/qn",
                "/norestart",
                "TARGETDIR=`"$TargetRoot`"",
                "/l*v",
                "`"$logPath`""
            )
            $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
            if ($process.ExitCode -ne 0) {
                throw "msiexec failed for '$($msi.Name)' with exit code $($process.ExitCode). See $logPath"
            }
        }
    }
    finally {
        if ($mount) {
            Dismount-DiskImage -ImagePath $IsoPath -ErrorAction SilentlyContinue
        }
    }
}

function Publish-Wdk7 {
    param(
        [string]$WdkRoot,
        [string]$TargetArch,
        [string]$Source,
        [bool]$CacheHit
    )

    $rootPath = Get-FullPath $WdkRoot
    $targetBin = Get-TargetBin $rootPath $TargetArch
    $hostBin = Join-Path $rootPath "bin\x86"

    Write-ActionEnv "WDK7_ROOT" $rootPath
    Write-ActionEnv "W7BASE" $rootPath
    Write-ActionEnv "WDK7_ARCH" $TargetArch
    Write-ActionEnv "WDK7_BIN" $targetBin
    Write-ActionEnv "WDK7_HOST_BIN" $hostBin

    Add-ActionPath $targetBin
    Add-ActionPath $hostBin

    Write-ActionOutput "found" "true"
    Write-ActionOutput "root" $rootPath
    Write-ActionOutput "arch" $TargetArch
    Write-ActionOutput "source" $Source
    Write-ActionOutput "cache-hit" ($(if ($CacheHit) { "true" } else { "false" }))

    Write-Host "WDK7 ready: root='$rootPath' arch='$TargetArch' source='$Source'"
}

function Publish-NotFound {
    param(
        [string]$TargetArch,
        [string]$Reason
    )

    Write-Warning $Reason
    Write-ActionOutput "found" "false"
    Write-ActionOutput "root" ""
    Write-ActionOutput "arch" $TargetArch
    Write-ActionOutput "source" "none"
    Write-ActionOutput "cache-hit" "false"
}

function Main {
    if ($env:OS -and $env:OS -ne "Windows_NT") {
        throw "setup-wdk7 only runs on Windows."
    }

    $targetArch = Normalize-Arch $Arch
    $shouldDownload = ConvertTo-ActionBool $Download
    $shouldFail = ConvertTo-ActionBool $FailOnError

    $cacheBase = Get-FullPath $CacheRoot
    if ([string]::IsNullOrWhiteSpace($cacheBase)) {
        $cacheBase = Get-DefaultCacheRoot
    }
    New-Item -ItemType Directory -Force -Path $cacheBase | Out-Null

    $found = Find-Wdk7Root -TargetArch $targetArch -RequestedRoot $Root -CacheBase $cacheBase
    if ($found) {
        Publish-Wdk7 -WdkRoot $found.Path -TargetArch $targetArch -Source $found.Source -CacheHit ($found.Source -eq "cache")
        return
    }

    if (-not $shouldDownload) {
        Publish-NotFound -TargetArch $targetArch -Reason "WDK7 was not found and download=false."
        return
    }

    if ([string]::IsNullOrWhiteSpace($DownloadUrl)) {
        Publish-NotFound -TargetArch $targetArch -Reason "WDK7 was not found and no download URL was provided."
        return
    }

    $isoPath = Join-Path $cacheBase "GRMWDK_EN_7600_1.ISO"
    if (Test-Path -LiteralPath $isoPath) {
        Write-Host "Using cached WDK7 ISO: $isoPath"
    }
    else {
        Write-Host "Downloading WDK7 ISO from: $DownloadUrl"
        Download-File -Url $DownloadUrl -OutputPath $isoPath
    }

    Assert-FileHash -Path $isoPath -ExpectedSha256 $Sha256

    $targetRoot = Get-FullPath $InstallRoot
    if ([string]::IsNullOrWhiteSpace($targetRoot)) {
        $targetRoot = Join-Path $cacheBase "7600.16385.1"
    }

    if (-not (Test-Wdk7Root $targetRoot $targetArch)) {
        Install-Wdk7FromIso -IsoPath $isoPath -TargetRoot $targetRoot
    }

    $resolvedRoot = Find-Wdk7RootUnder -BasePath $targetRoot -TargetArch $targetArch
    if (-not $resolvedRoot) {
        $resolvedRoot = Find-Wdk7RootUnder -BasePath "C:\WinDDK" -TargetArch $targetArch
    }

    if (-not $resolvedRoot) {
        throw "WDK7 extraction completed, but no valid WDK7 root was found."
    }

    Publish-Wdk7 -WdkRoot $resolvedRoot -TargetArch $targetArch -Source "download" -CacheHit $false
}

try {
    Main
}
catch {
    if (ConvertTo-ActionBool $FailOnError) {
        throw
    }

    $normalizedArch = "amd64"
    try {
        $normalizedArch = Normalize-Arch $Arch
    }
    catch {
    }

    Publish-NotFound -TargetArch $normalizedArch -Reason "setup-wdk7 failed: $($_.Exception.Message)"
}
