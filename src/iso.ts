import * as core from "@actions/core";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import * as path from "node:path";

import { actionRoot } from "./paths.js";
import { runProcess } from "./process.js";

/**
 * mountIso mounts an ISO through the small PowerShell helper. Mount-DiskImage is
 * Windows-native, so keeping it in PowerShell avoids reimplementing platform
 * behavior in TypeScript.
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
 * dismountIso always calls the matching PowerShell helper. The helper tolerates
 * already-dismounted images so callers can safely use it in finally blocks.
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
 * succeeded. Debugging Tools packages vary between ISO layouts, so callers can
 * try several packages without failing the whole action on the first mismatch.
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
 * installWdk7FromIso extracts all WDK MSI packages from the mounted ISO. The
 * WDK installer is represented as a set of MSI packages, so every package under
 * the WDK media directory must be extracted into the same target tree.
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
 * runMsiExtraction keeps the exact msiexec command in one place. Administrative
 * extraction is used because CI runners need files on disk, not a registered
 * system-wide WDK installation.
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
 * listWdkMsiFiles returns the WDK media packages in deterministic directory
 * order. The ISO contains only installer payloads in this directory, so a flat
 * scan is clearer than a recursive search.
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
 * quirks. The mount helper writes the drive letter as the last meaningful line.
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
 * formatError extracts a readable message from unknown catch values. Keeping
 * this local avoids leaking error-formatting policy into the ISO API.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
