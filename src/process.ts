import * as core from "@actions/core";
import { spawn } from "node:child_process";

import type { RunOptions } from "./types.js";

/**
 * runProcess executes a child process and returns trimmed stdout. The action
 * uses native Windows tools for ISO mounting and MSI extraction, so this helper
 * centralizes logging, hidden-window behavior, and error reporting.
 */
export function runProcess(command: string, args: string[], options?: RunOptions): Promise<string> {
  /**
   * runProcessPromise bridges event-based child process APIs into async/await.
   * The closure keeps stdout and stderr buffers local to exactly one process.
   */
  function runProcessPromise(resolve: (value: string) => void, reject: (reason?: unknown) => void): void {
    const cwd: string | undefined = undefined !== options ? options.cwd : undefined;
    const silent: boolean = undefined !== options && true === options.silent;

    core.debug(`Running: ${command} ${args.join(" ")}`);

    // Windows runner services should not open visible helper windows during ISO
    // mounting or MSI extraction because there is no interactive desktop to use.
    const child = spawn(command, args, {
      cwd: cwd,
      windowsHide: true
    });

    let stdout: string = "";
    let stderr: string = "";

    /**
     * onStdoutData mirrors stdout unless the caller requested a quiet command.
     * Capturing always continues so callers can parse drive letters or command
     * diagnostics even when log output is suppressed.
     */
    child.stdout.on("data", function onStdoutData(chunk: Buffer): void {
      const text: string = chunk.toString();
      stdout = stdout + text;

      if (false === silent) {
        process.stdout.write(text);
      }
    });

    /**
     * onStderrData preserves stderr for failure messages while respecting the
     * same quiet mode used for stdout.
     */
    child.stderr.on("data", function onStderrData(chunk: Buffer): void {
      const text: string = chunk.toString();
      stderr = stderr + text;

      if (false === silent) {
        process.stderr.write(text);
      }
    });

    /**
     * onChildError reports spawn-level failures, such as a missing executable,
     * before a process exit code can exist.
     */
    child.on("error", function onChildError(error: Error): void {
      reject(error);
    });

    /**
     * onChildClose converts process exit status into the promise contract. The
     * stderr tail is included because msiexec and PowerShell usually explain
     * actionable failures there.
     */
    child.on("close", function onChildClose(code: number | null): void {
      if (0 === code) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${command} failed with exit code ${code}. ${stderr.trim()}`));
    });
  }

  return new Promise<string>(runProcessPromise);
}
