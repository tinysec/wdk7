import * as core from "@actions/core";
import * as actionsCache from "@actions/cache";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const defaultDownloadUrl =
  "https://download.microsoft.com/download/4/A/2/4A25C7D5-EFBE-4182-B6A9-AE6850409A78/GRMWDK_EN_7600_1.ISO";
const cmakeGenerator = "NMake Makefiles";
const cacheKey = "wdk7-7600.16385.1";
const restoreKeys = ["wdk7-"];
const downloadRetries = 3;

interface Candidate {
  root: string;
  source: string;
}

interface Inputs {
  root: string;
  downloadUrl: string;
}

function readInputs(): Inputs {
  return {
    root: core.getInput("root"),
    downloadUrl: core.getInput("download-url") || defaultDownloadUrl
  };
}

function actionRoot(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function toolchainFile(): string {
  return path.join(actionRoot(), "cmake", "wdk7.cmake");
}

function ddkbuildCmd(): string {
  return path.join(actionRoot(), "ddkbuild.cmd");
}

function publishStaticOutputs(): void {
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

function publishWdk7(root: string, source: string, cacheHit: boolean): void {
  const resolvedRoot = fullPath(root);
  const host = hostBin(resolvedRoot);

  core.exportVariable("WDK7_ROOT", resolvedRoot);
  core.exportVariable("W7BASE", resolvedRoot);
  core.exportVariable("WDK7_HOST_BIN", host);
  core.exportVariable("WDK7_CMAKE_TOOLCHAIN_FILE", toolchainFile());
  core.exportVariable("WDK7_DDKBUILD_CMD", ddkbuildCmd());
  core.exportVariable("WDK7_CMAKE_GENERATOR", cmakeGenerator);

  core.addPath(host);

  core.setOutput("found", "true");
  core.setOutput("root", resolvedRoot);
  core.setOutput("source", source);
  core.setOutput("cache-hit", cacheHit ? "true" : "false");

  core.info(`WDK7 ready: root='${resolvedRoot}' source='${source}'`);
}

function publishNotFound(reason: string): void {
  core.info(reason);
  publishStaticOutputs();
  core.setOutput("found", "false");
  core.setOutput("root", "");
  core.setOutput("source", "none");
  core.setOutput("cache-hit", "false");
}

async function run(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("wdk7 only runs on Windows.");
  }

  const inputs = readInputs();
  const cacheRoot = defaultCacheRoot();
  mkdirSync(cacheRoot, { recursive: true });
  publishStaticOutputs();

  const installed = findWdk7Root(inputs.root, cacheRoot, false);
  if (installed) {
    publishWdk7(installed.root, installed.source, false);
    return;
  }

  let restoredCacheKey: string | undefined;
  restoredCacheKey = await restoreActionCache(cacheRoot, cacheKey, restoreKeys);

  const found = findWdk7Root(inputs.root, cacheRoot, true);
  if (found) {
    publishWdk7(
      found.root,
      found.source,
      found.source === "cache" || Boolean(restoredCacheKey),
    );
    return;
  }

  if (!inputs.downloadUrl.trim()) {
    publishNotFound("WDK7 was not found and no download URL was provided.");
    return;
  }

  const isoPath = path.join(cacheRoot, "GRMWDK_EN_7600_1.ISO");
  if (existsSync(isoPath)) {
    core.info(`Using cached WDK7 ISO: ${isoPath}`);
  } else {
    core.info(`Downloading WDK7 ISO from: ${inputs.downloadUrl}`);
    await downloadFileWithRetries(inputs.downloadUrl, isoPath, downloadRetries);
  }

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

  if (restoredCacheKey !== cacheKey) {
    await saveActionCache(cacheRoot, cacheKey);
  }

  publishWdk7(resolvedRoot, "download", false);
}

run().catch(error => {
  publishNotFound(`wdk7 failed: ${error instanceof Error ? error.message : String(error)}`);
});
