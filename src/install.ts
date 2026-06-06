import * as core from "@actions/core";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { actionRoot } from "./action.js";

export const downloadRetries: number = 3;

const maxRedirects: number = 8;
const requestTimeoutMilliseconds: number = 300000;

interface DirectoryVisit {
  dir: string;
  depth: number;
}

interface RunOptions {
  cwd?: string;
  silent?: boolean;
}

/**
 * ensureWdk7Iso returns a cached ISO path or downloads one from the configured
 * sources. The ISO is stored with extracted WDK files so expensive artifacts
 * share one cache lifecycle.
 */
export async function ensureWdk7Iso(cacheRoot: string, urls: string[]): Promise<string> {
  const isoPath: string = path.join(cacheRoot, "GRMWDK_EN_7600_1.ISO");

  if (true === existsSync(isoPath)) {
    core.info(`Using cached WDK7 ISO: ${isoPath}`);
    return isoPath;
  }

  const downloadedUrl: string = await downloadFileFromUrlsWithRetries(urls, isoPath, downloadRetries);
  core.info(`Downloaded WDK7 ISO from: ${downloadedUrl}`);

  return isoPath;
}

/**
 * mountIso mounts an ISO through the PowerShell helper. Mount-DiskImage is
 * Windows-native, so the TypeScript side only coordinates the helper call.
 */
export async function mountIso(isoPath: string): Promise<string> {
  const script: string = path.join(actionRoot(), "scripts", "mount-iso.ps1");
  const output: string = await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-ImagePath",
    isoPath
  ], { silent: true });

  const drive: string = lastNonEmptyLine(output);

  if ("" === drive) {
    throw new Error("Mount-DiskImage did not return a drive letter.");
  }

  return drive.replace(":", "");
}

/**
 * dismountIso calls the matching PowerShell helper. The helper tolerates
 * already-dismounted images, so callers can safely use it in finally blocks.
 */
