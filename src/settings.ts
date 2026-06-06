import * as core from "@actions/core";

import { uniqueStrings } from "./lists.js";
import type { ActionInputs } from "./types.js";

export const defaultDownloadUrls: string[] = [
  "https://download.microsoft.com/download/4/A/2/4A25C7D5-EFBE-4182-B6A9-AE6850409A78/GRMWDK_EN_7600_1.ISO"
];

export const cmakeGenerator: string = "NMake Makefiles";
export const wdkOnlyCacheKey: string = "wdk-7600.16385.1";
export const debuggerCacheKey: string = "wdk-7600.16385.1-debugger";
export const downloadRetries: number = 3;

/**
 * readInputs converts raw GitHub action inputs into the small configuration
 * object used by the action. The built-in WDK7 URL is appended here so the rest
 * of the code can treat download sources as one ordered list.
 */
export function readInputs(): ActionInputs {
  const configuredDownloadUrls: string[] = splitDownloadUrls(core.getInput("download-url"));
  const downloadUrls: string[] = uniqueStrings(configuredDownloadUrls.concat(defaultDownloadUrls));
  const root: string = core.getInput("root");
  const debuggerEnabled: boolean = readBooleanInput("debugger", false);

  return {
    root: root,
    downloadUrls: downloadUrls,
    debugger: debuggerEnabled
  };
}

/**
 * cacheKeyForDebugger selects the cache namespace that matches the requested
 * SDK surface. Debugger-enabled runs need a distinct key because the cache may
 * contain extra DbgEng headers and libraries.
 */
export function cacheKeyForDebugger(debuggerEnabled: boolean): string {
  // A debugger cache can safely contain the base WDK, but the reverse is not true.
  if (true === debuggerEnabled) {
    return debuggerCacheKey;
  }

  return wdkOnlyCacheKey;
}

/**
 * restoreKeysForDebugger allows a debugger run to reuse a WDK-only cache first.
 * This avoids downloading the large ISO twice when the only missing pieces are
 * Debugging Tools files.
 */
export function restoreKeysForDebugger(debuggerEnabled: boolean): string[] {
  if (true === debuggerEnabled) {
    return [wdkOnlyCacheKey];
  }

  return [];
}

/**
 * splitDownloadUrls accepts the separators people commonly use in workflow
 * YAML. The parser is intentionally small because these values are only URLs,
 * not a general configuration language.
 */
function splitDownloadUrls(value: string): string[] {
  const result: string[] = [];
  const parts: string[] = value.split(/[\r\n,;]+/);

  for (const part of parts) {
    const trimmed: string = part.trim();

    if ("" !== trimmed) {
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * readBooleanInput validates boolean action inputs before they can affect the
 * install flow. GitHub inputs arrive as strings, so rejecting unexpected values
 * makes workflow mistakes fail with a direct message.
 */
function readBooleanInput(name: string, defaultValue: boolean): boolean {
  const rawValue: string = core.getInput(name);
  const value: string = rawValue.trim().toLowerCase();

  if ("" === value) {
    return defaultValue;
  }

  if ("true" === value) {
    return true;
  }

  if ("false" === value) {
    return false;
  }

  throw new Error(`Input '${name}' must be true or false.`);
}
