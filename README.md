# setup-wdk7

[![CI](https://github.com/tinysec/setup-wdk7/actions/workflows/ci.yaml/badge.svg)](https://github.com/tinysec/setup-wdk7/actions/workflows/ci.yaml)
[![Release](https://img.shields.io/github/v/release/tinysec/setup-wdk7?display_name=tag&sort=semver)](https://github.com/tinysec/setup-wdk7/releases)
[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-setup--wdk7-2088ff?logo=githubactions)](https://github.com/tinysec/setup-wdk7)

`setup-wdk7` prepares Windows Driver Kit 7.1 for legacy Windows driver and SDK
builds in CI. It finds an existing WDK7 install when available, restores a
cached copy when possible, or downloads and extracts the WDK7 ISO when the
runner starts clean.

## Features

- Detects WDK7 from an explicit input, `WDK7_ROOT`, `W7BASE`, local cache, or
  the default `C:\WinDDK` installation path.
- Downloads, extracts, and caches WDK7 automatically on Windows runners.
- Exposes a bundled CMake toolchain for `i386` and `amd64` builds.
- Supports user-mode binaries, kernel `.sys` targets, and legacy
  `ddkbuild.cmd` projects.
- Optionally prepares the Debugging Tools SDK for DbgEng and WinDbg extension
  builds.

## Usage

```yaml
jobs:
  build:
    runs-on: windows-2025

    steps:
      - uses: actions/checkout@v4

      - name: setup wdk7
        id: wdk7
        uses: tinysec/setup-wdk7@v1

      - name: build with cmake
        shell: cmd
        run: |
          cmake -S . -B build -G "${{ steps.wdk7.outputs.cmake-generator }}" ^
            -DCMAKE_TOOLCHAIN_FILE="${{ steps.wdk7.outputs.toolchain-file }}" ^
            -DWDK7_ARCH=amd64 ^
            -DCMAKE_BUILD_TYPE=Release
          cmake --build build --config Release
```

For Debugging Tools and DbgEng headers/libraries:

```yaml
- name: setup wdk7 with debugging tools
  id: wdk7
  uses: tinysec/setup-wdk7@v1
  with:
    debugger: true
```

For legacy DDKBuild projects:

```yaml
- name: build driver
  shell: cmd
  run: call ddkbuild.cmd -WIN7A64 free src
```

Use `root` to point at a preinstalled WDK7 tree, or `download-url` to provide
one or more custom ISO URLs before the built-in Microsoft URL is tried.
