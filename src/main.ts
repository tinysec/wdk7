import * as core from "@actions/core";
import * as actionsCache from "@actions/cache";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const defaultDownloadUrls = [
  "https://download.microsoft.com/download/4/A/2/4A25C7D5-EFBE-4182-B6A9-AE6850409A78/GRMWDK_EN_7600_1.ISO"
];
const cmakeGenerator = "NMake Makefiles";
const wdkOnlyCacheKey = "wdk-7600.16385.1";
const debuggerCacheKey = "wdk-7600.16385.1-debugger";
const downloadRetries = 3;

interface Candidate {
  root: string;
  source: string;
}

interface Inputs {
  root: string;
  downloadUrls: string[];
  debugger: boolean;
}

interface DebuggersSdk {
  root: string;
  includeDir: string;
  libI386: string;
  libAmd64: string;
  binX86: string;
  binX64: string;
}

function readInputs(): Inputs {
  const downloadUrls = splitDownloadUrls(core.getInput("download-url"));

  return {
    root: core.getInput("root"),
    downloadUrls: uniqueStrings([...downloadUrls, ...defaultDownloadUrls]),
    debugger: readBooleanInput("debugger", false)
  };
}

function splitDownloadUrls(value: string): string[] {
  return value
    .split(/[\r\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function readBooleanInput(name: string, defaultValue: boolean): boolean {
  const value = core.getInput(name).trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Input '${name}' must be true or false.`);
}

function actionRoot(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function cmakeModuleDir(): string {
  return path.join(actionRoot(), "cmake");
}

function toolchainFile(): string {
  return path.join(cmakeModuleDir(), "wdk7.cmake");
}

function ddkbuildCmd(): string {
  return path.join(actionRoot(), "ddkbuild.cmd");
}

function publishStaticOutputs(): void {
  core.setOutput("cmake-module-dir", cmakeModuleDir());
  core.setOutput("toolchain-file", toolchainFile());
  core.setOutput("ddkbuild-cmd", ddkbuildCmd());
  core.setOutput("cmake-generator", cmakeGenerator);
}

function expandEnvironment(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? "");
}

function fullPath(value: string): string {
  if (!value.trim()) {
    return "";
  }
  return path.resolve(expandEnvironment(value));
}

function targetBins(root: string): string[] {
  return [
    path.join(root, "bin", "x86", "x86"),
    path.join(root, "bin", "x86", "amd64")
  ];
}

function hostBin(root: string): string {
  return path.join(root, "bin", "x86");
}

function isFileOrDirectoryPresent(candidatePath: string): boolean {
  return existsSync(candidatePath);
}

function isWdk7Root(root: string): boolean {
  if (!root.trim()) {
    return false;
  }

  const resolved = fullPath(root);
  const required = [
    path.join(resolved, "bin", "setenv.bat"),
    path.join(resolved, "inc", "api"),
    path.join(resolved, "inc", "ddk"),
    path.join(hostBin(resolved), "nmake.exe"),
    path.join(hostBin(resolved), "rc.exe"),
    ...targetBins(resolved).flatMap(bin => [
      path.join(bin, "cl.exe"),
      path.join(bin, "link.exe")
    ])
  ];

  return required.every(isFileOrDirectoryPresent);
}

function defaultCacheRoot(): string {
  if (process.env.RUNNER_TOOL_CACHE) {
    return path.join(process.env.RUNNER_TOOL_CACHE, "wdk7");
  }
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "actions-tool-cache", "wdk7");
  }
  return path.join(os.tmpdir(), "actions-tool-cache", "wdk7");
}

function addCandidate(candidates: Candidate[], root: string | undefined, source: string): void {
  if (!root?.trim()) {
    return;
  }

  const resolved = fullPath(root);
  if (!candidates.some(candidate => candidate.root.toLowerCase() === resolved.toLowerCase())) {
    candidates.push({ root: resolved, source });
  }
}

function findWdk7Root(
  requestedRoot: string,
  cacheRoot: string,
  includeCache: boolean
): Candidate | undefined {
  const candidates: Candidate[] = [];

  addCandidate(candidates, requestedRoot, "input");
  addCandidate(candidates, process.env.WDK7_ROOT, "environment");
  addCandidate(candidates, process.env.W7BASE, "environment");

  if (includeCache) {
    addCandidate(candidates, path.join(cacheRoot, "7600.16385.1"), "cache");
    addCandidate(candidates, path.join(cacheRoot, "7600.16385.win7_wdk.100208-1538"), "cache");
    addCandidate(candidates, path.join(cacheRoot, "wdk7", "7600.16385.1"), "cache");
    addCandidate(candidates, path.join(cacheRoot, "wdk7", "7600.16385.win7_wdk.100208-1538"), "cache");
  }

  addCandidate(candidates, "C:\\WinDDK\\7600.16385.1", "default");
  addCandidate(candidates, "C:\\WinDDK\\7600.16385.win7_wdk.100208-1538", "default");

  return candidates.find(candidate => isWdk7Root(candidate.root));
}

function findWdk7RootUnder(basePath: string): string | undefined {
  const resolvedBase = fullPath(basePath);
  if (!resolvedBase || !existsSync(resolvedBase)) {
    return undefined;
  }

  if (isWdk7Root(resolvedBase)) {
    return resolvedBase;
  }

  const stack = [resolvedBase];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry);
      let stats;
      try {
        stats = statSync(entryPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.toLowerCase() === "setenv.bat") {
        const root = path.dirname(path.dirname(entryPath));
        if (isWdk7Root(root)) {
          return fullPath(root);
        }
      }
    }
  }

  return undefined;
}

function findCachedWdk7Root(cacheRoot: string): Candidate | undefined {
  const root = findWdk7RootUnder(cacheRoot);
  return root ? { root, source: "cache" } : undefined;
}

function hasDbgEngInclude(includeDir: string): boolean {
  return existsSync(path.join(includeDir, "DbgEng.h"));
}

function hasDbgEngLibraries(libraryDir: string): boolean {
  return existsSync(path.join(libraryDir, "dbgeng.lib")) &&
    existsSync(path.join(libraryDir, "dbghelp.lib"));
}

function debuggerBin(root: string, arch: "x86" | "x64"): string {
  const candidates = [
    path.join(root, arch),
    path.join(root, "Debuggers", arch),
    path.join(root, "Debugging Tools for Windows", arch),
    path.join(root, `Debugging Tools for Windows (${arch})`)
  ];

  return candidates.find(candidate => existsSync(candidate)) ?? "";
}

function createDebuggersSdk(
  root: string,
  includeDir: string,
  libI386: string,
  libAmd64: string
): DebuggersSdk | undefined {
  if (!hasDbgEngInclude(includeDir) || !hasDbgEngLibraries(libI386) || !hasDbgEngLibraries(libAmd64)) {
    return undefined;
  }

  const resolvedRoot = fullPath(root);
  return {
    root: resolvedRoot,
    includeDir: fullPath(includeDir),
    libI386: fullPath(libI386),
    libAmd64: fullPath(libAmd64),
    binX86: debuggerBin(resolvedRoot, "x86"),
    binX64: debuggerBin(resolvedRoot, "x64")
  };
}

function findDbgEngSdkInKnownLayouts(root: string): DebuggersSdk | undefined {
  const resolved = fullPath(root);
  if (!resolved || !existsSync(resolved)) {
    return undefined;
  }

  const layouts = [
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

  for (const layout of layouts) {
    const sdk = createDebuggersSdk(layout.root, layout.includeDir, layout.libI386, layout.libAmd64);
    if (sdk) {
      return sdk;
    }
  }

  return undefined;
}

function listFilesUnder(root: string, predicate: (filePath: string) => boolean, maxDepth = 10): string[] {
  const resolved = fullPath(root);
  if (!resolved || !existsSync(resolved)) {
    return [];
  }

  const result: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: resolved, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(current.dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry);
      let stats;
      try {
        stats = statSync(entryPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (current.depth < maxDepth) {
          stack.push({ dir: entryPath, depth: current.depth + 1 });
        }
      } else if (predicate(entryPath)) {
        result.push(entryPath);
      }
    }
  }

  return result;
}

function findDbgEngSdkUnder(root: string): DebuggersSdk | undefined {
  const known = findDbgEngSdkInKnownLayouts(root);
  if (known) {
    return known;
  }

  const includeFiles = listFilesUnder(root, filePath => path.basename(filePath).toLowerCase() === "dbgeng.h");
  if (includeFiles.length === 0) {
    return undefined;
  }

  const libDirs = uniqueStrings(
    listFilesUnder(root, filePath => path.basename(filePath).toLowerCase() === "dbgeng.lib")
      .map(filePath => path.dirname(filePath))
      .filter(hasDbgEngLibraries)
  );

  if (libDirs.length === 0) {
    return undefined;
  }

  const amd64Lib = libDirs.find(dir => /[\\\/](amd64|x64)([\\\/]|$)/i.test(dir));
  const i386Lib =
    libDirs.find(dir => /[\\\/](i386|x86)([\\\/]|$)/i.test(dir) && !/[\\\/](amd64|x64)([\\\/]|$)/i.test(dir)) ??
    libDirs.find(dir => !/[\\\/](amd64|x64)([\\\/]|$)/i.test(dir));

  if (!i386Lib || !amd64Lib) {
    return undefined;
  }

  for (const includeFile of includeFiles) {
    const includeDir = path.dirname(includeFile);
    let debuggerRoot = path.dirname(includeDir);
    if (path.basename(debuggerRoot).toLowerCase() === "sdk") {
      debuggerRoot = path.dirname(debuggerRoot);
    }

    const sdk = createDebuggersSdk(debuggerRoot, includeDir, i386Lib, amd64Lib);
    if (sdk) {
      return sdk;
    }
  }

  return undefined;
}

function findDbgEngSdk(wdkRoot: string, cacheRoot: string): DebuggersSdk | undefined {
  return findDbgEngSdkUnder(wdkRoot) ?? findDbgEngSdkUnder(cacheRoot);
}

function runProcess(command: string, args: string[], options?: { cwd?: string; silent?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    core.debug(`Running: ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      cwd: options?.cwd,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      if (!options?.silent) {
        process.stdout.write(text);
      }
    });

    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      if (!options?.silent) {
        process.stderr.write(text);
      }
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} failed with exit code ${code}. ${stderr.trim()}`));
      }
    });
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function downloadFile(urlText: string, outputPath: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 8) {
    throw new Error(`Too many redirects while downloading '${urlText}'.`);
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  const url = new URL(urlText);
  const client = url.protocol === "https:" ? https : http;
  const tmpPath = `${outputPath}.tmp`;

  await new Promise<void>((resolve, reject) => {
    const request = client.get(url, response => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, outputPath, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}: ${urlText}`));
        return;
      }

      const file = createWriteStream(tmpPath);
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          renameSync(tmpPath, outputPath);
          resolve();
        });
      });
      file.on("error", error => {
        rmSync(tmpPath, { force: true });
        reject(error);
      });
    });

    request.on("error", error => {
      rmSync(tmpPath, { force: true });
      reject(error);
    });

    request.setTimeout(300000, () => {
      request.destroy(new Error(`Download timed out after 300 seconds: ${urlText}`));
    });
  });
}