export async function dismountIso(isoPath: string): Promise<void> {
  const script: string = path.join(actionRoot(), "scripts", "dismount-iso.ps1");

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

/**
 * extractMsi performs an administrative MSI extraction and reports whether it
 * succeeded. Debugging Tools packages vary by ISO layout, so callers can try
 * several packages without failing on the first mismatch.
 */
export async function extractMsi(msiPath: string, targetRoot: string, logRoot: string): Promise<boolean> {
  const baseName: string = path.basename(msiPath, path.extname(msiPath));
  const logPath: string = path.join(logRoot, `${baseName}.log`);

  try {
    core.info(`Extracting ${path.basename(msiPath)} to ${targetRoot}`);
    await runMsiExtraction(msiPath, targetRoot, logPath);

    return true;
  } catch (error) {
    core.info(`Skipping ${path.basename(msiPath)}: ${formatError(error)}`);

    return false;
  }
}

/**
 * installWdk7FromIso extracts all WDK MSI packages from the mounted ISO. Every
 * MSI under the WDK media directory contributes files to the final toolchain
 * tree, so the action extracts each one into the same target root.
 */
export async function installWdk7FromIso(isoPath: string, targetRoot: string): Promise<void> {
  core.info(`Mounting WDK7 ISO: ${isoPath}`);

  const drive: string = await mountIso(isoPath);

  try {
    const mediaRoot: string = `${drive}:\\WDK`;

    if (false === existsSync(mediaRoot)) {
      throw new Error(`Mounted ISO does not contain a WDK directory: ${mediaRoot}`);
    }

    mkdirSync(targetRoot, { recursive: true });

    const logRoot: string = path.join(targetRoot, "_install_logs");
    mkdirSync(logRoot, { recursive: true });

    const msiFiles: string[] = listWdkMsiFiles(mediaRoot);

    if (0 === msiFiles.length) {
      throw new Error(`No WDK MSI packages found under '${mediaRoot}'.`);
    }

    for (const msiPath of msiFiles) {
      const baseName: string = path.basename(msiPath, path.extname(msiPath));
      const logPath: string = path.join(logRoot, `${baseName}.log`);

      core.info(`Extracting ${path.basename(msiPath)}`);
      await runMsiExtraction(msiPath, targetRoot, logPath);
    }
  } finally {
    await dismountIso(isoPath);
  }
}

/**
 * listFilesUnder performs a bounded depth-first file scan. The action uses this
 * for cache and SDK discovery where installer directory names are not stable.
 */
export function listFilesUnder(
  root: string,
  predicate: (filePath: string) => boolean,
  maxDepth: number = 10
): string[] {
  const resolvedRoot: string = path.resolve(root);

  if ("" === root.trim() || false === existsSync(resolvedRoot)) {
    return [];
  }

  const result: string[] = [];
  const stack: DirectoryVisit[] = [{ dir: resolvedRoot, depth: 0 }];

  while (0 < stack.length) {
    const current: DirectoryVisit | undefined = stack.pop();

    if (undefined === current) {
      continue;
    }

    // Directory reads can fail inside partially restored caches. Skipping one
    // unreadable directory lets discovery keep looking for valid layouts.
    const entries: string[] = readDirectoryEntries(current.dir);

    for (const entry of entries) {
      const entryPath: string = path.join(current.dir, entry);
      const stats = readStats(entryPath);

      if (undefined === stats) {
        continue;
      }

      if (true === stats.isDirectory()) {
        if (current.depth < maxDepth) {
          stack.push({ dir: entryPath, depth: current.depth + 1 });
        }
      } else if (true === predicate(entryPath)) {
        result.push(entryPath);
      }
    }
  }

  return result;
}

/**
 * runProcess executes a child process and returns trimmed stdout. Native Windows
 * tools are required for ISO mounting and MSI extraction, so process behavior is
 * centralized here instead of scattered across install code.
 */
async function runProcess(command: string, args: string[], options?: RunOptions): Promise<string> {
  /**
   * runProcessPromise bridges event-based child process APIs into async/await.
   * The closure keeps stdout and stderr buffers scoped to one child process.
   */
  function runProcessPromise(resolve: (value: string) => void, reject: (reason?: unknown) => void): void {
    const cwd: string | undefined = undefined !== options ? options.cwd : undefined;
    const silent: boolean = undefined !== options && true === options.silent;

    core.debug(`Running: ${command} ${args.join(" ")}`);

    // Windows runner services should not open visible helper windows during ISO
    // mounting or MSI extraction.
    const child = spawn(command, args, {
      cwd: cwd,
      windowsHide: true
    });

    let stdout: string = "";
    let stderr: string = "";

    child.stdout.on("data", function onStdoutData(chunk: Buffer): void {
      const text: string = chunk.toString();
      stdout = stdout + text;

      if (false === silent) {
        process.stdout.write(text);
      }
    });

    child.stderr.on("data", function onStderrData(chunk: Buffer): void {
      const text: string = chunk.toString();
      stderr = stderr + text;

      if (false === silent) {
        process.stderr.write(text);
      }
    });

    child.on("error", function onChildError(error: Error): void {
      reject(error);
    });

    child.on("close", function onChildClose(code: number | null): void {
      if (0 === code) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${command} failed with exit code ${code}. ${stderr.trim()}`));
    });
  }

  return new Promise<string>(runProcessPromise);
}

/**
 * downloadFileFromUrlsWithRetries tries each configured source in order. User
 * mirrors stay first while the built-in Microsoft URL remains a fallback.
 */
async function downloadFileFromUrlsWithRetries(urls: string[], outputPath: string, attempts: number): Promise<string> {
  let lastError: unknown = undefined;

  for (let index: number = 0; index < urls.length; index = index + 1) {
    const url: string = urls[index];

    try {
      core.info(`Downloading WDK7 ISO from source ${index + 1}/${urls.length}: ${url}`);
      await downloadFileWithRetries(url, outputPath, attempts);

      return url;
    } catch (error) {
      lastError = error;
      rmSync(outputPath, { force: true });

      if (index + 1 < urls.length) {
        core.warning(`WDK7 ISO source ${index + 1}/${urls.length} failed: ${formatError(error)}. Trying next source.`);
      }
    }
  }

  throw errorFromUnknown(lastError);
}

/**
 * downloadFileWithRetries retries one URL with a short backoff. Large ISO
 * downloads often hit transient network failures, but retrying forever would
 * hide broken workflow configuration.
 */
async function downloadFileWithRetries(urlText: string, outputPath: string, attempts: number): Promise<void> {
  let lastError: unknown = undefined;

  for (let attempt: number = 1; attempt <= attempts; attempt = attempt + 1) {
    try {
      await downloadFile(urlText, outputPath, 0);
      return;
    } catch (error) {
      lastError = error;
      rmSync(outputPath, { force: true });

      if (attempt >= attempts) {
        break;
      }

      const delay: number = Math.min(30000, 2000 * attempt);
      core.warning(`WDK7 ISO download attempt ${attempt}/${attempts} failed: ${formatError(error)}. Retrying in ${delay / 1000}s.`);

      await sleep(delay);
    }
  }

  throw errorFromUnknown(lastError);
}

/**
 * downloadFile streams one URL to disk and follows a limited number of
 * redirects. The temporary file is renamed only after the stream closes.
 */
async function downloadFile(urlText: string, outputPath: string, redirectCount: number): Promise<void> {
  if (maxRedirects < redirectCount) {
    throw new Error(`Too many redirects while downloading '${urlText}'.`);
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });

  const url: URL = new URL(urlText);
  const tmpPath: string = `${outputPath}.tmp`;

  rmSync(tmpPath, { force: true });

  /**
   * downloadFilePromise adapts the streaming HTTP client to async/await. The
   * closure owns the temporary path so every failure removes the same partial
   * file.
   */
  function downloadFilePromise(resolve: () => void, reject: (reason?: unknown) => void): void {
    /**
     * onResponse validates HTTP status before writing to disk. Native Node HTTP
     * clients do not follow redirects automatically.
     */
    function onResponse(response: http.IncomingMessage): void {
      let status: number = 0;

      if (undefined !== response.statusCode) {
        status = response.statusCode;
      }

      const location: string | undefined = response.headers.location;

      if (300 <= status && 400 > status && undefined !== location) {
        response.resume();

        const nextUrl: string = new URL(location, url).toString();
        downloadFile(nextUrl, outputPath, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (200 > status || 300 <= status) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}: ${urlText}`));
        return;
      }

      writeResponseToFile(response, tmpPath, outputPath, resolve, reject);
    }

    const client: typeof http | typeof https = "https:" === url.protocol ? https : http;
    const request: http.ClientRequest = client.get(url, onResponse);

    request.on("error", function onRequestError(error: Error): void {
      rmSync(tmpPath, { force: true });
      reject(error);
    });

    request.setTimeout(requestTimeoutMilliseconds, function onRequestTimeout(): void {
      request.destroy(new Error(`Download timed out after 300 seconds: ${urlText}`));
    });
  }

  await new Promise<void>(downloadFilePromise);
}

