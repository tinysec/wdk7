import * as core from "@actions/core";

import { cmakeGenerator } from "./settings.js";
import { cmakeModuleDir, ddkbuildCmd, fullPath, hostBin, toolchainFile } from "./paths.js";
import type { DebuggersSdk } from "./types.js";

/**
 * publishStaticOutputs exposes action-bundled assets before WDK discovery
 * finishes. Even a failed setup can then tell users where the CMake toolchain
 * and compatibility wrapper would have been resolved from.
 */
export function publishStaticOutputs(): void {
  core.setOutput("cmake-module-dir", cmakeModuleDir());
  core.setOutput("toolchain-file", toolchainFile());
  core.setOutput("ddkbuild-cmd", ddkbuildCmd());
  core.setOutput("cmake-generator", cmakeGenerator);
}

/**
 * publishWdk7 exports a usable WDK root to later workflow steps. Environment
 * variables are exported for shell convenience, while outputs preserve stable
 * step references for workflow YAML.
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

  // The host tools are placed on PATH because NMake and rc.exe are used by both
  // CMake and legacy build scripts after the action step completes.
  core.addPath(host);

  core.setOutput("found", "true");
  core.setOutput("root", resolvedRoot);
  core.setOutput("source", source);
  core.setOutput("cache-hit", true === cacheHit ? "true" : "false");

  publishDebuggersSdk(sdk);

  core.info(`WDK7 ready: root='${resolvedRoot}' source='${source}'`);
}

/**
 * publishNotFound records a graceful failure state instead of throwing away all
 * outputs. Existing workflows can check found=false and decide whether a WDK7
 * build should be skipped.
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
 * publishDebuggersSdk exports optional Debugging Tools paths. Empty outputs are
 * always written when the SDK is absent so downstream workflow conditions do
 * not depend on missing-output behavior.
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
