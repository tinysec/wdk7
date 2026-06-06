import { existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

import { fullPath, hostBin, targetBins, type WdkRoot } from "./action.js";

/**
 * isWdk7Root validates the files required to compile both x86 and amd64 WDK7
 * targets. The action intentionally checks tools and include roots instead of
 * trusting directory names because caches may contain nested extraction layouts.
 */
export function isWdk7Root(root: string): boolean {
  if ("" === root.trim()) {
    return false;
  }

  const resolved: string = fullPath(root);
  const required: string[] = requiredWdk7Files(resolved);

  for (const requiredPath of required) {
    if (false === existsSync(requiredPath)) {
      return false;
    }
  }

  return true;
}

/**
 * findWdk7Root checks the known high-confidence locations in priority order.
 * Inputs and environment variables win over caches so self-hosted runners can
 * intentionally pin a local WDK installation.
 */
export function findWdk7Root(
  requestedRoot: string,
  cacheRoot: string,
  includeCache: boolean
): WdkRoot | undefined {
  const candidates: WdkRoot[] = [];

  addCandidate(candidates, requestedRoot, "input");
  addCandidate(candidates, process.env.WDK7_ROOT, "environment");
  addCandidate(candidates, process.env.W7BASE, "environment");

  if (true === includeCache) {
    addCacheCandidates(candidates, cacheRoot);
  }

  addCandidate(candidates, "C:\\WinDDK\\7600.16385.1", "default");
  addCandidate(candidates, "C:\\WinDDK\\7600.16385.win7_wdk.100208-1538", "default");

  for (const candidate of candidates) {
    if (true === isWdk7Root(candidate.root)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * findWdk7RootUnder scans a directory tree for a valid extracted WDK root. MSI
 * administrative extraction can produce nested layouts, so finding setenv.bat
 * and then validating the surrounding tree is more reliable than assuming one
 * exact directory name.
 */
export function findWdk7RootUnder(basePath: string): string | undefined {
  const resolvedBase: string = fullPath(basePath);

  if ("" === resolvedBase || false === existsSync(resolvedBase)) {
    return undefined;
  }

  if (true === isWdk7Root(resolvedBase)) {
    return resolvedBase;
  }

  const stack: string[] = [resolvedBase];

  while (0 < stack.length) {
    const current: string | undefined = stack.pop();

    if (undefined === current) {
      continue;
    }

    const entries: string[] = readDirectoryEntries(current);

    for (const entry of entries) {
      const entryPath: string = path.join(current, entry);
      const stats = readStats(entryPath);

      if (undefined === stats) {
        continue;
      }

      if (true === stats.isDirectory()) {
        stack.push(entryPath);
      } else if ("setenv.bat" === entry.toLowerCase()) {
        const root: string = path.dirname(path.dirname(entryPath));

        if (true === isWdk7Root(root)) {
          return fullPath(root);
        }
      }
    }
  }

  return undefined;
}

/**
 * findCachedWdk7Root searches the cache root when the known cache paths did not
 * match. This handles older cache layouts without making the primary candidate
 * list harder to read.
 */
export function findCachedWdk7Root(cacheRoot: string): WdkRoot | undefined {
  const root: string | undefined = findWdk7RootUnder(cacheRoot);

  if (undefined === root) {
    return undefined;
  }

  return {
    root: root,
    source: "cache"
  };
}

/**
 * requiredWdk7Files lists the minimum toolchain surface needed by this action.
 * The generated list stays explicit so a future WDK compatibility change can
 * see exactly which files define "usable" here.
 */
function requiredWdk7Files(root: string): string[] {
  const required: string[] = [
    path.join(root, "bin", "setenv.bat"),
    path.join(root, "inc", "api"),
    path.join(root, "inc", "ddk"),
    path.join(hostBin(root), "nmake.exe"),
    path.join(hostBin(root), "rc.exe")
  ];

  for (const bin of targetBins(root)) {
    required.push(path.join(bin, "cl.exe"));
    required.push(path.join(bin, "link.exe"));
  }

  return required;
}

/**
 * addCacheCandidates records the cache layouts that have appeared in previous
 * action versions and extraction flows. Keeping them grouped avoids burying
 * cache compatibility details in the main search order.
 */
function addCacheCandidates(candidates: WdkRoot[], cacheRoot: string): void {
  addCandidate(candidates, path.join(cacheRoot, "7600.16385.1"), "cache");
  addCandidate(candidates, path.join(cacheRoot, "7600.16385.win7_wdk.100208-1538"), "cache");
  addCandidate(candidates, path.join(cacheRoot, "wdk7", "7600.16385.1"), "cache");
  addCandidate(candidates, path.join(cacheRoot, "wdk7", "7600.16385.win7_wdk.100208-1538"), "cache");
}

/**
 * addCandidate normalizes and deduplicates possible WDK roots. Windows paths
 * are compared case-insensitively because runner filesystem casing should not
 * change detection behavior.
 */
function addCandidate(candidates: WdkRoot[], root: string | undefined, source: string): void {
  if (undefined === root || "" === root.trim()) {
    return;
  }

  const resolved: string = fullPath(root);
  const key: string = resolved.toLowerCase();

  for (const candidate of candidates) {
    if (key === candidate.root.toLowerCase()) {
      return;
    }
  }

  candidates.push({
    root: resolved,
    source: source
  });
}

/**
 * readDirectoryEntries prevents unreadable directories from aborting WDK cache
 * discovery. A stale or partially extracted cache should be skipped, not treated
 * as a fatal action error.
 */
function readDirectoryEntries(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/**
 * readStats wraps statSync for the same reason as readDirectoryEntries: cache
 * probing must tolerate broken intermediate paths and keep searching.
 */
function readStats(filePath: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(filePath);
  } catch {
    return undefined;
  }
}
