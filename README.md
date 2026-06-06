# setup-wdk7

`setup-wdk7` is a GitHub/Gitea compatible JavaScript action that prepares
Windows Driver Kit 7.1 for CI jobs.

It first detects an existing WDK7 tree, then reuses a local cache, and finally
downloads and extracts the WDK7 ISO when it cannot find a usable tree. The
default prepared environment is WDK7-only; Debugging Tools are prepared only
when `debugger: true` is set.

## Usage

```yaml
- name: setup wdk7
  id: wdk7
  uses: tinysec/setup-wdk7@v1
```

Then use the resolved root in CMake:

```yaml
- name: configure wdk7
  if: steps.wdk7.outputs.found == 'true'
  shell: cmd
  run: |
    cmake -S . -B build -G "${{ steps.wdk7.outputs.cmake-generator }}" ^
      -DCMAKE_TOOLCHAIN_FILE="${{ steps.wdk7.outputs.toolchain-file }}" ^
      -DWDK7_ARCH=${{ matrix.arch }}
```

The action bundles `cmake/wdk7.cmake`, so projects can use the action's
toolchain file directly. If a project carries a customized copy, pass that path
to CMake instead.

`wdk7.cmake` adapts WDK7 to ordinary CMake user-mode targets by default. It does
not provide a parallel `wdk7_add_*` helper DSL; project CMake files should use
standard CMake commands for exe, dll, and static library targets:

```cmake
add_library(plugin SHARED plugin.c)
target_link_libraries(plugin PRIVATE kernel32)
```

The same model works with `FetchContent` without a WDK-specific wrapper:

```cmake
include(FetchContent)

FetchContent_Declare(
    zlib
    GIT_REPOSITORY https://github.com/madler/zlib.git
    GIT_TAG v1.3.1
)
FetchContent_MakeAvailable(zlib)
```

When a project needs mixed user/kernel targets, configure with
`-DWDK7_DEFAULT_MODE=NONE` and use standard CMake target commands with the
provided interface targets such as `WDK7::User`, `WDK7::Kernel`, and
`WDK7::KernelWdm`. For driver-only CMake projects, `-DWDK7_DEFAULT_MODE=KERNEL`
sets kernel compiler defaults; the `.sys` suffix, entry point, and driver linker
flags are still expressed with ordinary `set_target_properties()` and
`target_link_options()`.

For WinDbg extensions or DbgEng programs, opt in to the Debugging Tools SDK:

```yaml
- name: setup wdk7
  id: wdk7
  uses: tinysec/setup-wdk7@v1
  with:
    debugger: true
```

The action does not bundle a `FindDbgEng.cmake` module and does not define a
`WDK7::DbgEng` CMake target. Projects should keep their own find module or
target definition, typically named `DbgEng::DbgEng`, in the project repository.
When `debugger: true` is used, the action exposes the prepared SDK through
`WDK7_DBGENG_INCLUDE_DIR`, `WDK7_DBGENG_LIB_I386`, and
`WDK7_DBGENG_LIB_AMD64`.

For legacy WDK build projects, the action also bundles `ddkbuild.cmd` and sets
`W7BASE` after WDK7 is resolved:

```yaml
- name: build with ddkbuild
  if: steps.wdk7.outputs.found == 'true'
  shell: cmd
  run: |
    call "${{ steps.wdk7.outputs.ddkbuild-cmd }}" -WIN7A64 checked src
```

## Inputs

- `root`: explicit WDK7 root.
- `download-url`: optional WDK7 ISO URL list. Separate multiple URLs with
  newlines, commas, or semicolons. These URLs are tried before the built-in
  Microsoft URL.
- `debugger`: set to `true` to prepare the Debugging Tools SDK and expose DbgEng
  include/library outputs. Defaults to `false`.

## Outputs

- `found`: `true` when WDK7 is ready.
- `root`: resolved WDK7 root.
- `source`: `input`, `environment`, `cache`, `default`, `download`, or `none`.
- `cache-hit`: `true` when an existing cached tree was reused.
- `cmake-module-dir`: absolute path to the bundled CMake module directory.
- `toolchain-file`: absolute path to the bundled CMake WDK7 toolchain file.
- `ddkbuild-cmd`: absolute path to the bundled `ddkbuild.cmd` wrapper.
- `cmake-generator`: recommended generator, currently `NMake Makefiles`.
- `dbgeng-found`: `true` when `debugger: true` and a usable DbgEng SDK was found
  or prepared.