async function downloadFileWithRetries(urlText: string, outputPath: string, attempts: number): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await downloadFile(urlText, outputPath);
      return;
    } catch (error) {
      lastError = error;
      rmSync(outputPath, { force: true });

      if (attempt >= attempts) {
        break;
      }

      const delay = Math.min(30000, 2000 * attempt);
      core.warning(
        `WDK7 ISO download attempt ${attempt}/${attempts} failed: ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${delay / 1000}s.`
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadFileFromUrlsWithRetries(
  urls: string[],
  outputPath: string,
  attempts: number
): Promise<string> {
  let lastError: unknown;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    try {
      core.info(`Downloading WDK7 ISO from source ${index + 1}/${urls.length}: ${url}`);
      await downloadFileWithRetries(url, outputPath, attempts);
      return url;
    } catch (error) {
      lastError = error;
      rmSync(outputPath, { force: true });

      if (index + 1 < urls.length) {
        core.warning(
          `WDK7 ISO source ${index + 1}/${urls.length} failed: ${
            error instanceof Error ? error.message : String(error)
          }. Trying next source.`
        );
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function ensureWdk7Iso(cacheRoot: string, urls: string[]): Promise<string> {
  const isoPath = path.join(cacheRoot, "GRMWDK_EN_7600_1.ISO");

  if (existsSync(isoPath)) {
    core.info(`Using cached WDK7 ISO: ${isoPath}`);
    return isoPath;
  }

  const downloadedUrl = await downloadFileFromUrlsWithRetries(urls, isoPath, downloadRetries);
  core.info(`Downloaded WDK7 ISO from: ${downloadedUrl}`);
  return isoPath;
}

async function mountIso(isoPath: string): Promise<string> {
  const script = path.join(actionRoot(), "scripts", "mount-iso.ps1");
  const output = await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-ImagePath",
    isoPath
  ], { silent: true });

  const drive = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
  if (!drive) {
    throw new Error("Mount-DiskImage did not return a drive letter.");
  }
  return drive.replace(":", "");
}

async function dismountIso(isoPath: string): Promise<void> {
  const script = path.join(actionRoot(), "scripts", "dismount-iso.ps1");
  await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-ImagePath",
    isoPath
  ], { silent: true });
}

function findDebuggersMsiFiles(mediaRoot: string): string[] {
  return listFilesUnder(mediaRoot, filePath => {
    const lower = filePath.toLowerCase();
    const baseName = path.basename(lower);
    return baseName.endsWith(".msi") &&
      (baseName.startsWith("dbg") ||
        lower.includes("debuggingtools") ||
        lower.includes("debuggers"));
  });
}

async function extractMsi(msiPath: string, targetRoot: string, logRoot: string): Promise<boolean> {
  const baseName = path.basename(msiPath, path.extname(msiPath));
  const logPath = path.join(logRoot, `${baseName}.log`);

  try {
    core.info(`Extracting ${path.basename(msiPath)} to ${targetRoot}`);
    await runProcess("msiexec.exe", [
      "/a",
      msiPath,
      "/qn",
      "/norestart",
      `TARGETDIR=${targetRoot}`,
      "/l*v",
      logPath
    ]);
    return true;
  } catch (error) {
    core.info(`Skipping ${path.basename(msiPath)}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function installDebuggersFromIso(isoPath: string, wdkRoot: string, cacheRoot: string): Promise<boolean> {
  core.info(`Mounting WDK7 ISO for Debugging Tools: ${isoPath}`);
  const drive = await mountIso(isoPath);

  try {
    const mediaRoot = `${drive}:\\`;
    const msiFiles = findDebuggersMsiFiles(mediaRoot);
    if (msiFiles.length === 0) {
      core.info("No Debugging Tools MSI packages were found in the WDK7 ISO.");
      return false;
    }

    let changed = false;
    const targetRoots = uniqueStrings([
      wdkRoot,
      path.join(cacheRoot, "debuggers")
    ]);

    for (const targetRoot of targetRoots) {
      mkdirSync(targetRoot, { recursive: true });
      const logRoot = path.join(targetRoot, "_debuggers_install_logs");
      mkdirSync(logRoot, { recursive: true });

      for (const msiPath of msiFiles) {
        changed = await extractMsi(msiPath, targetRoot, logRoot) || changed;
      }

      if (findDbgEngSdk(wdkRoot, cacheRoot)) {
        return changed;
      }
    }

    return changed;
  } finally {
    await dismountIso(isoPath);
  }
}

async function prepareDebuggersSdk(
  wdkRoot: string,
  cacheRoot: string,
  downloadUrls: string[]
): Promise<{ sdk?: DebuggersSdk; cacheChanged: boolean }> {
  let sdk = findDbgEngSdk(wdkRoot, cacheRoot);
  if (sdk) {
    return { sdk, cacheChanged: false };
  }

  if (downloadUrls.length === 0) {
    core.info("WDK7 Debuggers SDK was not found and no download URLs are configured.");
    return { cacheChanged: false };
  }

  const isoPath = await ensureWdk7Iso(cacheRoot, downloadUrls);
  const changed = await installDebuggersFromIso(isoPath, wdkRoot, cacheRoot);
  sdk = findDbgEngSdk(wdkRoot, cacheRoot);

  if (!sdk) {
    core.info("WDK7 Debuggers SDK was not found after Debugging Tools extraction.");
  }

  return { sdk, cacheChanged: changed };
}

async function installWdk7FromIso(isoPath: string, targetRoot: string): Promise<void> {
  core.info(`Mounting WDK7 ISO: ${isoPath}`);
  const drive = await mountIso(isoPath);

  try {
    const mediaRoot = `${drive}:\\WDK`;
    if (!existsSync(mediaRoot)) {
      throw new Error(`Mounted ISO does not contain a WDK directory: ${mediaRoot}`);
    }

    mkdirSync(targetRoot, { recursive: true });
    const logRoot = path.join(targetRoot, "_install_logs");
    mkdirSync(logRoot, { recursive: true });

    const msiFiles = readdirSync(mediaRoot)
      .filter(entry => entry.toLowerCase().endsWith(".msi"))
      .map(entry => path.join(mediaRoot, entry));

    if (msiFiles.length === 0) {
      throw new Error(`No WDK MSI packages found under '${mediaRoot}'.`);
    }

    for (const msiPath of msiFiles) {
      const baseName = path.basename(msiPath, path.extname(msiPath));
      const logPath = path.join(logRoot, `${baseName}.log`);
      core.info(`Extracting ${path.basename(msiPath)}`);
      await runProcess("msiexec.exe", [
        "/a",
        msiPath,
        "/qn",
        "/norestart",
        `TARGETDIR=${targetRoot}`,
        "/l*v",
        logPath
      ]);
    }
  } finally {
    await dismountIso(isoPath);
  }
}

async function restoreActionCache(cacheRoot: string, cacheKey: string, restoreKeys: string[]): Promise<string | undefined> {
  if (!actionsCache.isFeatureAvailable()) {
    core.info("Actions cache service is not available; using local disk cache only.");
    return undefined;
  }

  try {
    core.info(`Restoring WDK7 cache with key '${cacheKey}'.`);
    const hit = await actionsCache.restoreCache([cacheRoot], cacheKey, restoreKeys);
    if (hit) {
      core.info(`Restored WDK7 cache from key '${hit}'.`);
    } else {
      core.info("No WDK7 actions/cache entry was restored.");
    }
    return hit;
  } catch (error) {
    core.warning(`WDK7 cache restore failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function saveActionCache(cacheRoot: string, cacheKey: string): Promise<void> {
  if (!actionsCache.isFeatureAvailable()) {
    core.info("Actions cache service is not available; skipping WDK7 cache save.");
    return;
  }

  try {
    core.info(`Saving WDK7 cache with key '${cacheKey}'.`);
    await actionsCache.saveCache([cacheRoot], cacheKey);
  } catch (error) {
    core.warning(`WDK7 cache save skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function publishDebuggersSdk(sdk?: DebuggersSdk): void {
  if (!sdk) {
    core.setOutput("dbgeng-found", "false");
    core.setOutput("debuggers-root", "");
    core.setOutput("dbgeng-include-dir", "");
    core.setOutput("dbgeng-lib-i386", "");
    core.setOutput("dbgeng-lib-amd64", "");
    core.setOutput("debuggers-bin-x86", "");
    core.setOutput("debuggers-bin-x64", "");
    return;
  }

  core.exportVariable("WDK7_DEBUGGERS_ROOT", sdk.root);
  core.exportVariable("WDK7_DBGENG_INCLUDE_DIR", sdk.includeDir);
  core.exportVariable("WDK7_DBGENG_LIB_I386", sdk.libI386);
  core.exportVariable("WDK7_DBGENG_LIB_AMD64", sdk.libAmd64);
  core.exportVariable("WDK7_DEBUGGERS_BIN_X86", sdk.binX86);
  core.exportVariable("WDK7_DEBUGGERS_BIN_X64", sdk.binX64);

  core.setOutput("dbgeng-found", "true");
  core.setOutput("debuggers-root", sdk.root);
  core.setOutput("dbgeng-include-dir", sdk.includeDir);
  core.setOutput("dbgeng-lib-i386", sdk.libI386);
  core.setOutput("dbgeng-lib-amd64", sdk.libAmd64);
  core.setOutput("debuggers-bin-x86", sdk.binX86);
  core.setOutput("debuggers-bin-x64", sdk.binX64);

  core.info(
    `WDK7 Debuggers SDK ready: root='${sdk.root}' include='${sdk.includeDir}' ` +
    `lib-i386='${sdk.libI386}' lib-amd64='${sdk.libAmd64}'`
  );
}

function publishWdk7(root: string, source: string, cacheHit: boolean, sdk?: DebuggersSdk): void {
  const resolvedRoot = fullPath(root);
  const host = hostBin(resolvedRoot);

  core.exportVariable("WDK7_ROOT", resolvedRoot);
  core.exportVariable("W7BASE", resolvedRoot);
  core.exportVariable("WDK7_HOST_BIN", host);
  core.exportVariable("WDK7_CMAKE_MODULE_DIR", cmakeModuleDir());
  core.exportVariable("WDK7_CMAKE_TOOLCHAIN_FILE", toolchainFile());
  core.exportVariable("WDK7_DDKBUILD_CMD", ddkbuildCmd());
  core.exportVariable("WDK7_CMAKE_GENERATOR", cmakeGenerator);

  core.addPath(host);

  core.setOutput("found", "true");
  core.setOutput("root", resolvedRoot);
  core.setOutput("source", source);
  core.setOutput("cache-hit", cacheHit ? "true" : "false");
  publishDebuggersSdk(sdk);

  core.info(`WDK7 ready: root='${resolvedRoot}' source='${source}'`);
}

function publishNotFound(reason: string): void {
  core.info(reason);
  publishStaticOutputs();
  core.setOutput("found", "false");
  core.setOutput("root", "");
  core.setOutput("source", "none");
  core.setOutput("cache-hit", "false");
  publishDebuggersSdk(undefined);
}

async function prepareOptionalDebuggersSdk(
  enabled: boolean,
  wdkRoot: string,
  cacheRoot: string,
  downloadUrls: string[]
): Promise<{ sdk?: DebuggersSdk; cacheChanged: boolean }> {
  if (!enabled) {
    core.info("Debugging Tools SDK was not requested. Set debugger: true to prepare DbgEng headers and libraries.");
    return { cacheChanged: false };
  }

  return prepareDebuggersSdk(wdkRoot, cacheRoot, downloadUrls);
}

async function run(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("wdk7 only runs on Windows.");
  }

  const inputs = readInputs();
  const cacheRoot = defaultCacheRoot();
  const cacheKey = inputs.debugger ? debuggerCacheKey : wdkOnlyCacheKey;
  const restoreKeys = inputs.debugger ? [wdkOnlyCacheKey] : [];
  mkdirSync(cacheRoot, { recursive: true });
  publishStaticOutputs();

  let restoredCacheKey: string | undefined;
  let cacheRestoreAttempted = false;
  const restoreCacheOnce = async (): Promise<void> => {
    if (!cacheRestoreAttempted) {
      cacheRestoreAttempted = true;
      restoredCacheKey = await restoreActionCache(cacheRoot, cacheKey, restoreKeys);
    }
  };

  const installed = findWdk7Root(inputs.root, cacheRoot, false);
  if (installed) {
    let sdk = inputs.debugger ? findDbgEngSdk(installed.root, cacheRoot) : undefined;
    let cacheChanged = false;

    if (inputs.debugger && !sdk) {
      await restoreCacheOnce();
      sdk = findDbgEngSdk(installed.root, cacheRoot);
    }

    if (inputs.debugger && !sdk) {
      const prepared = await prepareOptionalDebuggersSdk(true, installed.root, cacheRoot, inputs.downloadUrls);
      sdk = prepared.sdk;
      cacheChanged = prepared.cacheChanged;
    }

    publishWdk7(installed.root, installed.source, Boolean(restoredCacheKey), sdk);
    return;
  }

  await restoreCacheOnce();

  const found = findWdk7Root(inputs.root, cacheRoot, true) ?? findCachedWdk7Root(cacheRoot);
  if (found) {
    const prepared = await prepareOptionalDebuggersSdk(inputs.debugger, found.root, cacheRoot, inputs.downloadUrls);
    if (restoredCacheKey !== cacheKey) {
      await saveActionCache(cacheRoot, cacheKey);
    }

    publishWdk7(
      found.root,
      found.source,
      found.source === "cache" || Boolean(restoredCacheKey),
      prepared.sdk
    );
    return;
  }

  if (inputs.downloadUrls.length === 0) {
    publishNotFound("WDK7 was not found and no download URLs are configured.");
    return;
  }

  const isoPath = await ensureWdk7Iso(cacheRoot, inputs.downloadUrls);

  const targetRoot = path.join(cacheRoot, "7600.16385.1");
  if (!isWdk7Root(targetRoot)) {
    await installWdk7FromIso(isoPath, targetRoot);
  }

  const resolvedRoot =
    findWdk7RootUnder(targetRoot) ??
    findWdk7RootUnder("C:\\WinDDK");

  if (!resolvedRoot) {
    throw new Error("WDK7 extraction completed, but no valid WDK7 root was found.");
  }

  const prepared = await prepareOptionalDebuggersSdk(inputs.debugger, resolvedRoot, cacheRoot, inputs.downloadUrls);

  if (restoredCacheKey !== cacheKey) {
    await saveActionCache(cacheRoot, cacheKey);
  }

  publishWdk7(resolvedRoot, "download", false, prepared.sdk);
}

run().catch(error => {
  publishNotFound(`wdk7 failed: ${error instanceof Error ? error.message : String(error)}`);
});
