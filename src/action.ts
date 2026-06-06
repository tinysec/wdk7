import * as core from "@actions/core";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDownloadUrls: string[] = [
  "https://download.microsoft.com/download/4/A/2/4A25C7D5-EFBE-4182-B6A9-AE6850409A78/GRMWDK_EN_7600_1.ISO"
];

const cmakeGenerator: string = "NMake Makefiles";
const wdkOnlyCacheKey: string = "wdk-7600.16385.1";
const debuggerCacheKey: string = "wdk-7600.16385.1-debugger";

/**
 * ActionInputs is the validated action configuration after GitHub input parsing.
 * Keeping this shape close to the action boundary makes the setup flow read as
 * business logic instead of raw string lookups.
 */
export interface ActionInputs {
  root: string;
  downloadUrls: string[];
  debugger: boolean;
}

/**
 * WdkRoot identifies a usable WDK7 tree and records how the action found it.
 * The source value is exposed as an output, so it stays readable for CI logs.
 */
export interface WdkRoot {
  root: string;
  source: string;
}

/**
 * DebuggersSdk contains the optional DbgEng SDK paths used by later build
 * steps. The SDK stays separate from normal WDK paths because it is opt-in.
 */
export interface DebuggersSdk {
  root: string;
  includeDir: string;
  libI386: string;
  libAmd64: string;
  binX86: string;
  binX64: string;
}

/**
 * PreparedDebuggers reports both the discovered SDK and whether extraction
 * changed the cache directory. The caller uses this to avoid unnecessary saves.
 */
export interface PreparedDebuggers {
  sdk?: DebuggersSdk;
  cacheChanged: boolean;
}

/**
 * readInputs converts raw GitHub action inputs into the compact configuration
 * object used by the rest of the action. The built-in Microsoft URL is appended
 * here so download code receives one ordered source list.
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
 * cacheKeyForDebugger selects the cache namespace that matches the requested SDK
 * surface. Debugger-enabled runs need a distinct key because the cache may
 * contain extra DbgEng headers and libraries.
 */
export function cacheKeyForDebugger(debuggerEnabled: boolean): string {
  if (true === debuggerEnabled) {
    return debuggerCacheKey;
  }

  return wdkOnlyCacheKey;
}

/**
 * restoreKeysForDebugger allows debugger runs to reuse a base WDK-only cache
 * before extracting Debugging Tools. This avoids downloading the large ISO twice
 * when only optional SDK files are missing.
 */
export function restoreKeysForDebugger(debuggerEnabled: boolean): string[] {
  if (true === debuggerEnabled) {
    return [wdkOnlyCacheKey];
  }

  return [];
}

/**
 * actionRoot returns the repository root at runtime. The bundled action entry
 * lives under dist, so walking up one level keeps CMake files and scripts
 * addressable after packaging.
 */
export function actionRoot(): string {
  const bundledEntry: string = fileURLToPath(import.meta.url);
  const distDirectory: string = path.dirname(bundledEntry);

  return path.dirname(distDirectory);
}

/**
 * cmakeModuleDir points to the bundled CMake support directory. Centralizing the
 * path keeps outputs and toolchain references aligned.
 */
export function cmakeModuleDir(): string {
  return path.join(actionRoot(), "cmake");
}

/**
 * toolchainFile returns the WDK7 CMake toolchain exposed to downstream builds.
 * It is derived from the module directory so a future move changes one helper.
 */
export function toolchainFile(): string {
  return path.join(cmakeModuleDir(), "wdk7.cmake");
}

/**
 * ddkbuildCmd returns the bundled compatibility wrapper for legacy projects.
 * Workflows consume this output instead of hardcoding repository layout.
 */
export function ddkbuildCmd(): string {
  return path.join(actionRoot(), "ddkbuild.cmd");
}

/**
 * expandEnvironment resolves Windows-style %NAME% references in user-provided
 * paths. Self-hosted runners commonly configure WDK roots this way.
 */
export function expandEnvironment(value: string): string {
  return value.replace(/%([^%]+)%/g, replaceEnvironmentToken);
}

/**
 * fullPath normalizes an input path after environment expansion. Empty values
 * stay empty so callers can distinguish absent configuration from a real path.
 */
export function fullPath(value: string): string {
  if ("" === value.trim()) {
    return "";
  }

  return path.resolve(expandEnvironment(value));
}

/**
 * targetBins lists the compiler directories that must exist for both WDK7 target
 * architectures. A root is useful only when both toolchains are present.
 */
export function targetBins(root: string): string[] {
  return [
    path.join(root, "bin", "x86", "x86"),
    path.join(root, "bin", "x86", "amd64")
  ];
}

