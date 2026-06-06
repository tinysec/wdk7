[CmdletBinding()]
param(
    [ValidateSet("default", "debugger")]
    [string]$Mode = "default"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

<#
.SYNOPSIS
Ensures a required action output path exists before a build step uses it.

.DESCRIPTION
The e2e script depends on environment variables exported by the action. Failing
early with a direct message makes CI errors easier to diagnose than letting
CMake or ddkbuild fail with a missing tool path later.
#>
function Assert-ExistingPath {
    param(
        [string]$Path,
        [string]$Message
    )

    # Empty strings and missing files are treated the same because both mean the
    # action did not provide a usable path for the next build step.
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
        throw $Message
    }
}

<#
.SYNOPSIS
Ensures a command is available through PATH before the e2e script uses it.

.DESCRIPTION
The action adds bundled helper commands to PATH for downstream steps. Checking
command resolution directly protects the user-facing contract that legacy
projects can call ddkbuild.cmd without referencing an action output.
#>
function Assert-CommandAvailable {
    param(
        [string]$CommandName
    )

    # Get-Command tests the same PATH-based resolution that a later cmd.exe call
    # relies on when it invokes the bundled batch wrapper.
    if ($null -eq (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "$CommandName is not available on PATH."
    }
}

<#
.SYNOPSIS
Runs a command and exits with the command's status when it fails.

.DESCRIPTION
PowerShell does not automatically fail scripts for native command exit codes.
This wrapper keeps each e2e command explicit while preserving the original
native exit code for CI.
#>
function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    # Native tools such as CMake, cmd, and ddkbuild communicate failure through
    # LASTEXITCODE rather than PowerShell exceptions.
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

<#
.SYNOPSIS
Removes a generated e2e build directory inside the repository.

.DESCRIPTION
The script creates fresh build trees so stale CMake output cannot satisfy a
missing-output assertion. The repository-boundary check prevents accidental
recursive deletion outside the workspace.
#>
function Clear-BuildDirectory {
    param([string]$Path)

    $resolvedRepo = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd("\")
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $repoPrefix = "$resolvedRepo\"

    # The path guard matters because this function performs recursive deletion
    # before every CMake configure.
    if ($resolvedPath -ne $resolvedRepo -and -not $resolvedPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a build directory outside the repository: $resolvedPath"
    }

    if (Test-Path -LiteralPath $resolvedPath) {
        Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    }
}

<#
.SYNOPSIS
Builds the user-mode CMake fixture for both WDK7 architectures.

.DESCRIPTION
The fixture covers executables, DLLs, static libraries, FetchContent, and the
optional DbgEng target. This keeps the workflow YAML small while preserving the
same coverage as the previous inline CI script.
#>
function Build-CmakeUserTargets {
    param(
        [string]$BuildLabel,
        [bool]$ExpectDbgEng
    )

    $source = Join-Path $repoRoot "test\e2e\cmake"
    $expected = @(
        "e2e_cli.exe",
        "e2e_dll.dll",
        "e2e_lib.lib",
        "e2e_native.exe"
    )

    if ($ExpectDbgEng) {
        $expected += "e2e_dbgeng.exe"
    }

    foreach ($arch in @("i386", "amd64")) {
        $build = Join-Path $repoRoot ".e2e\$BuildLabel-$arch"

        # A clean build directory makes missing target assertions meaningful.
        Clear-BuildDirectory $build

        Invoke-Checked "cmake" @(
            "-S", $source,
            "-B", $build,
            "-G", $env:WDK7_CMAKE_GENERATOR,
            "-DCMAKE_TOOLCHAIN_FILE=$env:WDK7_CMAKE_TOOLCHAIN_FILE",
            "-DWDK7_ARCH=$arch",
            "-DCMAKE_BUILD_TYPE=Release"
        )

        Invoke-Checked "cmake" @("--build", $build, "--config", "Release")

        # The fixture validates artifacts instead of only trusting command exit
        # codes because a toolchain regression can silently skip a target.
        foreach ($file in $expected) {
            $path = Join-Path $build $file
            Assert-ExistingPath $path "Missing CMake $arch output: $path"
        }

        $dbgengPath = Join-Path $build "e2e_dbgeng.exe"

        # The default setup must not leak Debugging Tools paths into normal WDK
        # builds. This assertion protects the debugger opt-in contract.
        if (-not $ExpectDbgEng -and (Test-Path -LiteralPath $dbgengPath)) {
            throw "DbgEng target was built without debugger=true: $dbgengPath"
        }
    }
}

<#
.SYNOPSIS
Builds the kernel-mode CMake fixture for both WDK7 architectures.

.DESCRIPTION
The sys fixture verifies that the bundled toolchain can switch into kernel mode
with standard CMake target commands.
#>
function Build-CmakeSysTargets {
    $source = Join-Path $repoRoot "test\e2e\cmake-sys"

    foreach ($arch in @("i386", "amd64")) {
        $build = Join-Path $repoRoot ".e2e\cmake-sys-$arch"

        # Kernel builds are sensitive to cached linker state, so each arch gets
        # a freshly configured build tree.
        Clear-BuildDirectory $build

        Invoke-Checked "cmake" @(
            "-S", $source,
            "-B", $build,
            "-G", $env:WDK7_CMAKE_GENERATOR,
            "-DCMAKE_TOOLCHAIN_FILE=$env:WDK7_CMAKE_TOOLCHAIN_FILE",
            "-DWDK7_ARCH=$arch",
            "-DWDK7_DEFAULT_MODE=KERNEL",
            "-DCMAKE_BUILD_TYPE=Release"
        )

        Invoke-Checked "cmake" @("--build", $build, "--config", "Release")

        $path = Join-Path $build "e2e_sys.sys"

        # A successful command is not enough; the expected driver file must be
        # present for the fixture to prove the linker mode worked.
        Assert-ExistingPath $path "Missing CMake $arch sys output: $path"
    }
}

<#
.SYNOPSIS
Builds the legacy ddkbuild fixture for x86 and amd64.

.DESCRIPTION
Legacy WDK projects commonly rely on ddkbuild.cmd rather than CMake. This
fixture protects the compatibility wrapper that the action exports.
#>
function Build-DdkbuildTarget {
    $source = "test\e2e\ddkbuild\sys"
    $sourcePath = Join-Path $repoRoot $source

    foreach ($target in @("-WIN7", "-WIN7A64")) {
        # cmd.exe is used because ddkbuild.cmd sets batch-local environment and
        # expects normal cmd call semantics. The source path stays relative
        # because legacy ddkbuild path handling is more reliable with repo-local
        # target directories than with absolute workflow paths.
        Invoke-Checked "cmd" @("/s", "/c", "call ddkbuild.cmd $target free ""$source""")
    }

    $sysFiles = @(Get-ChildItem -Path $sourcePath -Recurse -Filter e2e_ddkbuild.sys)

    # Both architectures should produce a driver. Counting outputs catches a
    # regression where one target overwrites or skips the other.
    if ($sysFiles.Count -lt 2) {
        throw "Expected ddkbuild to produce x86 and amd64 .sys files."
    }

    $sysFiles | ForEach-Object { Write-Host $_.FullName }
}

Assert-ExistingPath $env:WDK7_ROOT "WDK7_ROOT is not set or does not exist."
Assert-ExistingPath $env:WDK7_CMAKE_TOOLCHAIN_FILE "WDK7_CMAKE_TOOLCHAIN_FILE is not set or does not exist."
Assert-CommandAvailable "ddkbuild.cmd"

if ([string]::IsNullOrWhiteSpace($env:WDK7_CMAKE_GENERATOR)) {
    throw "WDK7_CMAKE_GENERATOR is not set."
}

if ($Mode -eq "debugger") {
    # Debugger mode must prove the action exported the SDK paths before the CMake
    # fixture attempts to link the DbgEng target.
    Assert-ExistingPath $env:WDK7_DBGENG_INCLUDE_DIR "WDK7_DBGENG_INCLUDE_DIR is not set or does not exist."
    Assert-ExistingPath $env:WDK7_DBGENG_LIB_I386 "WDK7_DBGENG_LIB_I386 is not set or does not exist."
    Assert-ExistingPath $env:WDK7_DBGENG_LIB_AMD64 "WDK7_DBGENG_LIB_AMD64 is not set or does not exist."
    Build-CmakeUserTargets "cmake-dbgeng" $true
} else {
    # The default mode intentionally clears debugger variables so the fixture can
    # verify that Debugging Tools are not prepared unless explicitly requested.
    Remove-Item -LiteralPath Env:WDK7_DBGENG_INCLUDE_DIR, Env:WDK7_DBGENG_LIB_I386, Env:WDK7_DBGENG_LIB_AMD64 -Force -ErrorAction SilentlyContinue
    Build-CmakeUserTargets "cmake-basic" $false
    Build-CmakeSysTargets
    Build-DdkbuildTarget
}