/**
 * writeResponseToFile finishes the stream-to-file part of a verified download.
 * Separating this from HTTP validation makes partial-file handling easy to
 * audit.
 */
function writeResponseToFile(
  response: http.IncomingMessage,
  tmpPath: string,
  outputPath: string,
  resolve: () => void,
  reject: (reason?: unknown) => void
): void {
  const file = createWriteStream(tmpPath);
  response.pipe(file);

  file.on("finish", function onFileFinish(): void {
    /**
     * onFileClosed publishes the completed temporary file only after Windows has
     * released the stream handle.
     */
    function onFileClosed(): void {
      renameSync(tmpPath, outputPath);
      resolve();
    }

    file.close(onFileClosed);
  });

  file.on("error", function onFileError(error: Error): void {
    rmSync(tmpPath, { force: true });
    reject(error);
  });
}

/**
 * runMsiExtraction keeps the exact msiexec command in one place. Administrative
 * extraction gives CI files on disk without registering a global WDK install.
 */
async function runMsiExtraction(msiPath: string, targetRoot: string, logPath: string): Promise<void> {
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

/**
 * listWdkMsiFiles returns WDK media packages in deterministic directory order.
 * The ISO's WDK directory is flat, so a non-recursive scan is clearest.
 */
function listWdkMsiFiles(mediaRoot: string): string[] {
  const result: string[] = [];
  const entries: string[] = readdirSync(mediaRoot);

  for (const entry of entries) {
    if (true === entry.toLowerCase().endsWith(".msi")) {
      result.push(path.join(mediaRoot, entry));
    }
  }

  return result;
}

/**
 * lastNonEmptyLine parses helper output without relying on PowerShell formatting
 * quirks. The mount helper writes the drive letter as its last meaningful line.
 */
function lastNonEmptyLine(output: string): string {
  let result: string = "";
  const lines: string[] = output.split(/\r?\n/);

  for (const line of lines) {
    const trimmed: string = line.trim();

    if ("" !== trimmed) {
      result = trimmed;
    }
  }

  return result;
}

/**
 * readDirectoryEntries isolates filesystem errors from traversal. Caches can
 * contain partial extraction output after cancelled jobs.
 */
function readDirectoryEntries(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/**
 * readStats wraps statSync so inaccessible entries are treated as absent.
 * Windows runners can expose inconsistent ACLs or antivirus races.
 */
function readStats(filePath: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(filePath);
  } catch {
    return undefined;
  }
}

/**
 * sleep creates an explicit async delay for retry backoff. A named helper keeps
 * retry code readable without hiding that the action is waiting.
 */
function sleep(milliseconds: number): Promise<void> {
  /**
   * sleepPromise bridges setTimeout into async/await for the retry loop.
   */
  function sleepPromise(resolve: () => void): void {
    setTimeout(resolve, milliseconds);
  }

  return new Promise<void>(sleepPromise);
}

/**
 * formatError extracts a readable message from unknown thrown values. Native
 * APIs and external packages do not always throw Error instances.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * errorFromUnknown converts a failed attempt into an Error object. Catch sites
 * can then preserve messages without branching on unknown values.
 */
function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
