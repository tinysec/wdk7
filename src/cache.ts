import * as actionsCache from "@actions/cache";
import * as core from "@actions/core";

/**
 * CacheSession tracks one Actions cache restore/save lifecycle. The action may
 * need to restore only once and then decide later whether the cache should be
 * saved, so this class keeps that state explicit instead of passing mutable
 * variables through the main flow.
 */
export class CacheSession {
  private root: string;
  private key: string;
  private restoreKeys: string[];
  private restoredKey: string | undefined;
  private restoreAttempted: boolean;

  /**
   * The constructor stores cache identity without touching the cache service.
   * Deferring network calls keeps the main flow free to skip restore when a
   * valid local WDK installation already satisfies the request.
   */
  public constructor(root: string, key: string, restoreKeys: string[]) {
    this.root = root;
    this.key = key;
    this.restoreKeys = restoreKeys;
    this.restoredKey = undefined;
    this.restoreAttempted = false;
  }

  /**
   * restoreOnce lazily restores the cache and returns the hit key. Repeated
   * calls are common in the debugger flow, and only the first one should contact
   * the cache service.
   */
  public async restoreOnce(): Promise<string | undefined> {
    if (false === this.restoreAttempted) {
      this.restoreAttempted = true;
      this.restoredKey = await restoreActionCache(this.root, this.key, this.restoreKeys);
    }

    return this.restoredKey;
  }

  /**
   * hasRestored reports whether any Actions cache entry was reused. The action
   * exposes this as a user-facing cache-hit signal.
   */
  public hasRestored(): boolean {
    return undefined !== this.restoredKey;
  }

  /**
   * saveIfDifferentKey stores the cache when the exact requested key was not
   * already restored. This also upgrades a base WDK cache into the debugger
   * cache after Debugging Tools are prepared.
   */
  public async saveIfDifferentKey(): Promise<void> {
    if (this.key === this.restoredKey) {
      return;
    }

    await saveActionCache(this.root, this.key);
  }

  /**
   * saveWhenChanged is used for flows that started from a local WDK install.
   * They should not save the local WDK tree, but should preserve newly extracted
   * debugger files placed under the action cache root.
   */
  public async saveWhenChanged(changed: boolean): Promise<void> {
    if (false === changed) {
      return;
    }

    await this.saveIfDifferentKey();
  }
}

/**
 * restoreActionCache wraps @actions/cache restore behavior with non-fatal error
 * handling. Cache service outages should slow WDK setup down, not break a build
 * that can still download or use local disk state.
 */
async function restoreActionCache(cacheRoot: string, cacheKey: string, restoreKeys: string[]): Promise<string | undefined> {
  if (false === actionsCache.isFeatureAvailable()) {
    core.info("Actions cache service is not available; using local disk cache only.");

    return undefined;
  }

  try {
    core.info(`Restoring WDK7 cache with key '${cacheKey}'.`);

    const hit: string | undefined = await actionsCache.restoreCache([cacheRoot], cacheKey, restoreKeys);

    if (undefined !== hit) {
      core.info(`Restored WDK7 cache from key '${hit}'.`);
    } else {
      core.info("No WDK7 actions/cache entry was restored.");
    }

    return hit;
  } catch (error) {
    core.warning(`WDK7 cache restore failed: ${formatError(error)}`);

    return undefined;
  }
}

/**
 * saveActionCache wraps @actions/cache save behavior with non-fatal error
 * handling. Cache save races are expected in CI matrices, and a skipped save
 * should not invalidate a successful build.
 */
async function saveActionCache(cacheRoot: string, cacheKey: string): Promise<void> {
  if (false === actionsCache.isFeatureAvailable()) {
    core.info("Actions cache service is not available; skipping WDK7 cache save.");

    return;
  }

  try {
    core.info(`Saving WDK7 cache with key '${cacheKey}'.`);
    await actionsCache.saveCache([cacheRoot], cacheKey);
  } catch (error) {
    core.warning(`WDK7 cache save skipped: ${formatError(error)}`);
  }
}

/**
 * formatError keeps cache warnings readable even when an external library throws
 * a non-Error value.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
