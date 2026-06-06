/**
 * ActionInputs is the validated action configuration after GitHub input parsing.
 * Keeping this shape in one place makes the orchestration code read like a
 * business flow instead of a collection of unrelated string lookups.
 */
export interface ActionInputs {
  root: string;
  downloadUrls: string[];
  debugger: boolean;
}

/**
 * WdkRoot identifies a usable WDK7 tree and records how the action found it.
 * The source value is intentionally human-readable because it is also exposed
 * as an action output for CI diagnostics.
 */
export interface WdkRoot {
  root: string;
  source: string;
}

/**
 * DebuggersSdk contains the DbgEng SDK paths that later build steps need.
 * The SDK is separate from the generic WDK surface because Debugging Tools are
 * optional and should not change normal compiler include/library search order.
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
 * changed the cache directory. The cache flag lets the caller save only when
 * the action created new material worth preserving.
 */
export interface PreparedDebuggers {
  sdk?: DebuggersSdk;
  cacheChanged: boolean;
}

/**
 * RunOptions keeps process execution policy explicit at the call site.
 * Silent commands still capture output, but do not mirror it to the job log.
 */
export interface RunOptions {
  cwd?: string;
  silent?: boolean;
}