/**
 * hostBin returns the WDK host-tool directory used by NMake and rc.exe. WDK7
 * uses x86 host tools even when targeting amd64.
 */
export function hostBin(root: string): string {
  return path.join(root, "bin", "x86");
}

/**
 * defaultCacheRoot chooses a writable cache directory for GitHub, Gitea, and
 * local debugging. Runner-managed tool cache storage wins when available.
 */
export function defaultCacheRoot(): string {
  const runnerToolCache: string | undefined = process.env.RUNNER_TOOL_CACHE;
  const localAppData: string | undefined = process.env.LOCALAPPDATA;

  if (undefined !== runnerToolCache && "" !== runnerToolCache) {
    return path.join(runnerToolCache, "wdk7");
  }

  if (undefined !== localAppData && "" !== localAppData) {
    return path.join(localAppData, "actions-tool-cache", "wdk7");
  }

  return path.join(os.tmpdir(), "actions-tool-cache", "wdk7");
}

/**
 * publishStaticOutputs exposes action-bundled assets before WDK discovery
 * finishes. Even a failed setup can then tell users where those assets live.
 */
export function publishStaticOutputs(): void {
  core.setOutput("cmake-module-dir", cmakeModuleDir());
  core.setOutput("toolchain-file", toolchainFile());
  core.setOutput("ddkbuild-cmd", ddkbuildCmd());
  core.setOutput("cmake-generator", cmakeGenerator);
}

/**
 * publishWdk7 exports a usable WDK root to later workflow steps. Environment
 * variables support shell usage, while outputs support stable workflow YAML.
 */
export function publishWdk7(root: string, source: string, cacheHit: boolean, sdk?: DebuggersSdk): void {
  const resolvedRoot: string = fullPath(root);
  const host: string = hostBin(resolvedRoot);

  core.exportVariable("WDK7_ROOT", resolvedRoot);
  core.exportVariable("W7BASE", resolvedRoot);
  core.exportVariable("WDK7_HOST_BIN", host);
  core.exportVariable("WDK7_CMAKE_MODULE_DIR", cmakeModuleDir());
  core.exportVariable("WDK7_CMAKE_TOOLCHAIN_FILE", toolchainFile());
  core.exportVariable("WDK7_DDKBUILD_CMD", ddkbuildCmd());
  core.exportVariable("WDK7_CMAKE_GENERATOR", cmakeGenerator);

  // The host tools belong on PATH because both CMake and legacy build scripts
  // invoke NMake and rc.exe after the action step completes.
  core.addPath(host);

  // The action root is added so legacy projects can run ddkbuild.cmd directly
  // without reaching through a step output for the bundled wrapper path.
  core.addPath(actionRoot());

  core.setOutput("found", "true");
  core.setOutput("root", resolvedRoot);
  core.setOutput("source", source);
  core.setOutput("cache-hit", true === cacheHit ? "true" : "false");

  publishDebuggersSdk(sdk);

  core.info(`WDK7 ready: root='${resolvedRoot}' source='${source}'`);
}

/**
 * publishNotFound records a graceful failure state instead of throwing away all
 * outputs. Existing workflows can check found=false and skip WDK7 builds.
 */
export function publishNotFound(reason: string): void {
  core.info(reason);

  publishStaticOutputs();

  core.setOutput("found", "false");
  core.setOutput("root", "");
  core.setOutput("source", "none");
  core.setOutput("cache-hit", "false");

  publishDebuggersSdk(undefined);
}

/**
 * uniqueStrings preserves first-seen order while removing case-insensitive
 * duplicates. URL lists and Windows paths both need stable ordering.
 */
export function uniqueStrings(values: string[]): string[] {
  const seen: Set<string> = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key: string = value.toLowerCase();

    if (false === seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

/**
 * splitDownloadUrls accepts separators people commonly use in workflow YAML.
 * This is URL parsing, not a general configuration language.
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
 * readBooleanInput validates boolean action inputs before they affect the setup
 * flow. Unexpected values should fail with a direct workflow message.
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

/**
 * replaceEnvironmentToken resolves one %NAME% placeholder. Missing variables
 * expand to an empty string to match cmd.exe-style behavior.
 */
function replaceEnvironmentToken(_match: string, name: string): string {
  const replacement: string | undefined = process.env[name];

  if (undefined === replacement) {
    return "";
  }

  return replacement;
}

/**
 * publishDebuggersSdk exports optional Debugging Tools paths. Empty outputs are
 * always written when the SDK is absent so workflow conditions stay predictable.
 */
function publishDebuggersSdk(sdk?: DebuggersSdk): void {
  if (undefined === sdk) {
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
