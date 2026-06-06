import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * actionRoot returns the repository root at runtime. The bundled action entry
 * lives under dist, so walking up one level keeps bundled assets such as CMake
 * files and ddkbuild.cmd addressable after packaging.
 */
export function actionRoot(): string {
  const bundledEntry: string = fileURLToPath(import.meta.url);
  const distDirectory: string = path.dirname(bundledEntry);

  return path.dirname(distDirectory);
}

/**
 * cmakeModuleDir points to the bundled CMake support directory. Keeping this as
 * a helper prevents output publishing and ISO scripts from duplicating layout
 * assumptions.
 */
export function cmakeModuleDir(): string {
  return path.join(actionRoot(), "cmake");
}

/**
 * toolchainFile returns the WDK7 CMake toolchain exposed to downstream builds.
 * It is derived from the module directory so a future move only changes one
 * path helper.
 */
export function toolchainFile(): string {
  return path.join(cmakeModuleDir(), "wdk7.cmake");
}

/**
 * ddkbuildCmd returns the bundled compatibility wrapper for legacy projects.
 * The action exports this path so workflow authors do not need to hardcode the
 * repository layout.
 */
export function ddkbuildCmd(): string {
  return path.join(actionRoot(), "ddkbuild.cmd");
}

/**
 * expandEnvironment resolves Windows-style %NAME% references in user-provided
 * paths. WDK roots are often configured through environment variables on
 * self-hosted runners, so this keeps those inputs usable.
 */
export function expandEnvironment(value: string): string {
  // Windows users commonly pass roots such as %WDK7_ROOT%, so expansion happens
  // before path normalization instead of forcing callers to resolve variables.
  return value.replace(/%([^%]+)%/g, replaceEnvironmentToken);
}

/**
 * fullPath normalizes an input path after environment expansion. Empty values
 * stay empty so callers can distinguish "not configured" from a valid current
 * directory path.
 */
export function fullPath(value: string): string {
  if ("" === value.trim()) {
    return "";
  }

  return path.resolve(expandEnvironment(value));
}

/**
 * targetBins lists the compiler directories that must exist for both WDK7
 * target architectures. A root is only useful to the action when both x86 and
 * amd64 build tools are present.
 */
export function targetBins(root: string): string[] {
  return [
    path.join(root, "bin", "x86", "x86"),
    path.join(root, "bin", "x86", "amd64")
  ];
}

/**
 * hostBin returns the WDK host-tool directory used by NMake and resource tools.
 * WDK7 uses x86 host tools even when the target architecture is amd64.
 */
export function hostBin(root: string): string {
  return path.join(root, "bin", "x86");
}

/**
 * defaultCacheRoot chooses a writable cache directory for GitHub, Gitea, and
 * local debugging. The priority favors runner-managed tool cache storage when
 * the hosting platform exposes it.
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
 * replaceEnvironmentToken resolves one %NAME% placeholder. Missing environment
 * variables expand to an empty string because that mirrors cmd.exe-style
 * behavior and prevents unresolved tokens from becoming accidental directories.
 */
function replaceEnvironmentToken(_match: string, name: string): string {
  const replacement: string | undefined = process.env[name];

  if (undefined === replacement) {
    return "";
  }

  return replacement;
}
