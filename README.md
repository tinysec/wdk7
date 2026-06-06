# wdk7

`wdk7` is a GitHub/Gitea compatible JavaScript action that prepares Windows
Driver Kit 7.1 for CI jobs.

It first detects an existing WDK7 tree, then reuses a local cache, and finally
downloads and extracts the WDK7 ISO when requested.

## Usage

```yaml
- name: setup wdk7
  id: wdk7
  uses: tinysec/wdk7@v1
  with:
    arch: ${{ matrix.arch }}
```

`arch` accepts `amd64`, `i386`, `x64`, `x86`, or `Win32`. The normalized output
is always `amd64` or `i386`.

Then use the resolved root in CMake:

```yaml
- name: configure wdk7
  if: steps.wdk7.outputs.found == 'true'
  shell: cmd
  run: |
    cmake -S . -B build -G "${{ steps.wdk7.outputs.cmake-generator }}" ^
      -DCMAKE_TOOLCHAIN_FILE="${{ steps.wdk7.outputs.toolchain-file }}" ^
      -DWDK7_ARCH=${{ steps.wdk7.outputs.arch }}
```

The action bundles `cmake/wdk7.cmake`, so projects can use the action's
toolchain file directly. If a project carries a customized copy, pass that path
to CMake instead.

## Inputs

- `arch`: target architecture, default `amd64`.
- `root`: explicit WDK7 root.
- `download`: download and extract WDK7 when not found, default `true`.
- `download-retries`: download attempts before giving up, default `3`.
- `download-url`: WDK7 ISO URL.
- `sha256`: optional ISO SHA-256 checksum.
- `cache`: restore/save through the GitHub Actions cache service when
  available, default `true`.
- `cache-key`: primary actions/cache key, default `wdk7-7600.16385.1`.
- `restore-keys`: newline-separated fallback actions/cache restore keys,
  default `wdk7-`.
- `cache-root`: directory for ISO and extracted WDK7 cache.
- `install-root`: extraction destination.
- `fail-on-error`: fail instead of returning `found=false`, default `false`.

## Outputs

- `found`: `true` when WDK7 is ready.
- `root`: resolved WDK7 root.
- `arch`: normalized architecture.
- `source`: `input`, `environment`, `cache`, `default`, `download`, or `none`.
- `cache-hit`: `true` when an existing cached tree was reused.
- `cache-key`: primary actions/cache key used by this run.
- `toolchain-file`: absolute path to the bundled CMake WDK7 toolchain file.
- `cmake-generator`: recommended generator, currently `NMake Makefiles`.

## Cache Behavior

Detection order:

1. explicit `root`
2. `WDK7_ROOT`
3. `W7BASE`
4. default `C:\WinDDK\7600.16385.1`
5. restored/local WDK7 cache
6. download and extraction

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
are Windows-native operations. Detection, downloads, hashing, outputs, and PATH
updates are handled by TypeScript.

## Local Debugging

You can debug the action without GitHub:

```powershell
cd D:\code\wdk7
.\scripts\test-local.ps1 -Arch amd64 -Download false
.\scripts\test-local.ps1 -Arch i386 -Download false
```

If local execution policy blocks scripts, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-local.ps1 -Arch amd64 -Download false
```

The test script creates temporary `GITHUB_OUTPUT`, `GITHUB_ENV`, and
`GITHUB_PATH` files, runs `dist/index.js`, and prints exactly what the action
would export to later CI steps.

If you have `act` configured with a Windows host runner, the repository also
contains `.github/workflows/self-test.yml`, whose steps call this action as
`uses: ./`.

## Release

Create the GitHub repository first, then push:

```powershell
cd D:\code\wdk7
git init
git add .
git commit -m "Initial wdk7 action"
git branch -M main
git remote add origin https://github.com/tinysec/wdk7.git
git push -u origin main
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
