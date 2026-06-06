import { existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

import { fullPath } from "./paths.js";

interface DirectoryVisit {
  dir: string;
  depth: number;
}

/**
 * listFilesUnder performs a bounded depth-first file scan. The action needs
 * this for cache and SDK discovery where directory names vary between WDK
 * installers, but a maximum depth prevents accidental scans of huge disks.
 */
export function listFilesUnder(
  root: string,
  predicate: (filePath: string) => boolean,
  maxDepth: number = 10
): string[] {
  const resolvedRoot: string = fullPath(root);

  if ("" === resolvedRoot || false === existsSync(resolvedRoot)) {
    return [];
  }

  const result: string[] = [];
  const stack: DirectoryVisit[] = [{ dir: resolvedRoot, depth: 0 }];

  while (0 < stack.length) {
    const current: DirectoryVisit | undefined = stack.pop();

    if (undefined === current) {
      continue;
    }

    // Directory reads may fail inside restored caches; skipping unreadable paths
    // lets discovery continue without turning one bad directory into an action failure.
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
 * readDirectoryEntries isolates filesystem errors from the traversal loop.
 * Caches can contain partially written extraction output after a cancelled job,
 * and discovery should keep looking for a valid WDK tree elsewhere.
 */
function readDirectoryEntries(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/**
 * readStats wraps statSync so callers can treat inaccessible entries as absent.
 * This keeps discovery deterministic on Windows runners with inconsistent ACLs
 * or antivirus races during extraction.
 */
function readStats(filePath: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(filePath);
  } catch {
    return undefined;
  }
}
