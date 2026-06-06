import * as core from "@actions/core";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";

import { downloadRetries } from "./settings.js";

const maxRedirects: number = 8;
const requestTimeoutMilliseconds: number = 300000;

/**
 * ensureWdk7Iso returns a cached ISO path or downloads one from the configured
 * sources. The ISO is stored beside extracted WDK files so all expensive WDK7
 * artifacts share the same cache lifecycle.
 */
export async function ensureWdk7Iso(cacheRoot: string, urls: string[]): Promise<string> {
  const isoPath: string = path.join(cacheRoot, "GRMWDK_EN_7600_1.ISO");

  if (true === existsSync(isoPath)) {
    core.info(`Using cached WDK7 ISO: ${isoPath}`);
    return isoPath;
  }

  const downloadedUrl: string = await downloadFileFromUrlsWithRetries(urls, isoPath, downloadRetries);
  core.info(`Downloaded WDK7 ISO from: ${downloadedUrl}`);

  return isoPath;
}

/**
 * downloadFileFromUrlsWithRetries tries each configured source in order. This
 * keeps user-provided mirrors first while still falling back to the built-in
 * Microsoft URL when a mirror is unavailable.
 */
async function downloadFileFromUrlsWithRetries(
  urls: string[],
  outputPath: string,
  attempts: number
): Promise<string> {
  let lastError: unknown = undefined;

  for (let index: number = 0; index < urls.length; index = index + 1) {
    const url: string = urls[index];

    try {
      core.info(`Downloading WDK7 ISO from source ${index + 1}/${urls.length}: ${url}`);
      await downloadFileWithRetries(url, outputPath, attempts);

      return url;
    } catch (error) {
      lastError = error;
      rmSync(outputPath, { force: true });

      if (index + 1 < urls.length) {
        core.warning(`WDK7 ISO source ${index + 1}/${urls.length} failed: ${formatError(error)}. Trying next source.`);
      }
    }
  }

  throw errorFromUnknown(lastError);
}

/**
 * downloadFileWithRetries retries one URL with a short backoff. WDK ISO
 * downloads are large enough that transient network failures are common, but
 * retrying forever would hide broken workflow configuration.
 */
async function downloadFileWithRetries(urlText: string, outputPath: string, attempts: number): Promise<void> {
  let lastError: unknown = undefined;

  for (let attempt: number = 1; attempt <= attempts; attempt = attempt + 1) {
    try {
      await downloadFile(urlText, outputPath, 0);
      return;
    } catch (error) {
      lastError = error;
      rmSync(outputPath, { force: true });

      if (attempt >= attempts) {
        break;
      }

      const delay: number = Math.min(30000, 2000 * attempt);
      core.warning(`WDK7 ISO download attempt ${attempt}/${attempts} failed: ${formatError(error)}. Retrying in ${delay / 1000}s.`);

      await sleep(delay);
    }
  }

  throw errorFromUnknown(lastError);
}

/**
 * downloadFile streams one URL to disk and follows a limited number of
 * redirects. The temporary file is renamed only after the stream closes so the
 * cache never treats a partial ISO as valid.
 */
async function downloadFile(urlText: string, outputPath: string, redirectCount: number): Promise<void> {
  if (maxRedirects < redirectCount) {
    throw new Error(`Too many redirects while downloading '${urlText}'.`);
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });

  const url: URL = new URL(urlText);
  const tmpPath: string = `${outputPath}.tmp`;

  rmSync(tmpPath, { force: true });

  /**
   * downloadFilePromise adapts the streaming HTTP client to async/await. The
   * closure owns the temporary path so every failure path can remove the same
   * partial file.
   */
  function downloadFilePromise(resolve: () => void, reject: (reason?: unknown) => void): void {
    /**
     * onResponse validates HTTP status before writing to disk. Redirects are
     * handled here because native http clients do not follow them automatically.
     */
    function onResponse(response: http.IncomingMessage): void {
      let status: number = 0;

      if (undefined !== response.statusCode) {
        status = response.statusCode;
      }

      const location: string | undefined = response.headers.location;

      if (300 <= status && 400 > status && undefined !== location) {
        response.resume();

        const nextUrl: string = new URL(location, url).toString();
        downloadFile(nextUrl, outputPath, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (200 > status || 300 <= status) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}: ${urlText}`));
        return;
      }

      writeResponseToFile(response, tmpPath, outputPath, resolve, reject);
    }

    const client: typeof http | typeof https = "https:" === url.protocol ? https : http;
    const request: http.ClientRequest = client.get(url, onResponse);

    /**
     * onRequestError removes the temporary file because a failed request may
     * leave a partial stream behind.
     */
    request.on("error", function onRequestError(error: Error): void {
      rmSync(tmpPath, { force: true });
      reject(error);
    });

    /**
     * onRequestTimeout aborts stuck transfers. Large ISO downloads should be
     * retried by the caller instead of hanging the entire CI job indefinitely.
     */
    request.setTimeout(requestTimeoutMilliseconds, function onRequestTimeout(): void {
      request.destroy(new Error(`Download timed out after 300 seconds: ${urlText}`));
    });
  }

  await new Promise<void>(downloadFilePromise);
}

/**
 * writeResponseToFile finishes the stream-to-file part of a verified download.
 * Keeping this separate from HTTP validation makes partial-file handling easier
 * to audit.
 */
function writeResponseToFile(
  response: http.IncomingMessage,
  tmpPath: string,
  outputPath: string,
  resolve: () => void,
  reject: (reason?: unknown) => void
): void {
  const file = createWriteStream(tmpPath);
  response.pipe(file);

  /**
   * onFileFinish closes the descriptor before rename. Windows can reject a
   * rename while the stream still owns the file handle.
   */
  file.on("finish", function onFileFinish(): void {
    /**
     * onFileClosed publishes the completed temporary file only after Windows has
     * released the stream handle.
     */
    function onFileClosed(): void {
      renameSync(tmpPath, outputPath);
      resolve();
    }

    file.close(onFileClosed);
  });

  /**
   * onFileError removes the temporary file so the next retry starts from a
   * clean path.
   */
  file.on("error", function onFileError(error: Error): void {
    rmSync(tmpPath, { force: true });
    reject(error);
  });
}

/**
 * sleep creates an explicit async delay for retry backoff. A named helper keeps
 * retry code readable without hiding the fact that the action is waiting.
 */
function sleep(milliseconds: number): Promise<void> {
  /**
   * sleepPromise is intentionally tiny: setTimeout is callback-based, while the
   * retry loop reads clearly with await.
   */
  function sleepPromise(resolve: () => void): void {
    setTimeout(resolve, milliseconds);
  }

  return new Promise<void>(sleepPromise);
}

/**
 * formatError extracts the useful message from an unknown thrown value. Native
 * APIs and third-party packages do not always throw Error instances.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * errorFromUnknown converts the last failed attempt into an Error object. This
 * keeps catch sites simple while preserving the original message when possible.
 */
function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
