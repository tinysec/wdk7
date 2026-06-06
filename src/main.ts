import { mkdirSync } from "node:fs";
import * as path from "node:path";

import {
  cacheKeyForDebugger,
  defaultCacheRoot,
  publishNotFound,
  publishStaticOutputs,
  publishWdk7,
  readInputs,
  restoreKeysForDebugger,
  type ActionInputs,
  type DebuggersSdk,
  type PreparedDebuggers,
  type WdkRoot
} from "./action.js";
import { CacheSession } from "./cache.js";
import { findDbgEngSdk, prepareDebuggersSdk, prepareOptionalDebuggersSdk } from "./debuggers.js";
import { ensureWdk7Iso, installWdk7FromIso } from "./install.js";
import { findCachedWdk7Root, findWdk7Root, findWdk7RootUnder, isWdk7Root } from "./wdk.js";

/**
 * run is the action entry point. It keeps the setup flow readable by delegating
 * discovery, cache, download, extraction, debugger SDK, and output concerns to
 * focused modules.
 */
async function run(): Promise<void> {
  if ("win32" !== process.platform) {
    throw new Error("wdk7 only runs on Windows.");
  }

  const inputs: ActionInputs = readInputs();
  const cacheRoot: string = defaultCacheRoot();
  const cacheKey: string = cacheKeyForDebugger(inputs.debugger);
  const restoreKeys: string[] = restoreKeysForDebugger(inputs.debugger);
  const cache: CacheSession = new CacheSession(cacheRoot, cacheKey, restoreKeys);

  // The cache directory must exist before either @actions/cache or local ISO
  // extraction can use it.
  mkdirSync(cacheRoot, { recursive: true });

  publishStaticOutputs();

  const installed: WdkRoot | undefined = findWdk7Root(inputs.root, cacheRoot, false);

  if (undefined !== installed) {
    await useInstalledRoot(inputs, installed, cache, cacheRoot);

    return;
  }

  await cache.restoreOnce();

  let found: WdkRoot | undefined = findWdk7Root(inputs.root, cacheRoot, true);

  // Older cache layouts can place WDK7 below an extra directory level, so the
  // broad scan runs only after the clear candidate list fails.
  if (undefined === found) {
    found = findCachedWdk7Root(cacheRoot);
  }

  if (undefined !== found) {
    await useCachedRoot(inputs, found, cache, cacheRoot);

    return;
  }

  await downloadAndUseRoot(inputs, cache, cacheRoot);
}

/**
 * useInstalledRoot handles explicit, environment, and default local WDK roots.
 * These roots are not saved back into the WDK cache, but newly extracted
 * Debugging Tools cache files should still be preserved.
 */
async function useInstalledRoot(
  inputs: ActionInputs,
  installed: WdkRoot,
  cache: CacheSession,
  cacheRoot: string
): Promise<void> {
  const prepared: PreparedDebuggers = await prepareInstalledDebuggers(inputs, installed.root, cache, cacheRoot);

  await cache.saveWhenChanged(prepared.cacheChanged);

  publishWdk7(installed.root, installed.source, cache.hasRestored(), prepared.sdk);
}

/**
 * useCachedRoot handles roots found after cache restore or local cache probing.
 * Saving under the requested key preserves local cache discoveries and upgrades
 * WDK-only restores to debugger-enabled cache entries when needed.
 */
async function useCachedRoot(
  inputs: ActionInputs,
  found: WdkRoot,
  cache: CacheSession,
  cacheRoot: string
): Promise<void> {
  const prepared: PreparedDebuggers = await prepareOptionalDebuggersSdk(
    inputs.debugger,
    found.root,
    cacheRoot,
    inputs.downloadUrls
  );

  await cache.saveIfDifferentKey();

  publishWdk7(
    found.root,
    found.source,
    "cache" === found.source || true === cache.hasRestored(),
    prepared.sdk
  );
}

/**
 * downloadAndUseRoot installs WDK7 from the ISO when no existing tree is usable.
 * The final validation searches both the target cache directory and C:\WinDDK
 * because MSI extraction can choose either layout depending on package metadata.
 */
async function downloadAndUseRoot(inputs: ActionInputs, cache: CacheSession, cacheRoot: string): Promise<void> {
  if (0 === inputs.downloadUrls.length) {
    publishNotFound("WDK7 was not found and no download URLs are configured.");

    return;
  }

  const isoPath: string = await ensureWdk7Iso(cacheRoot, inputs.downloadUrls);
  const targetRoot: string = path.join(cacheRoot, "7600.16385.1");

  if (false === isWdk7Root(targetRoot)) {
    await installWdk7FromIso(isoPath, targetRoot);
  }

  let resolvedRoot: string | undefined = findWdk7RootUnder(targetRoot);

  // Administrative MSI extraction may use C:\WinDDK metadata even when the
  // action requested a cache target directory, so both locations are validated.
  if (undefined === resolvedRoot) {
    resolvedRoot = findWdk7RootUnder("C:\\WinDDK");
  }

  if (undefined === resolvedRoot) {
    throw new Error("WDK7 extraction completed, but no valid WDK7 root was found.");
  }

  const prepared: PreparedDebuggers = await prepareOptionalDebuggersSdk(
    inputs.debugger,
    resolvedRoot,
    cacheRoot,
    inputs.downloadUrls
  );

  await cache.saveIfDifferentKey();

  publishWdk7(resolvedRoot, "download", false, prepared.sdk);
}

/**
 * prepareInstalledDebuggers performs the extra debugger lookup needed for local
 * WDK installations. Cache restore is delayed until the selected WDK root has no
 * SDK, which avoids unnecessary cache work for plain local installs.
 */
async function prepareInstalledDebuggers(
  inputs: ActionInputs,
  wdkRoot: string,
  cache: CacheSession,
  cacheRoot: string
): Promise<PreparedDebuggers> {
  if (false === inputs.debugger) {
    return { cacheChanged: false };
  }

  let sdk: DebuggersSdk | undefined = findDbgEngSdk(wdkRoot, cacheRoot);

  if (undefined !== sdk) {
    return {
      sdk: sdk,
      cacheChanged: false
    };
  }

  await cache.restoreOnce();

  sdk = findDbgEngSdk(wdkRoot, cacheRoot);

  if (undefined !== sdk) {
    return {
      sdk: sdk,
      cacheChanged: false
    };
  }

  return prepareDebuggersSdk(wdkRoot, cacheRoot, inputs.downloadUrls);
}

/**
 * onRunError preserves the action's existing graceful-failure behavior. The
 * action publishes found=false instead of terminating before downstream steps
 * can inspect outputs.
 */
run().catch(function onRunError(error: unknown): void {
  if (error instanceof Error) {
    publishNotFound(`wdk7 failed: ${error.message}`);

    return;
  }

  publishNotFound(`wdk7 failed: ${String(error)}`);
});
