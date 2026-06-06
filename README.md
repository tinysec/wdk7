# wdk7

`wdk7` is a GitHub/Gitea compatible JavaScript action that prepares Windows
Driver Kit 7.1 for CI jobs.

It first detects an existing WDK7 tree, then reuses a local cache, and finally
downloads and extracts the WDK7 ISO when it cannot find a usable tree.

## Usage

```yaml
- name: setup wdk7
  id: wdk7
  uses: tinysec/wdk7@v1
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

## Outputs

- `found`: `true` when WDK7 is ready.
- `root`: resolved WDK7 root.
- `source`: `input`, `environment`, `cache`, `default`, `download`, or `none`.
- `cache-hit`: `true` when an existing cached tree was reused.
- `toolchain-file`: absolute path to the bundled CMake WDK7 toolchain file.
- `ddkbuild-cmd`: absolute path to the bundled `ddkbuild.cmd` wrapper.
- `cmake-generator`: recommended generator, currently `NMake Makefiles`.

## Cache Behavior

Detection order:

1. explicit `root`
2. `WDK7_ROOT`
3. `W7BASE`
4. default `C:\WinDDK\7600.16385.1`
5. restored/local WDK7 cache
6. download and extraction

There is no "do not download" switch. If WDK7 is not found, the action tries
the configured download URLs and then the built-in Microsoft URL. To force a
specific local tree, pass `root`.

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
cd D:\code\wdk7
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
cd D:\code\wdk7
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

- CMake plus `cmake/wdk7.cmake`: exe, dll, static lib, and WDM sys for i386 and
  amd64.
- `ddkbuild.cmd`: WDM sys for i386 and amd64.

## Release

Create the GitHub repository first, then push:

```powershell
cd D:\code\wdk7
git init
git add .
git commit -m "Initial wdk7 action"
git branch -M master
git remote add origin https://github.com/tinysec/wdk7.git
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
