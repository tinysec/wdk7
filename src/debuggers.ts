import * as core from "@actions/core";
import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";

import { fullPath, uniqueStrings, type DebuggersSdk, type PreparedDebuggers } from "./action.js";
import { dismountIso, ensureWdk7Iso, extractMsi, listFilesUnder, mountIso } from "./install.js";

interface DebuggersLayout {
  root: string;
  includeDir: string;
  libI386: string;
  libAmd64: string;
}

/**
 * findDbgEngSdk searches the WDK root first, then the cache root. This order
 * prefers files tied to the selected WDK installation while still supporting
 * separately cached Debugging Tools extraction.
 */
export function findDbgEngSdk(wdkRoot: string, cacheRoot: string): DebuggersSdk | undefined {
  const sdkFromWdk: DebuggersSdk | undefined = findDbgEngSdkUnder(wdkRoot);

  if (undefined !== sdkFromWdk) {
    return sdkFromWdk;
  }

  return findDbgEngSdkUnder(cacheRoot);
}

/**
 * prepareOptionalDebuggersSdk keeps the main flow explicit about the debugger
 * opt-in. Normal WDK setup should not pay for Debugging Tools discovery or
 * extraction unless the workflow requested it.
 */
export async function prepareOptionalDebuggersSdk(
  enabled: boolean,
  wdkRoot: string,
  cacheRoot: string,
  downloadUrls: string[]
): Promise<PreparedDebuggers> {
  if (false === enabled) {
    core.info("Debugging Tools SDK was not requested. Set debugger: true to prepare DbgEng headers and libraries.");

    return { cacheChanged: false };
  }

  return prepareDebuggersSdk(wdkRoot, cacheRoot, downloadUrls);
}

/**
 * prepareDebuggersSdk finds or extracts the optional DbgEng SDK. It reports
 * cache changes separately so callers can avoid saving unchanged local WDK
 * installations.
 */
export async function prepareDebuggersSdk(
  wdkRoot: string,
  cacheRoot: string,
  downloadUrls: string[]
): Promise<PreparedDebuggers> {
  let sdk: DebuggersSdk | undefined = findDbgEngSdk(wdkRoot, cacheRoot);

  if (undefined !== sdk) {
    return {
      sdk: sdk,
      cacheChanged: false
    };
  }

  if (0 === downloadUrls.length) {
    core.info("WDK7 Debuggers SDK was not found and no download URLs are configured.");

    return { cacheChanged: false };
  }

  const isoPath: string = await ensureWdk7Iso(cacheRoot, downloadUrls);
  const changed: boolean = await installDebuggersFromIso(isoPath, wdkRoot, cacheRoot);

  sdk = findDbgEngSdk(wdkRoot, cacheRoot);

  if (undefined === sdk) {
    core.info("WDK7 Debuggers SDK was not found after Debugging Tools extraction.");
  }

  return {
    sdk: sdk,
    cacheChanged: changed
  };
}

/**
 * hasDbgEngInclude checks the header that proves an include directory exposes
 * the Debugging Tools SDK API.
 */
function hasDbgEngInclude(includeDir: string): boolean {
  return existsSync(path.join(includeDir, "DbgEng.h"));
}

/**
 * hasDbgEngLibraries checks the paired libraries used by DbgEng consumers. Both
 * files are required because linking dbgeng-only programs commonly also needs
 * dbghelp.lib from the same SDK layout.
 */
function hasDbgEngLibraries(libraryDir: string): boolean {
  return existsSync(path.join(libraryDir, "dbgeng.lib")) &&
    existsSync(path.join(libraryDir, "dbghelp.lib"));
}

/**
 * debuggerBin resolves optional Debugging Tools executable directories. These
 * paths are exported when available but are not required for SDK-only builds.
 */