- `debuggers-root`: resolved Debugging Tools root when `dbgeng-found` is `true`.
- `dbgeng-include-dir`: DbgEng include directory when `dbgeng-found` is `true`.
- `dbgeng-lib-i386`: DbgEng x86 library directory when `dbgeng-found` is `true`.
- `dbgeng-lib-amd64`: DbgEng amd64 library directory when `dbgeng-found` is
  `true`.
- `debuggers-bin-x86`: x86 Debugging Tools binary directory when available.
- `debuggers-bin-x64`: x64 Debugging Tools binary directory when available.

## Cache Behavior

Detection order:

1. explicit `root`
2. `WDK7_ROOT`
3. `W7BASE`
4. default `C:\WinDDK\7600.16385.1`
5. restored/local WDK7 cache
6. download and extraction

There is no "do not download" switch. If WDK7 is not found, the action tries the
configured download URLs and then the built-in Microsoft URL. If `debugger:
true` is set and the Debugging Tools SDK is not found, the action extracts it
from the same WDK7 ISO. To force a specific local tree, pass `root`.

The default cache is WDK-only and uses the key `wdk-7600.16385.1`. When
`debugger: true` is used, the action uses `wdk-7600.16385.1-debugger` and may
restore the WDK-only cache first to avoid downloading WDK7 twice.

Debugging Tools are exposed as a separate SDK surface. The action exports
`WDK7_DEBUGGERS_ROOT`, `WDK7_DBGENG_INCLUDE_DIR`, `WDK7_DBGENG_LIB_I386`, and
`WDK7_DBGENG_LIB_AMD64` only when `debugger: true`; it does not append these
directories to the generic WDK7 include/library sets.

The default local cache root is:

- `$RUNNER_TOOL_CACHE\wdk7` on GitHub/Gitea runners when available.
- `%LOCALAPPDATA%\actions-tool-cache\wdk7` otherwise.
- `%TEMP%\actions-tool-cache\wdk7` as a last fallback.

On GitHub-hosted runners, the action restores and saves this directory through
the GitHub Actions cache service by default. On Gitea, cache support depends on
your runner/server configuration; if no cache service is exposed, the action
continues with the local disk cache and does not fail just because cache is
unavailable.

Self-hosted runner disk persistence is still the fastest path for WDK7.

## Development

The action is implemented in TypeScript and published as a bundled JavaScript
action:

```powershell
cd D:\code\setup-wdk7
npm.cmd install
npm.cmd run build
```

Commit both `src/main.ts` and the generated `dist/index.js`.

PowerShell is intentionally limited to `scripts/mount-iso.ps1` and
`scripts/dismount-iso.ps1`, because `Mount-DiskImage` and `Dismount-DiskImage`
are Windows-native operations. Detection, downloads, outputs, and PATH updates
are handled by TypeScript.

## Local Debugging

You can debug the action without GitHub:

```powershell
cd D:\code\setup-wdk7
.\scripts\test-local.ps1
```

If local execution policy blocks scripts, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-local.ps1
```

The test script creates temporary `GITHUB_OUTPUT`, `GITHUB_ENV`, and
`GITHUB_PATH` files, runs `dist/index.js`, and prints exactly what the action
would export to later CI steps.

The repository contains one CI workflow, `.github/workflows/ci.yaml`. It builds
the action bundle, prepares WDK7 through this action, then compiles the static
fixtures under `test/e2e`:

- CMake plus `cmake/wdk7.cmake`: standard `add_executable()`/`add_library()`
  user-mode exe, dll, static lib, a FetchContent static lib, and a Debugging
  Tools-linked exe for i386 and amd64.
- CMake plus `cmake/wdk7.cmake`: standard-command WDM sys for i386 and amd64.
- `ddkbuild.cmd`: WDM sys for i386 and amd64.

## Release

Create the GitHub repository first, then push:

```powershell
cd D:\code\setup-wdk7
git init
git add .
git commit -m "Initial setup-wdk7 action"
git branch -M master
git remote add origin https://github.com/tinysec/setup-wdk7.git
git push -u origin master
git tag v1.0.0
git tag v1
git push origin v1.0.0 v1
```

For compatible updates, create a new concrete tag and move the major tag:

```powershell
git tag v1.0.1
git tag -f v1
git push origin v1.0.1
git push -f origin v1
```
