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
    cmake -S . -B build -G "NMake Makefiles" ^
      -DCMAKE_TOOLCHAIN_FILE=cmake/wdk7.cmake ^
      -DWDK7_ARCH=${{ steps.wdk7.outputs.arch }}
```

## Inputs

- `arch`: target architecture, default `amd64`.
- `root`: explicit WDK7 root.
- `download`: download and extract WDK7 when not found, default `true`.
- `download-url`: WDK7 ISO URL.
- `sha256`: optional ISO SHA-256 checksum.
- `cache-root`: directory for ISO and extracted WDK7 cache.
- `install-root`: extraction destination.
- `fail-on-error`: fail instead of returning `found=false`, default `false`.

## Outputs

- `found`: `true` when WDK7 is ready.
- `root`: resolved WDK7 root.
- `arch`: normalized architecture.
- `source`: `input`, `environment`, `cache`, `default`, `download`, or `none`.
- `cache-hit`: `true` when an existing cached tree was reused.

## Cache Behavior

The default cache root is:

- `$RUNNER_TOOL_CACHE\wdk7` on GitHub/Gitea runners when available.
- `%LOCALAPPDATA%\actions-tool-cache\wdk7` otherwise.
- `%TEMP%\actions-tool-cache\wdk7` as a last fallback.

On self-hosted runners this normally persists between jobs. On GitHub-hosted
runners the machine is ephemeral, so add `actions/cache` if you want persistence
between workflow runs:

```yaml
- uses: actions/cache@v4
  with:
    path: ${{ runner.tool_cache }}\wdk7
    key: wdk7-7600.16385.1
```

Gitea cache support depends on your runner/server configuration. Self-hosted
runner disk persistence is usually simpler for WDK7.

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