function debuggerBin(root: string, arch: "x86" | "x64"): string {
  const candidates: string[] = [
    path.join(root, arch),
    path.join(root, "Debuggers", arch),
    path.join(root, "Debugging Tools for Windows", arch),
    path.join(root, `Debugging Tools for Windows (${arch})`)
  ];

  for (const candidate of candidates) {
    if (true === existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

/**
 * createDebuggersSdk validates a possible SDK layout before exposing it. This
 * keeps all layout probes honest: a directory is accepted only when the header
 * and both architecture libraries are present.
 */
function createDebuggersSdk(
  root: string,
  includeDir: string,
  libI386: string,
  libAmd64: string
): DebuggersSdk | undefined {
  if (false === hasDbgEngInclude(includeDir)) {
    return undefined;
  }

  if (false === hasDbgEngLibraries(libI386)) {
    return undefined;
  }

  if (false === hasDbgEngLibraries(libAmd64)) {
    return undefined;
  }

  const resolvedRoot: string = fullPath(root);

  return {
    root: resolvedRoot,
    includeDir: fullPath(includeDir),
    libI386: fullPath(libI386),
    libAmd64: fullPath(libAmd64),
    binX86: debuggerBin(resolvedRoot, "x86"),
    binX64: debuggerBin(resolvedRoot, "x64")
  };
}

/**
 * findDbgEngSdkInKnownLayouts checks common installer layouts before scanning.
 * Direct layout checks are easier to understand and faster than recursively
 * searching every restored cache.
 */
function findDbgEngSdkInKnownLayouts(root: string): DebuggersSdk | undefined {
  const resolved: string = fullPath(root);

  if ("" === resolved || false === existsSync(resolved)) {
    return undefined;
  }

  const layouts: DebuggersLayout[] = knownLayouts(resolved);

  for (const layout of layouts) {
    const sdk: DebuggersSdk | undefined = createDebuggersSdk(
      layout.root,
      layout.includeDir,
      layout.libI386,
      layout.libAmd64
    );

    if (undefined !== sdk) {
      return sdk;
    }
  }

  return undefined;
}

/**
 * findDbgEngSdkUnder scans for DbgEng headers and matching architecture library
 * directories when known layouts fail. This supports unusual administrative MSI
 * extraction trees without hardcoding every possible path.
 */
function findDbgEngSdkUnder(root: string): DebuggersSdk | undefined {
  const known: DebuggersSdk | undefined = findDbgEngSdkInKnownLayouts(root);

  if (undefined !== known) {
    return known;
  }

  const includeFiles: string[] = findDbgEngHeaders(root);

  if (0 === includeFiles.length) {
    return undefined;
  }

  const libDirs: string[] = findDbgEngLibraryDirs(root);

  if (0 === libDirs.length) {
    return undefined;
  }

  const amd64Lib: string | undefined = findAmd64Library(libDirs);
  const i386Lib: string | undefined = findI386Library(libDirs);

  if (undefined === i386Lib || undefined === amd64Lib) {
    return undefined;
  }

  for (const includeFile of includeFiles) {
    const includeDir: string = path.dirname(includeFile);
    const debuggerRoot: string = debuggerRootFromIncludeDir(includeDir);
    const sdk: DebuggersSdk | undefined = createDebuggersSdk(debuggerRoot, includeDir, i386Lib, amd64Lib);

    if (undefined !== sdk) {
      return sdk;
    }
  }

  return undefined;
}

/**
 * installDebuggersFromIso extracts Debugging Tools MSI packages into both the
 * selected WDK root and the cache root. Some builds expect the SDK beside WDK7,
 * while the cache copy survives future clean runners.
 */
async function installDebuggersFromIso(isoPath: string, wdkRoot: string, cacheRoot: string): Promise<boolean> {
  core.info(`Mounting WDK7 ISO for Debugging Tools: ${isoPath}`);

  const drive: string = await mountIso(isoPath);

  try {
    const mediaRoot: string = `${drive}:\\`;
    const msiFiles: string[] = findDebuggersMsiFiles(mediaRoot);

    if (0 === msiFiles.length) {
      core.info("No Debugging Tools MSI packages were found in the WDK7 ISO.");

      return false;
    }

    let changed: boolean = false;
    const targetRoots: string[] = uniqueStrings([
      wdkRoot,
      path.join(cacheRoot, "debuggers")
    ]);

    for (const targetRoot of targetRoots) {
      mkdirSync(targetRoot, { recursive: true });

      const logRoot: string = path.join(targetRoot, "_debuggers_install_logs");
      mkdirSync(logRoot, { recursive: true });

      for (const msiPath of msiFiles) {
        const extracted: boolean = await extractMsi(msiPath, targetRoot, logRoot);

        if (true === extracted) {
          changed = true;
        }
      }

      if (undefined !== findDbgEngSdk(wdkRoot, cacheRoot)) {
        return changed;
      }
    }

    return changed;
  } finally {
    await dismountIso(isoPath);
  }
}

/**
 * knownLayouts returns the common SDK directory shapes produced by WDK7 and
 * Debugging Tools installers. Keeping this data in a small function makes layout
 * support easy to extend without touching discovery control flow.
 */
function knownLayouts(resolved: string): DebuggersLayout[] {
  return [
    {
      root: path.join(resolved, "Debuggers"),
      includeDir: path.join(resolved, "Debuggers", "sdk", "inc"),
      libI386: path.join(resolved, "Debuggers", "sdk", "lib", "i386"),
      libAmd64: path.join(resolved, "Debuggers", "sdk", "lib", "amd64")
    },
    {
      root: resolved,
      includeDir: path.join(resolved, "sdk", "inc"),
      libI386: path.join(resolved, "sdk", "lib", "i386"),
      libAmd64: path.join(resolved, "sdk", "lib", "amd64")
    },
    {
      root: path.join(resolved, "Debuggers"),
      includeDir: path.join(resolved, "Debuggers", "inc"),
      libI386: path.join(resolved, "Debuggers", "lib", "x86"),
      libAmd64: path.join(resolved, "Debuggers", "lib", "x64")
    },
    {
      root: resolved,
      includeDir: path.join(resolved, "inc"),
      libI386: path.join(resolved, "lib", "x86"),
      libAmd64: path.join(resolved, "lib", "x64")
    },
    {
      root: resolved,
      includeDir: path.join(resolved, "Include"),
      libI386: path.join(resolved, "Lib"),
      libAmd64: path.join(resolved, "Lib", "x64")
    }
  ];
}

/**
 * findDbgEngHeaders locates candidate DbgEng.h files. A named predicate keeps
 * the scan criteria searchable and avoids burying SDK identity inside a callback.
 */
function findDbgEngHeaders(root: string): string[] {
  return listFilesUnder(root, isDbgEngHeader);
}

/**
 * findDbgEngLibraryDirs returns unique directories that contain the required
 * DbgEng library pair. The directory list, not the file list, is what the action
 * later exports for linker use.
 */
function findDbgEngLibraryDirs(root: string): string[] {
  const files: string[] = listFilesUnder(root, isDbgEngLibrary);
  const dirs: string[] = [];

  for (const filePath of files) {
    const dir: string = path.dirname(filePath);

    if (true === hasDbgEngLibraries(dir)) {
      dirs.push(dir);
    }
  }

  return uniqueStrings(dirs);
}

/**
 * findAmd64Library selects the amd64/x64 library directory from scanned SDK
 * candidates. Architecture hints live in directory names for these installers.
 */
function findAmd64Library(libDirs: string[]): string | undefined {
  for (const dir of libDirs) {
    if (true === containsArchSegment(dir, ["amd64", "x64"])) {
      return dir;
    }
  }

  return undefined;
}

/**
 * findI386Library selects the x86 library directory while avoiding amd64 paths.
 * Some SDK layouts use a generic lib directory for x86, so a non-amd64 fallback
 * is kept after checking explicit i386/x86 names.
 */
function findI386Library(libDirs: string[]): string | undefined {
  for (const dir of libDirs) {
    if (true === containsArchSegment(dir, ["i386", "x86"]) &&
        false === containsArchSegment(dir, ["amd64", "x64"])) {
      return dir;
    }
  }

  for (const dir of libDirs) {
    if (false === containsArchSegment(dir, ["amd64", "x64"])) {
      return dir;
    }
  }

  return undefined;
}

/**
 * debuggerRootFromIncludeDir walks from an include directory to the SDK root.
 * WDK7 Debugging Tools commonly put headers under sdk/inc, and callers need the
 * parent Debuggers directory as the exported SDK root.
 */
function debuggerRootFromIncludeDir(includeDir: string): string {
  let debuggerRoot: string = path.dirname(includeDir);

  if ("sdk" === path.basename(debuggerRoot).toLowerCase()) {
    debuggerRoot = path.dirname(debuggerRoot);
  }

  return debuggerRoot;
}

/**
 * findDebuggersMsiFiles scans the mounted ISO for likely Debugging Tools MSI
 * packages. The package names vary, so the predicate accepts both explicit dbg
 * prefixes and descriptive directory names.
 */
function findDebuggersMsiFiles(mediaRoot: string): string[] {
  return listFilesUnder(mediaRoot, isDebuggersMsiFile);
}

/**
 * isDbgEngHeader identifies the SDK header that proves an include directory is
 * useful for DbgEng consumers.
 */
function isDbgEngHeader(filePath: string): boolean {
  return "dbgeng.h" === path.basename(filePath).toLowerCase();
}

/**
 * isDbgEngLibrary identifies dbgeng.lib files; the paired dbghelp.lib check is
 * performed later at the directory level.
 */
function isDbgEngLibrary(filePath: string): boolean {
  return "dbgeng.lib" === path.basename(filePath).toLowerCase();
}

/**
 * isDebuggersMsiFile identifies mounted ISO packages that may contain Debugging
 * Tools files. A broad match is needed because Microsoft used several naming
 * conventions across SDK package layouts.
 */
function isDebuggersMsiFile(filePath: string): boolean {
  const lower: string = filePath.toLowerCase();
  const baseName: string = path.basename(lower);

  if (false === baseName.endsWith(".msi")) {
    return false;
  }

  return baseName.startsWith("dbg") ||
    lower.includes("debuggingtools") ||
    lower.includes("debuggers");
}

/**
 * containsArchSegment checks architecture names as path segments. Segment-aware
 * matching avoids treating unrelated directory text as an architecture hint.
 */
function containsArchSegment(value: string, archNames: string[]): boolean {
  const normalized: string = value.replace(/\\/g, "/").toLowerCase();
  const segments: string[] = normalized.split("/");

  for (const segment of segments) {
    for (const archName of archNames) {
      if (segment === archName) {
        return true;
      }
    }
  }

  return false;
}
